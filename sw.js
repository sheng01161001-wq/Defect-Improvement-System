// 缺失改善系統 離線快取。改 index.html 或 data.js 時把版本號 +1。
const CACHE = 'dfi-v4';
const FILES = ['./', './index.html', './data.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 先抓網路拿最新版，沒網路（工地常常沒訊號）才用快取
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // no-cache：每次都跟伺服器確認有沒有新版（避免 index.html 新、data.js 還是舊的）
  // 開網頁（navigate）的請求不能帶設定，改用網址抓
  const req = e.request.mode === 'navigate' ? e.request.url : e.request;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
