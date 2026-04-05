const cheerio = require('cheerio');
const config = require('./config');

/**
 * Buat regex untuk escaped URLs (JSON strings: https:\/\/domain.com)
 */
function getEscapedDomainRegex() {
  const escaped = config.targetDomain.replace(/\./g, '\\.');
  return new RegExp(`(?:https?:)?\\\\/\\\\/(?:www\\\\.)?${escaped}`, 'gi');
}

/**
 * Escaped mirror origin (untuk replace di JSON strings)
 */
function getEscapedMirrorOrigin(mirrorOrigin) {
  return mirrorOrigin.replace(/\//g, '\\/');
}

/**
 * Rekursif rewrite semua URL string dalam object (untuk JSON-LD)
 */
function rewriteUrlsInObject(obj, mirrorOrigin) {
  if (typeof obj === 'string') {
    return obj.replace(config.targetDomainRegex, mirrorOrigin);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => rewriteUrlsInObject(item, mirrorOrigin));
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = rewriteUrlsInObject(obj[key], mirrorOrigin);
    }
    return result;
  }
  return obj;
}

/**
 * Transform HTML: rewrite semua URL, canonical, og:url, JSON-LD, breadcrumb, dll
 */
function transformHTML(html, requestPath, mirrorOrigin) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const canonicalUrl = `${mirrorOrigin}${requestPath}`;

  // =====================================================
  // 0. Inject CSS to collapse ad containers and remove blank space
  // =====================================================
  const adHideCSS = `<style id="mirror-ad-cleanup">
    .ai-viewports, [class*="code-block"][data-code],
    [id^="nn_lb"], [id^="nn_mobile_lb"], [id^="nn_mobile_mpu"], [id="nn_player"],
    [id^="nn_skin"], [id^="desktopadtemp"], [id^="mpu"], [id^="adtemp"],
    [id="nn_mobile_mpu5"], [id="nn_lb1_temp"],
    .ai-viewport-1, .ai-viewport-2, .ai-viewport-3,
    div[data-insertion-position], div[data-code] {
      display: none !important;
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }
  </style>`;
  $('head').append(adHideCSS);

  // =====================================================
  // 0a. Remove third-party ad/tracking/consent scripts yang error di mirror
  // =====================================================
  const BLOCKED_DOMAINS = [
    'videoplayerhub.com',
    'privacy-mgmt.com',
    'sourcepoint',
    'googletagservices.com',
    'securepubads.g.doubleclick.net',
    'pagead2.googlesyndication.com',
    'googlesyndication.com',
    'doubleclick.net',
    'anonymised.io',
    'anonymised.js',
    'adngin',
    'adengine',
    'pubstack',
    'scorecardresearch.com',
    'permutive.app',
    'gdpr-tcf',
    'cmp-sourcepoint',
    'wrapperMessaging',
    // Orchestrator scripts that dynamically load blocked sub-scripts
    'kumo.network-n.com',
    'network-n.com/dist/app.js',
    'html-load.com',
    'googletagmanager.com',
    'google-analytics.com',
    'google.com/analytics',
    'stats.wp.com',
  ];

  // Patterns for inline scripts that should be removed
  const BLOCKED_INLINE_PATTERNS = [
    'gtag(',
    'dataLayer',
    'google_analytics',
    'GoogleAnalyticsObject',
    "ga('send'",
    "ga('create'",
    '_gaq.push',
  ];

  const isBlocked = (val) => {
    if (!val) return false;
    const lower = val.toLowerCase();
    return BLOCKED_DOMAINS.some(d => lower.includes(d));
  };

  const isBlockedInline = (content) => {
    if (!content) return false;
    return BLOCKED_INLINE_PATTERNS.some(p => content.includes(p));
  };

  // Remove blocked <script src="..."> tags
  $('script[src]').each((_, el) => {
    if (isBlocked($(el).attr('src'))) {
      $(el).remove();
    }
  });

  // Remove blocked <link rel="preload/preconnect/dns-prefetch" href="..."> tags
  $('link[href]').each((_, el) => {
    const rel = ($(el).attr('rel') || '').toLowerCase();
    if (['preload', 'preconnect', 'dns-prefetch', 'prefetch'].includes(rel) && isBlocked($(el).attr('href'))) {
      $(el).remove();
    }
  });

  // Remove inline scripts that reference blocked domains or analytics patterns
  $('script:not([src])').each((_, el) => {
    const content = $(el).html() || '';
    if (isBlocked(content) || isBlockedInline(content)) {
      $(el).remove();
    }
  });

  // =====================================================
  // 0b. Remove empty ad containers that leave blank space
  // =====================================================

  // Remove Ad Inserter plugin blocks (ai-viewports with fixed height)
  $('.ai-viewports').remove();

  // Remove code-block ad containers
  $('div[class*="code-block"]').each((_, el) => {
    const $el = $(el);
    // Only remove code-block divs that contain ad content (data-code attr or ad IDs inside)
    if ($el.attr('data-code') || $el.find('[id*="nn_"], [id*="adtemp"], [id*="mpu"]').length) {
      $el.remove();
    }
  });

  // Remove known ad placeholder containers by ID pattern
  $('[id^="nn_lb"], [id^="nn_mobile"], [id^="nn_skin"], [id="nn_player"]').each((_, el) => {
    $(el).remove();
  });
  $('[id^="desktopadtemp"], [id^="mpu"], [id^="adtemp"]').each((_, el) => {
    $(el).remove();
  });

  // Remove empty <center> tags left over from ad removal
  $('center').each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === '' && $el.children().length === 0) {
      $el.remove();
    }
  });

  // Remove data-code attributes (base64-encoded ad HTML that JS would inject)
  $('[data-code]').removeAttr('data-code');

  // =====================================================
  // 1. Canonical tag — fix "Duplikat, Google memilih versi kanonis yang berbeda"
  // =====================================================
  const canonicalLink = $('link[rel="canonical"]');
  if (canonicalLink.length) {
    canonicalLink.attr('href', canonicalUrl);
  } else {
    $('head').append(`<link rel="canonical" href="${canonicalUrl}" />`);
  }

  // =====================================================
  // 2. Open Graph meta tags
  // =====================================================
  $('meta[property="og:url"]').attr('content', canonicalUrl);

  // og:image — rewrite jika mengarah ke domain target
  $('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      $(el).attr('content', content.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // og:site_name — biarkan (nama site, bukan URL)

  // =====================================================
  // 3. Twitter card meta
  // =====================================================
  $('meta[name="twitter:url"]').attr('content', canonicalUrl);
  $('meta[name="twitter:image"], meta[name="twitter:image:src"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      $(el).attr('content', content.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 4. JSON-LD structured data — fix breadcrumb & "Data terstruktur tidak dapat diurai"
  // =====================================================
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      let jsonData = JSON.parse(raw);
      jsonData = rewriteUrlsInObject(jsonData, mirrorOrigin);
      $(el).html(JSON.stringify(jsonData));
    } catch {
      // Jika JSON tidak valid, fallback ke string replace
      $(el).html(raw.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 5. Alternate/hreflang links
  // =====================================================
  $('link[rel="alternate"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      $(el).attr('href', href.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 6. Semua link <a href>
  // =====================================================
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      $(el).attr('href', href.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 7. Stylesheet, preload, icon links
  // =====================================================
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      $(el).attr('href', href.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 8. Script src
  // =====================================================
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      $(el).attr('src', src.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 9. Image & media src/srcset
  // =====================================================
  $('img[src], source[src], video[src], audio[src], iframe[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      $(el).attr('src', src.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  $('img[srcset], source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      $(el).attr('srcset', srcset.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 10. Form actions
  // =====================================================
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    if (action) {
      $(el).attr('action', action.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 11. Inline styles — url(...) references
  // =====================================================
  $('[style]').each((_, el) => {
    const style = $(el).attr('style');
    if (style && config.targetDomainRegex.test(style)) {
      $(el).attr('style', style.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 12. Inline <style> blocks
  // =====================================================
  $('style').each((_, el) => {
    const css = $(el).html();
    if (css) {
      $(el).html(css.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // =====================================================
  // 13. Inline <script> (non-JSON-LD) — rewrite domain in JS strings
  // =====================================================
  $('script:not([type="application/ld+json"])').each((_, el) => {
    if (!$(el).attr('src')) {
      const js = $(el).html();
      if (js && config.targetDomainRegex.test(js)) {
        $(el).html(js.replace(config.targetDomainRegex, mirrorOrigin));
      }
    }
  });

  // =====================================================
  // 14. data-* attributes yang mengandung URL
  // =====================================================
  $('[data-src], [data-lazy-src], [data-original], [data-bg], [data-href]').each((_, el) => {
    for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-bg', 'data-href']) {
      const val = $(el).attr(attr);
      if (val) {
        $(el).attr(attr, val.replace(config.targetDomainRegex, mirrorOrigin));
      }
    }
  });

  // =====================================================
  // 15. WordPress-specific: data-permalink, data-url
  // =====================================================
  $('[data-permalink], [data-url]').each((_, el) => {
    for (const attr of ['data-permalink', 'data-url']) {
      const val = $(el).attr(attr);
      if (val) {
        $(el).attr(attr, val.replace(config.targetDomainRegex, mirrorOrigin));
      }
    }
  });

  // =====================================================
  // 16. Noscript content — cheerio might not parse inner HTML
  // =====================================================
  $('noscript').each((_, el) => {
    const content = $(el).html();
    if (content) {
      $(el).html(content.replace(config.targetDomainRegex, mirrorOrigin));
    }
  });

  // Serialize HTML
  let output = $.html();

  // =====================================================
  // 17. Fix broken isMobile conditional scripts from upstream
  //     Pattern: <script>var isMobile=...; if(!isMobile){</script> ... <script>}</script>
  //     These are ad conditional blocks that produce JS syntax errors
  // =====================================================
  // Remove broken opening scripts: <script...>var isMobile = ...if (!isMobile) {</script>
  output = output.replace(/<script[^>]*>\s*var\s+isMobile\s*=\s*[^<]*?if\s*\(\s*!?\s*isMobile\s*\)\s*\{<\/script>/gi, '');
  // Remove broken closing scripts: <script...>}</script>
  output = output.replace(/<script[^>]*>\s*\}\s*<\/script>/g, '');
  // Remove stray } left between HTML elements (artifact of the broken pattern)
  output = output.replace(/\}\s*(<div\s)/g, '$1');
  output = output.replace(/(<\/div>)\s*\}/g, '$1');

  // =====================================================
  // 18. Final pass — catch escaped URLs in inline JS (https:\/\/domain.com)
  //     and any remaining direct references not caught by cheerio
  // =====================================================
  output = output.replace(getEscapedDomainRegex(), getEscapedMirrorOrigin(mirrorOrigin));

  // Final safety net: replace any remaining direct https://nintendoeverything.com
  // but NOT i0.wp.com/nintendoeverything.com (Jetpack CDN — host is i0.wp.com, fine for SEO)
  output = output.replace(config.targetDomainRegex, mirrorOrigin);

  return output;
}

/**
 * Transform CSS: rewrite URL references di dalam CSS
 */
function transformCSS(css, mirrorOrigin) {
  return css.replace(config.targetDomainRegex, mirrorOrigin);
}

/**
 * Transform XML (sitemap, RSS, Atom): rewrite semua domain references
 */
function transformXML(xml, mirrorOrigin) {
  return xml.replace(config.targetDomainRegex, mirrorOrigin);
}

/**
 * Transform JSON responses (API): rewrite domain references
 */
function transformJSON(json, mirrorOrigin) {
  return json.replace(config.targetDomainRegex, mirrorOrigin);
}

/**
 * Rewrite URL string (untuk Location header, dll)
 */
function rewriteUrl(url, mirrorOrigin) {
  if (!url) return url;
  return url.replace(config.targetDomainRegex, mirrorOrigin);
}

module.exports = {
  transformHTML,
  transformCSS,
  transformXML,
  transformJSON,
  rewriteUrl,
};
