import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const script = readFileSync(new URL('../../../static/sw.js', import.meta.url), 'utf8');
const callbacks = new Map<string, (event: object) => void>();
const cache = { match: vi.fn(), put: vi.fn() };
const cachesMock = { open: vi.fn(), keys: vi.fn(), delete: vi.fn(), match: vi.fn() };
const fetchMock = vi.fn();
beforeEach(() => {
	vi.resetAllMocks();
	callbacks.clear();
	cachesMock.open.mockResolvedValue(cache);
	cachesMock.match.mockResolvedValue(new Response('previous user private record'));
	cachesMock.keys.mockResolvedValue([
		'tredaro-shell-v1',
		'tredaro-assets-v1',
		'tredaro-assets-v2',
		'other-app'
	]);
	runInNewContext(script, {
		self: {
			addEventListener: (name: string, fn: (event: object) => void) => callbacks.set(name, fn),
			skipWaiting: () => Promise.resolve(),
			clients: { claim: () => Promise.resolve() }
		},
		location: { origin: 'https://example.com' },
		URL,
		Response,
		caches: cachesMock,
		fetch: fetchMock
	});
});
function navigation() {
	let response!: Promise<Response>;
	callbacks.get('fetch')!({
		request: { method: 'GET', url: 'https://example.com/customers', mode: 'navigate' },
		respondWith: (r: Promise<Response>) => {
			response = r;
		}
	});
	return response;
}
describe('actual production service worker', () => {
	it('never caches authenticated navigation HTML', async () => {
		fetchMock.mockResolvedValue(new Response('private customer record'));
		expect(await (await navigation()).text()).toBe('private customer record');
		expect(cachesMock.open).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
	});
	it('offline navigation cannot recover previous-user data', async () => {
		fetchMock.mockRejectedValue(new Error('offline'));
		const response = await navigation();
		expect(response.status).toBe(503);
		expect(await response.text()).toContain('Reconnect');
		expect(cachesMock.match).not.toHaveBeenCalled();
	});
	it('purges legacy private caches without deleting another app cache', async () => {
		let completed!: Promise<void>;
		callbacks.get('activate')!({
			waitUntil: (p: Promise<void>) => {
				completed = p;
			}
		});
		await completed;
		expect(cachesMock.delete.mock.calls.map(([key]) => key)).toEqual([
			'tredaro-shell-v1',
			'tredaro-assets-v1'
		]);
	});
	it('preserves offline immutable asset access', async () => {
		cache.match.mockResolvedValue(new Response('asset'));
		let response!: Promise<Response>;
		callbacks.get('fetch')!({
			request: { method: 'GET', url: 'https://example.com/_app/immutable/test.js', mode: 'cors' },
			respondWith: (p: Promise<Response>) => {
				response = p;
			}
		});
		expect(await (await response).text()).toBe('asset');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
