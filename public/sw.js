// Gridline GP service worker: lets the installed app start without internet.
// The build inlines everything (code, Three.js, fonts) into index.html, so caching the page and its icons is enough.
// Network first, so a new build shows up on reload; the cached copy is only used offline.
const CACHE = 'gridline-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
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
  if (url.origin !== location.origin) return;
  // fetch by URL: a navigation Request can't be re-issued with options
  e.respondWith(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
    .then(res => res.ok ? store(req, res) : res)
    .catch(() => caches.match(req, { ignoreSearch: true })));
});
