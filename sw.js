// Roomie+ service worker: keeps a copy of the app on the phone so it opens without a connection.
// Online, it always fetches the newest files first, so a new upload shows up on the next open.
const CACHE = 'roomieplus-v2';
const SHELL = ['./', 'styles.css', 'app.js', 'config.js', 'sync.js', 'manifest.webmanifest',
  'icon-192.png', 'bricolage-grotesque.woff2', 'figtree.woff2', 'spline-sans-mono.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
