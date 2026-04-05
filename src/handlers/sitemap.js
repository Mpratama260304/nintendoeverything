const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');
const { transformXML } = require('../transform');

const sitemapCache = new NodeCache({ stdTTL: config.cacheTTL.sitemap });

/**
 * Handler sitemap — fetch dari upstream, rewrite semua URL ke mirror domain, cache hasilnya
 */
async function sitemapHandler(req, res) {
  const sitemapPath = req.path;
  const { mirrorOrigin } = config.getMirrorFromReq(req);
  const cacheKey = `sitemap:${sitemapPath}`;

  // Cek cache dulu
  const cached = sitemapCache.get(cacheKey);
  if (cached) {
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', `public, max-age=${config.cacheTTL.sitemap}`);
    res.set('X-Robots-Tag', 'noindex');
    return res.send(cached);
  }

  try {
    const upstreamUrl = `${config.targetOrigin}${sitemapPath}`;
    const response = await axios.get(upstreamUrl, {
      headers: {
        'Host': config.targetDomain,
        'User-Agent': config.userAgent,
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      responseType: 'text',
      decompress: true,
      timeout: 30000,
      maxRedirects: 5,
    });

    // Rewrite semua URL di sitemap XML
    const transformed = transformXML(response.data, mirrorOrigin);

    // Cache hasil
    sitemapCache.set(cacheKey, transformed);

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', `public, max-age=${config.cacheTTL.sitemap}`);
    res.set('X-Robots-Tag', 'noindex');
    res.send(transformed);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).set('Content-Type', 'text/plain').send('Sitemap not found');
    }
    console.error(`[Sitemap] Error fetching ${sitemapPath}:`, err.message);
    res.status(502).set('Content-Type', 'text/plain').send('Error fetching sitemap from upstream');
  }
}

module.exports = sitemapHandler;
