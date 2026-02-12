
const CACHE_NAME = 'jira-voice-v6';

// Clear all caches to prevent caching (as requested)
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('Service Worker: Deleting cache', cacheName);
                    return caches.delete(cacheName);
                })
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('Service Worker: Deleting cache', cacheName);
                    return caches.delete(cacheName);
                })
            );
        })
    );
    self.clients.claim();
});

// Always fetch from network (no caching)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request.clone()).then((response) => {
            // Add no-cache headers to response
            const modifiedResponse = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                    ...Object.fromEntries(response.headers.entries()),
                    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });
            return modifiedResponse;
        }).catch(() => {
            // Fallback for offline - return a basic response
            return new Response('Offline - Please check your connection', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
            });
        })
    );
});
