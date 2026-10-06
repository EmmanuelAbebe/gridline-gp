// Gridline GP service worker: lets the installed app start without internet.
// Game files: network first, so edits show up on reload; the cached copy is only used offline.
// CDN files (Three.js, fonts): cache first, since they never change.
const CACHE = 'gridline-v1';
const CORE = ['./gridline.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const CDN = /(^|\.)(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
// must match the URLs in gridline.html
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;700;800&family=Saira:wght@400;500;600&display=swap';

// Fetch a cross-origin file and cache it; resolves to the response, or null when offline.
const precache = (c, url) => fetch(url, { mode: 'cors' })
  .then(r => r.ok ? c.put(url, r.clone()).then(() => r) : null).catch(() => null);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
    await precache(c, THREE_URL);
    const css = await precache(c, FONTS_URL);            // the stylesheet, then the font files it points to
    if (css) await Promise.all(((await css.text()).match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || []).map(u => precache(c, u)));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const store = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // fetch by URL: a navigation Request can't be re-issued with options
    e.respondWith(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => res.ok ? store(req, res) : res)
      .catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (CDN.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => res.ok || res.type === 'opaque' ? store(req, res) : res)));
  }
});
