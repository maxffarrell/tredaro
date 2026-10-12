// Cache public immutable assets only. Authenticated HTML never enters Cache Storage.
const ASSETS = 'tredaro-assets-v2';
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k.startsWith('tredaro-') && k !== ASSETS)
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

	// An offline navigation returns a generic page without previous-session data.
	if (e.request.mode === 'navigate') {
		e.respondWith(fetch(e.request).catch(() => new Response(
			'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Offline</title><h1>You are offline</h1><p>Reconnect to access your workspace.</p></html>',
			{ status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
		)));
	}
});
