const express = require('express');
const compression = require('compression');
const config = require('./config');
const proxyHandler = require('./proxy');
const robotsTxtHandler = require('./handlers/robots');
const sitemapHandler = require('./handlers/sitemap');

const app = express();

// =====================================================
// Middleware
// =====================================================

// Trust proxy (Railway/Render/Nginx set X-Forwarded-For)
app.set('trust proxy', true);

// Gzip compression untuk responses
app.use(compression());

// Parse body untuk POST requests
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Request logging + mirror domain debug
app.use((req, res, next) => {
  const { mirrorDomain } = config.getMirrorFromReq(req);
  const start = Date.now();
  if (req.originalUrl === '/') {
    console.log(`[Debug] Host: ${req.get('host')} | X-Forwarded-Host: ${req.get('x-forwarded-host')} | hostname: ${req.hostname} → mirrorDomain: ${mirrorDomain}`);
  }
  res.on('finish', () => {
    const duration = Date.now() - start;
    const cacheStatus = res.getHeader('X-Cache') || '-';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms) [${cacheStatus}]`);
  });
  next();
});

// =====================================================
// Special routes — harus SEBELUM proxy catch-all
// =====================================================

// Health check untuk Railway/Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Custom robots.txt — fix crawling & sitemap discovery
app.get('/robots.txt', robotsTxtHandler);

// Sitemap handler — fetch dari upstream, rewrite URLs
app.get('/sitemap.xml', sitemapHandler);
app.get('/sitemap-index.xml', sitemapHandler);
app.get('/news-sitemap.xml', sitemapHandler);
app.get('/sitemap-*.xml', sitemapHandler); // WordPress sitemap pattern (sitemap-pt-post-2024-01.xml dll)
app.get('/wp-sitemap*.xml', sitemapHandler); // WordPress core sitemap
app.get('/post-sitemap*.xml', sitemapHandler);
app.get('/page-sitemap*.xml', sitemapHandler);
app.get('/category-sitemap*.xml', sitemapHandler);
app.get('/tag-sitemap*.xml', sitemapHandler);

// RSS/Atom feeds — juga perlu rewrite URL
app.get('/feed', proxyHandler);
app.get('/feed/*', proxyHandler);

// =====================================================
// Catch-all proxy — semua request lain di-proxy ke upstream
// =====================================================
app.all('*', proxyHandler);

// =====================================================
// Error handler
// =====================================================
app.use((err, req, res, _next) => {
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err.message);
  res.status(500).set('Content-Type', 'text/html; charset=utf-8').send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><title>500 Internal Server Error</title></head>
    <body>
      <h1>500 Internal Server Error</h1>
      <p>Something went wrong. Please try again later.</p>
    </body>
    </html>
  `);
});

// =====================================================
// Start server
// =====================================================
app.listen(config.port, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`  Mirror Proxy Server Started`);
  console.log(`  Port: ${config.port}`);
  console.log(`  Target: ${config.targetOrigin}`);
  console.log(`  Mirror: ${config.mirrorDomain || '(auto-detect from Host header)'}`);
  console.log('========================================');
});
