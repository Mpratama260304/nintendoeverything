const axios = require('axios');
const http = require('http');
const https = require('https');
const NodeCache = require('node-cache');
const config = require('./config');
const { transformHTML, transformCSS, transformJSON, rewriteUrl } = require('./transform');

// Connection pooling — reuse connections ke upstream
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

// Cache untuk transformed responses
const pageCache = new NodeCache({ stdTTL: config.cacheTTL.html, checkperiod: 120 });

// Content types yang perlu di-transform
const TRANSFORM_HTML = /text\/html/i;
const TRANSFORM_CSS = /text\/css/i;
const TRANSFORM_XML = /(?:application|text)\/(?:xml|rss\+xml|atom\+xml)/i;
const TRANSFORM_JSON = /application\/json/i;
const TRANSFORM_JS = /(?:application|text)\/javascript/i;

// Headers yang TIDAK boleh di-forward ke client
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  'content-encoding', 'content-length', // kita set ulang setelah transform
]);

/**
 * Core proxy handler — fetch dari upstream, transform, return ke client
 */
async function proxyHandler(req, res) {
  const requestPath = req.originalUrl; // include query string

  // Auto-detect mirror domain dari request Host header
  const { mirrorDomain, mirrorOrigin } = config.getMirrorFromReq(req);

  const cacheKey = `page:${mirrorDomain}:${req.method}:${requestPath}`;

  // Hanya cache GET requests
  if (req.method === 'GET') {
    const cached = pageCache.get(cacheKey);
    if (cached) {
      // Set headers dari cache
      for (const [key, value] of Object.entries(cached.headers)) {
        res.set(key, value);
      }
      res.set('X-Cache', 'HIT');
      return res.status(cached.status).send(cached.body);
    }
  }

  try {
    const upstreamUrl = `${config.targetOrigin}${requestPath}`;

    // Build headers untuk upstream
    const upstreamHeaders = buildUpstreamHeaders(req, mirrorDomain);

    const response = await axios({
      method: req.method,
      url: upstreamUrl,
      headers: upstreamHeaders,
      data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      responseType: 'arraybuffer', // raw bytes supaya bisa handle binary & text
      decompress: true,
      timeout: 30000,
      maxRedirects: 0, // JANGAN auto-follow — kita handle redirect sendiri
      validateStatus: () => true, // terima semua status codes
      httpAgent,
      httpsAgent,
    });

    const status = response.status;
    const contentType = (response.headers['content-type'] || '').toLowerCase();

    // =====================================================
    // Handle redirects — fix "Halaman dengan pengalihan" di GSC
    // =====================================================
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers['location'];
      if (location) {
        const newLocation = rewriteUrl(location, mirrorOrigin);

        // Copy safe headers FIRST, then override Location
        setResponseHeaders(res, response.headers, mirrorDomain);
        res.set('Location', newLocation);
        res.set('X-Cache', 'MISS');

        return res.status(status).end();
      }
    }

    // =====================================================
    // Transform berdasarkan content type
    // =====================================================
    let body;
    const rawBody = Buffer.from(response.data);

    if (TRANSFORM_HTML.test(contentType)) {
      // HTML — full cheerio transformation
      const htmlString = rawBody.toString('utf-8');
      body = transformHTML(htmlString, req.path, mirrorOrigin);

      setResponseHeaders(res, response.headers, mirrorDomain);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', `public, max-age=${config.cacheTTL.html}`);
      res.set('X-Robots-Tag', 'index, follow');
      res.set('Link', `<${mirrorOrigin}${req.path}>; rel="canonical"`);
      res.set('X-Cache', 'MISS');

      // Cache HTML response (hanya GET 200)
      if (req.method === 'GET' && status === 200) {
        const headersToCache = {
          'Content-Type': contentType,
          'Cache-Control': `public, max-age=${config.cacheTTL.html}`,
          'X-Robots-Tag': 'index, follow',
          'Link': `<${mirrorOrigin}${req.path}>; rel="canonical"`,
        };
        pageCache.set(cacheKey, { status, headers: headersToCache, body }, config.cacheTTL.html);
      }

      return res.status(status).send(body);

    } else if (TRANSFORM_CSS.test(contentType)) {
      // CSS — string replace URLs
      body = transformCSS(rawBody.toString('utf-8'), mirrorOrigin);
      setResponseHeaders(res, response.headers, mirrorDomain);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', `public, max-age=${config.cacheTTL.static}`);
      return res.status(status).send(body);

    } else if (TRANSFORM_XML.test(contentType)) {
      // XML (RSS, Atom, dll)
      const { transformXML } = require('./transform');
      body = transformXML(rawBody.toString('utf-8'), mirrorOrigin);
      setResponseHeaders(res, response.headers, mirrorDomain);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', `public, max-age=${config.cacheTTL.html}`);
      return res.status(status).send(body);

    } else if (TRANSFORM_JSON.test(contentType)) {
      // JSON API responses
      body = transformJSON(rawBody.toString('utf-8'), mirrorOrigin);
      setResponseHeaders(res, response.headers, mirrorDomain);
      res.set('Content-Type', contentType);
      return res.status(status).send(body);

    } else if (TRANSFORM_JS.test(contentType)) {
      // JavaScript — string replace domain references
      body = rawBody.toString('utf-8').replace(config.targetDomainRegex, mirrorOrigin);
      setResponseHeaders(res, response.headers, mirrorDomain);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', `public, max-age=${config.cacheTTL.static}`);
      return res.status(status).send(body);

    } else {
      // Binary content (images, fonts, video, dll) — pass through tanpa transform
      setResponseHeaders(res, response.headers, mirrorDomain);
      res.set('Cache-Control', `public, max-age=${config.cacheTTL.static}`);
      return res.status(status).send(rawBody);
    }

  } catch (err) {
    console.error(`[Proxy] Error fetching ${requestPath}:`, err.message);

    // Jangan return 404 palsu — return 502 agar GSC tidak bilang "Tidak ditemukan"
    res.status(502).set('Content-Type', 'text/html; charset=utf-8').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head><title>502 Bad Gateway</title></head>
      <body>
        <h1>502 Bad Gateway</h1>
        <p>Unable to reach the upstream server. Please try again later.</p>
      </body>
      </html>
    `);
  }
}

/**
 * Build headers untuk request ke upstream
 */
function buildUpstreamHeaders(req, mirrorDomain) {
  const headers = {
    'Host': config.targetDomain,
    'User-Agent': req.headers['user-agent'] || config.userAgent,
    'Accept': req.headers['accept'] || '*/*',
    'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'X-Forwarded-For': req.ip || req.connection.remoteAddress,
    'X-Forwarded-Proto': req.protocol || 'https',
    'X-Forwarded-Host': mirrorDomain,
  };

  // Forward cookie jika ada (untuk WordPress logged-in sessions)
  if (req.headers['cookie']) {
    headers['Cookie'] = req.headers['cookie'];
  }

  // Forward referer (rewrite ke target domain)
  if (req.headers['referer']) {
    headers['Referer'] = req.headers['referer'].replace(
      new RegExp(mirrorDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      config.targetDomain
    );
  }

  // Forward content-type untuk POST/PUT
  if (req.headers['content-type']) {
    headers['Content-Type'] = req.headers['content-type'];
  }

  return headers;
}

/**
 * Copy safe response headers ke client response (skip hop-by-hop & problematic headers)
 */
function setResponseHeaders(res, upstreamHeaders, mirrorDomain) {
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    const lowerKey = key.toLowerCase();

    // Skip hop-by-hop headers
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;

    // Skip Location header — handled separately in redirect logic
    if (lowerKey === 'location') continue;

    // Skip security headers yang bisa block mirror
    if (lowerKey === 'x-frame-options') continue;
    if (lowerKey === 'content-security-policy') continue;
    if (lowerKey === 'strict-transport-security') continue;

    // Skip set-cookie yang mengarah ke domain target
    if (lowerKey === 'set-cookie') {
      // Rewrite domain di cookie supaya diterima browser di mirror domain
      const cookies = Array.isArray(value) ? value : [value];
      const rewritten = cookies.map(c =>
        c.replace(
          new RegExp(config.targetDomain.replace(/\./g, '\\.'), 'gi'),
          mirrorDomain
        )
      );
      res.set('Set-Cookie', rewritten);
      continue;
    }

    res.set(key, value);
  }

  // Set HSTS header kita sendiri
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

module.exports = proxyHandler;
