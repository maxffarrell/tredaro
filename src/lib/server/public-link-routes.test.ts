import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/env/private', () => ({ BETTER_AUTH_SECRET: 'public-link-test-not-real' }));
const spies = vi.hoisted(() => ({
	select: vi.fn(),
	cancel: vi.fn(),
	reschedule: vi.fn(),
	photo: vi.fn()
}));
vi.mock('#lib/server/db/index.ts', () => ({ db: { select: spies.select } }));
vi.mock('#lib/server/services/jobs.ts', async () => {
	const { verifyPublicToken } = await import('./public-token.ts');
	return {
		verifyBookingCancelToken: (token: string) => verifyPublicToken('cancel', token),
		verifyServiceReportToken: (token: string) => verifyPublicToken('report', token),
		cancelBookedJob: spies.cancel,
		requestReschedule: spies.reschedule
	};
});
vi.mock('#lib/server/services/settings.ts', () => ({ getSettings: vi.fn() }));
vi.mock('#lib/server/services/photos.ts', () => ({ readSharedJobPhoto: spies.photo }));
import { publicToken } from './public-token.ts';
import {
	load as cancelLoad,
	actions as cancelActions
} from '../../routes/book/cancel/[token]/+page.server.ts';
import {
	load as rescheduleLoad,
	actions as rescheduleActions
} from '../../routes/book/reschedule/[token]/+page.server.ts';
import { GET } from '../../routes/r/[token]/photo/[id]/+server.ts';

const id = '00000000-0000-4000-8000-000000000001';
const now = 1_800_000_000_000;
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});
describe('public-link entry points', () => {
	for (const token of ['', 'not-a-token', publicToken('cancel', id, now - 31 * 86400000)]) {
		it('rejects malformed/expired booking links before reads and mutations, even after a previous page load', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(now);
			const event = { params: { token } } as never;
			await expect(cancelLoad(event)).rejects.toMatchObject({ status: 404 });
			await expect(rescheduleLoad(event)).rejects.toMatchObject({ status: 404 });
			expect(await cancelActions.default!(event)).toMatchObject({ status: 404 });
			expect(await rescheduleActions.default!(event)).toMatchObject({ status: 404 });
			expect(spies.select).not.toHaveBeenCalled();
			expect(spies.cancel).not.toHaveBeenCalled();
			expect(spies.reschedule).not.toHaveBeenCalled();
		});
	}
	it('rejects expired and cross-purpose report downloads before file/database access', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
		for (const token of [
			'bad',
			publicToken('report', id, now - 91 * 86400000),
			publicToken('cancel', id, now)
		]) {
			await expect(GET({ params: { token, id } } as never)).rejects.toMatchObject({ status: 404 });
		}
		expect(spies.photo).not.toHaveBeenCalled();
	});
	it('does not cache a shared photo beyond report expiry or unsharing', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
		spies.photo.mockResolvedValueOnce({
			row: { mime: 'image/jpeg', size: 1, fileName: 'test.jpg' },
			bytes: Buffer.from([0])
		});
		const response = await GET({ params: { token: publicToken('report', id, now), id } } as never);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});
});
