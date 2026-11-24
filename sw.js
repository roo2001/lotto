// LottoPro v4.0 Service Worker — Network First + 오프라인 캐시 폴백
const CACHE_NAME = 'lottopro-v9';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './wheels.js',
  './app.js',
  './manifest.json',
  './draws.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network First 전략: 온라인일 때는 항상 최신 코드·데이터 반영, 오프라인 시 캐시 폴백
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
