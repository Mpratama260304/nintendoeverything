# Nintendo Everything Mirror Proxy

Full reverse proxy mirror untuk **nintendoeverything.com** dengan SEO-optimized URL rewriting.  
Mengatasi semua masalah Google Search Console: duplikat canonical, redirect, structured data, breadcrumb, 404.

## Fitur

- **Full URL Rewriting** — Semua URL di HTML, CSS, JS, XML, JSON di-rewrite ke domain mirror
- **Canonical Tag Fix** — `<link rel="canonical">` selalu mengarah ke mirror domain (fix duplikat canonical)
- **JSON-LD/Structured Data** — Parse & rewrite semua URL di JSON-LD termasuk breadcrumb (fix data terstruktur error)
- **Redirect Handling** — Intercept redirect dari upstream, rewrite `Location` header ke mirror domain
- **Custom robots.txt** — Sitemap pointing ke mirror domain
- **Sitemap Auto-Rewrite** — Fetch sitemap dari upstream, rewrite semua `<loc>` URL
- **In-Memory Cache** — Cache HTML (10 menit), sitemap (1 jam), static assets (24 jam)
- **Multi-Platform Deploy** — Railway, Render, Docker/VPS

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Mpratama260304/nintendoeverything.git
cd nintendoeverything
npm install
```

### 2. Konfigurasi

Copy `.env.example` ke `.env` dan sesuaikan:

```bash
cp .env.example .env
```

Edit `.env`:
```env
TARGET_DOMAIN=nintendoeverything.com
MIRROR_DOMAIN=yourdomain.com    # Ganti dengan domain mirror kamu
PORT=3000
```

### 3. Jalankan

```bash
npm start
```

Server akan jalan di `http://localhost:3000`

## Deploy

### Railway

1. Push repo ke GitHub
2. Connect di [Railway](https://railway.app)
3. Set environment variables:
   - `TARGET_DOMAIN=nintendoeverything.com`
   - `MIRROR_DOMAIN=your-railway-domain.up.railway.app`
4. Deploy otomatis

### Render

1. Push repo ke GitHub
2. Create Web Service di [Render](https://render.com)
3. Set environment variables sama seperti di atas
4. Build: `npm install`, Start: `node src/index.js`

### Docker / VPS

```bash
# Build & run
docker compose up -d

# Atau manual
docker build -t mirror-proxy .
docker run -d -p 3000:3000 \
  -e TARGET_DOMAIN=nintendoeverything.com \
  -e MIRROR_DOMAIN=yourdomain.com \
  mirror-proxy
```

## Verifikasi SEO

Setelah deploy, cek dengan:

```bash
# Canonical tag
curl -s https://yourdomain.com | grep 'rel="canonical"'

# og:url
curl -s https://yourdomain.com | grep 'og:url'

# JSON-LD structured data
curl -s https://yourdomain.com | grep -A5 'application/ld+json'

# Redirect handling
curl -I https://yourdomain.com/some-old-path

# Robots.txt
curl https://yourdomain.com/robots.txt

# Sitemap
curl https://yourdomain.com/sitemap.xml | head -20
```

## Struktur File

```
src/
├── index.js          # Express server, middleware, routes
├── config.js         # Environment configuration
├── proxy.js          # Core proxy handler + caching
├── transform.js      # HTML/CSS/XML/JSON transformation engine
└── handlers/
    ├── robots.js     # Custom robots.txt handler
    └── sitemap.js    # Sitemap fetch & rewrite handler
```

## Environment Variables

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `TARGET_DOMAIN` | `nintendoeverything.com` | Domain yang di-mirror |
| `MIRROR_DOMAIN` | `yourdomain.com` | Domain mirror kamu |
| `PORT` | `3000` | Port server |
| `CACHE_TTL_HTML` | `600` | Cache TTL HTML (detik) |
| `CACHE_TTL_SITEMAP` | `3600` | Cache TTL sitemap (detik) |
| `CACHE_TTL_STATIC` | `86400` | Cache TTL static assets (detik) |
| `USER_AGENT` | `Mozilla/5.0 (compatible; MirrorProxy/1.0)` | User agent untuk upstream |