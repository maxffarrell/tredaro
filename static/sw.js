// Minimal app-shell service worker: installable PWA + launches offline with the
// last-seen shell. Build assets are content-hashed so they're cached forever;
// navigations go network-first and fall back to the cached shell when offline.
const VERSION = 'v1';
const SHELL = `tredaro-shell-${VERSION}`;
const ASSETS = `tredaro-assets-${VERSION}`;

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(SHELL).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k !== SHELL && k !== ASSETS)
						.map((k) => caches.delete(k))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (e) => {
	const url = new URL(e.request.url);
	if (e.request.method !== 'GET' || url.origin !== location.origin) return;

	// Hashed build assets: immutable, cache-first.
	if (url.pathname.startsWith('/_app/immutable/')) {
		e.respondWith(
			caches.open(ASSETS).then(async (cache) => {
				const hit = await cache.match(e.request);
				if (hit) return hit;
				const res = await fetch(e.request);
				if (res.ok) cache.put(e.request, res.clone());
				return res;
			})
		);
		return;
	}

	// Page navigations: network-first, cached shell as the offline fallback.
	if (e.request.mode === 'navigate') {
		e.respondWith(
			fetch(e.request)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(SHELL).then((c) => c.put(e.request, copy));
					}
					return res;
				})
				.catch(() =>
					caches
						.match(e.request)
						.then((hit) => hit || caches.match('/'))
						.then((hit) => hit || Response.error())
				)
		);
	}
});
