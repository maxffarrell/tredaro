import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { lt, sql } from 'drizzle-orm';
import type { DB } from './db/index.ts';
import { publicSubmissionLimit } from './db/schema.ts';

export function waitlistContact(input: { email?: string; phone?: string }) {
	const email = (input.email ?? '').trim().toLowerCase();
	const phone = (input.phone ?? '').trim();
	if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
		error(400, 'Invalid email');
	if (phone && (phone.length > 40 || !/^\+?[0-9() .-]+$/.test(phone))) error(400, 'Invalid phone');
	const digits = phone.replace(/\D/g, '');
	if (phone && (digits.length < 7 || digits.length > 15)) error(400, 'Invalid phone');
	if (!email && !phone) error(400, 'Leave a way to reach you');
	// Local 10-digit US numbers and their +1 spelling identify the same destination.
	const phoneKey = digits.length === 10 ? `1${digits}` : digits;
	return {
		email,
		phone,
		destinations: [email && `email:${email}`, phoneKey && `phone:${phoneKey}`].filter(
			(s): s is string => !!s
		)
	};
}

/** Caller must keep quota consumption and insertion in the same database transaction. */
export async function consumeWaitlistLimits(
	tx: Pick<DB, 'insert' | 'delete'>,
	orgId: string,
	ip: string,
	destinations: string[],
	now = Date.now()
) {
	const hour = 3600_000,
		day = 86400_000;
	const buckets: [string, number, number][] = [
		[`ip:${ip}`, hour, 10],
		[`org:${orgId}`, hour, 10],
		[`org:${orgId}`, day, 100],
		...destinations.flatMap((d): [string, number, number][] => [
			[`destination:${d}`, day, 3],
			[`org:${orgId}:${d}`, day, 1]
		])
	];
	await tx.delete(publicSubmissionLimit).where(lt(publicSubmissionLimit.expiresAt, new Date(now)));
	// Deterministic order prevents deadlocks when a signup consumes shared contact buckets.
	const sorted = buckets
		.map(([identity, window, cap]) => ({
			key: createHash('sha256')
				.update(`${identity}:${window}:${Math.floor(now / window)}`)
				.digest('hex'),
			cap,
			expiresAt: new Date((Math.floor(now / window) + 1) * window)
		}))
		.sort((a, b) => a.key.localeCompare(b.key));
	for (const { key, cap, expiresAt } of sorted) {
		const rows = await tx
			.insert(publicSubmissionLimit)
			.values({ key, hits: 1, expiresAt })
			.onConflictDoUpdate({
				target: publicSubmissionLimit.key,
				set: { hits: sql`${publicSubmissionLimit.hits} + 1` },
				setWhere: sql`${publicSubmissionLimit.hits} < ${cap}`
			})
			.returning({ key: publicSubmissionLimit.key });
		if (!rows.length) error(429, 'Too many attempts — try again later');
	}
}
