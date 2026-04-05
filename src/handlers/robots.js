const config = require('../config');

/**
 * Handler /robots.txt — serve custom robots.txt agar Google crawl mirror domain
 */
function robotsTxtHandler(req, res) {
  const { mirrorOrigin } = config.getMirrorFromReq(req);

  const robotsTxt = `# Robots.txt for mirror of ${config.targetDomain}

User-agent: *
Allow: /

# Sitemap lokasi mirror
Sitemap: ${mirrorOrigin}/sitemap.xml
Sitemap: ${mirrorOrigin}/news-sitemap.xml
Sitemap: ${mirrorOrigin}/sitemap-index.xml

# Blokir akses admin WordPress
Disallow: /wp-admin/
Disallow: /wp-login.php
Disallow: /xmlrpc.php
Allow: /wp-admin/admin-ajax.php
`;

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('X-Robots-Tag', 'noindex');
  res.send(robotsTxt);
}

module.exports = robotsTxtHandler;
