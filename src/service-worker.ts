// Cache public immutable assets only. Authenticated HTML never enters Cache Storage.
interface SwLifecycleEvent {
	waitUntil(promise: Promise<unknown>): void;
}

interface SwFetchEvent extends SwLifecycleEvent {
	request: Request;
	respondWith(response: Promise<Response> | Response): void;
}

const sw = self as unknown as {
	addEventListener(type: 'install' | 'activate', cb: (event: SwLifecycleEvent) => void): void;
	addEventListener(type: 'fetch', cb: (event: SwFetchEvent) => void): void;
	skipWaiting(): Promise<void>;
	clients: { claim(): Promise<void> };
};

const ASSETS = 'tredaro-assets-v2';
sw.addEventListener('install', (e) => {
	e.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k.startsWith('tredaro-') && k !== ASSETS).map((k) => caches.delete(k))
				)
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (e) => {
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
		e.respondWith(
			fetch(e.request).catch(
				() =>
					new Response(
						'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Offline</title><h1>You are offline</h1><p>Reconnect to access your workspace.</p></html>',
						{
							status: 503,
							headers: {
								'Content-Type': 'text/html; charset=utf-8',
								'Cache-Control': 'no-store'
							}
						}
					)
			)
		);
	}
});
