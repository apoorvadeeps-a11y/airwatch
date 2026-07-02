// Service worker intentionally left empty to clear old caches.
// Any previously installed service worker will be replaced by this no-op version,
// which immediately activates and stops intercepting fetch requests.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  // Delete ALL old caches so stale pages are never served again
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

// No fetch handler — browser will always go to the network
