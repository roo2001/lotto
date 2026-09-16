// LottoPro Service Worker — 오프라인 캐시 + 자동 업데이트
const CACHE_NAME = 'lottopro-v5';
const STATIC_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;600;700;900&family=JetBrains+Mono:wght@400;700&display=swap'
];
const DATA_URL = './draws.json';

// 설치: 정적 파일 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC_CACHE)).then(() => self.skipWaiting())
  );
});

// 활성화: 구 캐시 삭제
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// fetch 전략:
// - draws.json → Network First (항상 최신 데이터 시도, 실패 시 캐시)
// - 나머지   → Cache First (정적 자산은 캐시 우선)
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('draws.json')) {
    // Network First
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // Cache First
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
