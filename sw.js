/* =====================================================================
 * Curling Team Selector — Service Worker
 *
 * Strategy:
 *   - Network-first for HTML navigations. Users always see the freshest
 *     page on refresh; the cached copy is only used when offline.
 *   - Cache-first for same-origin static assets (CSS, JS, icons, images).
 *   - Cross-origin requests (Ahrefs analytics) are left completely alone.
 *   - Bumping CACHE_VERSION on deploy invalidates every previous cache.
 *
 * Notes:
 *   - No user data is cached (there is no user data — the app never
 *     transmits the roster).
 *   - Registered from app.js, scope "/".
 * ===================================================================== */

const CACHE_VERSION = '2026-07-20-v1';
const CACHE_NAME    = `rinkdraw-${CACHE_VERSION}`;

const PRECACHE = [
    '/',
    '/index.html',
    '/about.html',
    '/404.html',
    '/styles.css',
    '/app.js',
    '/favicon.png',
    '/favicon2.svg',
    '/og-image.png',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-192-maskable.png',
    '/icons/icon-512-maskable.png',
    '/icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // leave analytics alone

    const acceptsHTML = req.mode === 'navigate' ||
                        (req.headers.get('accept') || '').includes('text/html');

    // Network-first for HTML — always try to get the freshest page.
    if (acceptsHTML) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
        );
        return;
    }

    // Cache-first for everything else (CSS/JS/images).
    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req).then((res) => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return res;
        }))
    );
});
