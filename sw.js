/**
 * Service Worker for Abstract Painter PWA.
 * Cache-first strategy for all app assets.
 * Works on iOS Safari (14+), Android Chrome, Desktop Chrome.
 *
 * iOS notes:
 *  - SW scope must match the page's origin+path.
 *  - iOS Safari < 16 has limited SW support; the app still works, just without offline.
 *  - Use relative URLs (no leading slash) so the scope is correct on sub-path deployments.
 */

const CACHE_NAME = 'abstract-painter-v2';

// Relative URLs — work regardless of deployment path
const CACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './renderer.js',
  './geometry.js',
  './palette.js',
  './animation.js',
  './export.js',
  './storage.js',
  './manifest.json',
  './assets/icons/192.png',
  './assets/icons/512.png'
];

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Cache install failed:', err))
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  // Only handle GET requests from our origin
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip browser-extension and chrome-extension requests
  if (event.request.url.includes('chrome-extension')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Don't cache bad responses or opaque (cross-origin) responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          // Cache a clone so we can still return the original
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline fallback: return the cached index for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // For other assets, just fail silently
        });
    })
  );
});
