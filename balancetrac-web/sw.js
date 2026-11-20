/**
 * sw.js – Offline-First Service Worker für BalanceTrac (Cache-First).
 *
 * Nach dem ersten Aufruf liegen alle App-Dateien im Cache; die App startet danach
 * vollständig offline. Bei jeder Änderung an App-Dateien APP_VERSION erhöhen
 * (gleicher Wert wie in js/config.js) – dann wird der Cache neu aufgebaut.
 */

const APP_VERSION = '1.0.0';
const CACHE_PREFIX = 'balancetrac-';
const CACHE_NAME = `${CACHE_PREFIX}v${APP_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './js/main.js',
  './js/config.js',
  './js/i18n.js',
  './js/icons.js',
  './js/sensorMath.js',
  './js/sensor.js',
  './js/audio.js',
  './js/storage.js',
  './js/scoring.js',
  './js/exercises.js',
  './js/activities.js',
  './js/historyAggregator.js',
  './js/trainPlanner.js',
  './js/views/ui.js',
  './js/views/canvasKit.js',
  './js/views/homeView.js',
  './js/views/diagnosticsView.js',
  './js/views/simulatorOverlay.js',
  './js/views/exerciseRunner.js',
  './js/views/measureView.js',
  './js/views/historyView.js',
  './js/views/settingsView.js',
  './js/views/playView.js',
  './js/views/trainView.js',
  './js/games/gameEngine.js',
  './js/games/mazeData.js',
  './js/games/labyrinth.js',
  './js/games/astroGuard.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const isNavigation = request.mode === 'navigate';
      const cached = await cache.match(request, { ignoreSearch: isNavigation });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        if (isNavigation) {
          const fallback = (await cache.match('./index.html')) ?? (await cache.match('./'));
          if (fallback) return fallback;
        }
        throw error;
      }
    })(),
  );
});
