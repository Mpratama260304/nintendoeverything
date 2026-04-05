require('dotenv').config();

const config = {
  // Domain asli yang di-mirror
  targetDomain: process.env.TARGET_DOMAIN || 'nintendoeverything.com',
  targetOrigin: `https://${process.env.TARGET_DOMAIN || 'nintendoeverything.com'}`,

  // Domain mirror (fallback — overridden per-request via getMirrorFromReq)
  mirrorDomain: process.env.MIRROR_DOMAIN || '',

  // Port
  port: parseInt(process.env.PORT, 10) || 3000,

  // Cache TTL (seconds)
  cacheTTL: {
    html: parseInt(process.env.CACHE_TTL_HTML, 10) || 600,       // 10 menit
    sitemap: parseInt(process.env.CACHE_TTL_SITEMAP, 10) || 3600, // 1 jam
    static: parseInt(process.env.CACHE_TTL_STATIC, 10) || 86400,  // 24 jam
  },

  // User agent
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (compatible; MirrorProxy/1.0)',

  // Regex untuk mencocokkan domain target (http, https, dan protocol-relative)
  get targetDomainRegex() {
    const escaped = this.targetDomain.replace(/\./g, '\\.');
    return new RegExp(`(?:https?:)?//(?:www\\.)?${escaped}`, 'gi');
  },

  /**
   * Auto-detect mirror domain & origin dari request Host header.
   * Jika MIRROR_DOMAIN sudah di-set di env, pakai itu.
   * Kalau tidak, pakai Host header dari browser (works di Codespaces, Railway, dll).
   */
  getMirrorFromReq(req) {
    // Priority: env MIRROR_DOMAIN > X-Forwarded-Host > req.hostname (trust proxy) > raw Host
    // Codespaces/Railway/Render send the real public domain via X-Forwarded-Host
    const host = config.mirrorDomain
      || req.get('x-forwarded-host')
      || req.hostname
      || req.get('host');
    // Always use HTTPS for mirror (Railway/Render/Codespaces all terminate TLS)
    return {
      mirrorDomain: host,
      mirrorOrigin: `https://${host}`,
    };
  },
};

module.exports = config;
