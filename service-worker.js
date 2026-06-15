const CACHE_NAME = 'manul-kaffee-v3';
// Determine base path dynamically for GitHub Pages compatibility
const BASE = self.registration.scope;
const STATIC_ASSETS = [
  '',
  'index.html',
  'css/style.css',
  'js/db.js',
  'js/gemini.js',
  'js/srs.js',
  'js/lesson.js',
  'js/app.js',
  'manifest.json',
  'images/icon-192.png',
  'images/icon-512.png',
  'images/icon-maskable-512.png',
  'data/words.json',
  'data/themes.json',
  'data/demo/lesson1.json',
  'data/demo/lesson2.json',
  'data/demo/lesson3.json'
].map(path => BASE + path);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't cache API calls to Gemini
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('generativelanguage')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });

        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match(BASE + 'index.html');
        }
      });
    })
  );
});
