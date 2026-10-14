// 화면 파일만 보관해 와이파이가 잠깐 끊겨도 첫 화면이 열리게 한다. 서버 호출(접수)은 절대 보관하지 않는다.
const CACHE = 'kiosk-shell-v2', FILES = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;     // 다른 주소(서버 호출 포함)는 건드리지 않는다
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
