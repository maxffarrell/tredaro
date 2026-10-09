import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import type { OrgContext } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	companySettings,
	customer,
	customerDocument,
	equipment,
	agreementPlan,
	estimate,
	invoice,
	invoiceItem,
	job,
	payment,
	serviceAgreement,
	followUp,
	jobType,
	jobTimeEntry,
	notificationLog,
	organization,
	inventoryItem,
	smsOutbox
} from '#lib/server/db/schema.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import { emit } from './events.ts';
import { appOrigin, sendEmail } from '#lib/server/email.ts';
import { sendSms, smsProvider } from '#lib/server/sms.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { estimateUrl, expireEstimates } from './estimates.ts';
import { bookingCancelUrl, serviceReportUrl } from './jobs.ts';
import { invoiceUrl } from './billing.ts';
import { addDays, localDate, localTime, zonedToUtc } from '#lib/tz.ts';
import { formatDate, formatMoney } from '#lib/format.ts';

async function orgName(orgId: string) {
	const [o] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, orgId));
	return o?.name ?? 'your service company';
}

async function orgCurrencyOf(orgId: string) {
	const [s] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	return s?.currency ?? 'usd';
}

/**
 * sendSms honoring quiet hours: between 21:00 and 08:00 (org timezone) the text
 * is parked in sms_outbox for the cron's flushSmsOutbox at the next 8am instead
 * of hitting the customer's phone overnight.
 */
export async function sendSmsQuiet(orgId: string, msg: { to: string; body: string }) {
	const tz = await orgTimezone(orgId);
	const now = new Date();
	const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
	const hour = localNow.getHours();
	if (hour >= 21 || hour < 8) {
		const offset = localNow.getTime() - now.getTime();
		const next = new Date(localNow);
		next.setHours(8, 0, 0, 0);
		if (next.getTime() <= localNow.getTime()) next.setDate(next.getDate() + 1);
		await db.insert(smsOutbox).values({
			organizationId: orgId,
			to: msg.to,
			body: msg.body,
			sendAfter: new Date(next.getTime() - offset)
		});
		return;
	}
	await sendSms(msg);
}

/** Auto-acknowledgement when a customer texts in — once per customer per day. */
export async function ackInboundSms(orgId: string, customerId: string, to: string) {
	const day = new Date().toISOString().slice(0, 10);
	if (!(await logOnce(orgId, 'inbound_sms_ack', `${customerId}:${day}`, to))) return;
	const name = await orgName(orgId);
	await sendSmsQuiet(orgId, {
		to,
		body: `${name}: thanks — we got your message and will be in touch shortly.`
	});
}

/** Reply text when a customer confirms a visit by SMS. */
export async function ackConfirmSms(orgId: string, to: string, startsAt: Date | null) {
	const name = await orgName(orgId);
	const when = startsAt
		? new Date(startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
		: 'as scheduled';
	await sendSmsQuiet(orgId, {
		to,
		body: `${name}: confirmed — we'll see you ${when}.`
	});
}

/** Reply text when a customer rates a visit by SMS. */
export async function ackRatingSms(orgId: string, to: string, rating: number) {
	const name = await orgName(orgId);
	await sendSmsQuiet(orgId, {
		to,
		body: `${name}: thanks for the ${rating}/5 — we appreciate the feedback.`
	});
}

/** Delivers queued texts whose quiet-hours window has passed (called from runReminders). */
export async function flushSmsOutbox(orgId: string) {
	const due = await db
		.select()
		.from(smsOutbox)
		.where(
			and(
				eq(smsOutbox.organizationId, orgId),
				sql`${smsOutbox.sentAt} is null`,
				lte(smsOutbox.sendAfter, new Date())
			)
		);
	for (const m of due) {
		try {
			const sid = await sendSms({ to: m.to, body: m.body });
			await db
				.update(smsOutbox)
				.set({ sentAt: new Date(), providerSid: sid, status: 'sent' })
				.where(eq(smsOutbox.id, m.id));
		} catch (err) {
			console.error('sms outbox send failed', m.id, err);
			await db
				.update(smsOutbox)
				.set({ sentAt: new Date(), status: 'failed', statusDetail: String(err).slice(0, 500) })
				.where(eq(smsOutbox.id, m.id));
		}
	}
}

async function orgTimezone(orgId: string) {
	const [s] = await db
		.select({ timezone: companySettings.timezone })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	return s?.timezone ?? 'UTC';
}

/** Writes one notification_log row per (kind, entity, recipient), so repeats are no-ops. */
async function logOnce(orgId: string, kind: string, entityId: string, recipient: string) {
	const [row] = await db
		.insert(notificationLog)
		.values({ organizationId: orgId, kind, entityId, recipient })
		.onConflictDoNothing()
		.returning();
	return !!row;
}

/** Inbox rows for members whose time was approved for payroll (quiet — no email). */
export async function notifyTimeApproved(
	orgId: string,
	entryIds: string[],
	approverUserId: string
) {
	if (!entryIds.length) return;
	const rows = await db
		.select({
			jobId: jobTimeEntry.jobId,
			memberUserId: member.userId,
			email: user.email
		})
		.from(jobTimeEntry)
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(inArray(jobTimeEntry.id, entryIds));
	for (const r of rows) {
		// Approving your own time (admin techs) doesn't need a ping.
		if (!r.email || r.memberUserId === approverUserId) continue;
		// entityId = the job so the inbox link opens the job the time belongs to.
		await logOnce(orgId, 'time_approved', r.jobId, r.email);
	}
}

/** Emails of owner/admin members — recipients of staff-facing alerts. */
async function adminEmails(orgId: string) {
	const rows = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(member.organizationId, orgId),
				inArray(member.role, ['owner', 'admin']),
				eq(member.staffAlerts, true)
			)
		);
	return rows.map((r) => r.email).filter((e): e is string => !!e);
}

async function notifFlags(orgId: string) {
	const [s] = await db
		.select({
			email: companySettings.emailNotifications,
			sms: companySettings.smsNotifications,
			digest: companySettings.staffDigest
		})
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	return { email: s?.email ?? true, sms: s?.sms ?? true, digest: s?.digest ?? true };
}

/** "Your estimate is ready" with the approve/decline link. */
export async function notifyEstimateSent(orgId: string, estimateId: string) {
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			phone: customer.phone,
			customerName: customer.name,
			number: estimate.number,
			total:
				sql`coalesce((select sum(i.qty * i.unit_price) from estimate_item i where i.estimate_id = ${estimate.id}), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if ((!row.email || row.emailOptOut) && (!row.phone || row.smsOptOut || !smsProvider())) return;
	const name = await orgName(orgId);
	if (
		row.phone &&
		!row.smsOptOut &&
		smsProvider() &&
		(await logOnce(orgId, 'estimate_sent_sms', estimateId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: estimate E-${row.number} for ${formatMoney(row.total)} — review and approve: ${estimateUrl(estimateId)}`
		});
	if (!row?.email || row.emailOptOut) return;
	if (!(await logOnce(orgId, 'estimate_sent', estimateId, row.email))) return;
	await sendEmail({
		to: row.email,
		subject: `Estimate E-${row.number} from ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Your estimate is ready, ${row.customerName}`,
			lines: [
				`${name} sent you estimate E-${row.number} for ${formatMoney(row.total)}.`,
				'Open it to review the work and approve or decline online.'
			],
			action: { label: 'Review estimate', url: estimateUrl(estimateId) }
		})
	});
}

/** Re-send of an already-sent estimate — dedupes per resend (sentAt timestamp in entityId). */
export async function notifyEstimateResent(orgId: string, estimateId: string) {
	const flags = await notifFlags(orgId);
	const name = await orgName(orgId);
	const stamp = `${estimateId}:${Date.now()}`;
	const [row] = await db
		.select({
			number: estimate.number,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from estimate_item i where i.estimate_id = ${estimate.id}), 0)`.mapWith(
					Number
				),
			email: customer.email,
			phone: customer.phone,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			customerName: customer.name
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row) return;
	if (
		flags.sms &&
		row.phone &&
		!row.smsOptOut &&
		smsProvider() &&
		(await logOnce(orgId, 'estimate_resent_sms', stamp, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: reminder — estimate E-${row.number} for ${formatMoney(row.total)} is waiting for your answer: ${estimateUrl(estimateId)}`
		});
	if (!flags.email || !row.email || row.emailOptOut) return;
	if (!(await logOnce(orgId, 'estimate_resent', stamp, row.email))) return;
	await sendEmail({
		to: row.email,
		subject: `Reminder — estimate E-${row.number} from ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Just checking in, ${row.customerName}`,
			lines: [
				`${name} is still waiting on your answer for estimate E-${row.number} (${formatMoney(row.total)}).`,
				'Open it to review the work and approve or decline online.'
			],
			action: { label: 'Review estimate', url: estimateUrl(estimateId) }
		})
	});
}

/** "We got your request" after a public /book submission creates the job. */
export async function notifyBookingReceived(orgId: string, jobId: string) {
	if (!(await notifFlags(orgId)).email) return;
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			customerName: customer.name,
			summary: job.summary,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row?.email || row.emailOptOut) return;
	if (!(await logOnce(orgId, 'booking_received', jobId, row.email))) return;
	const name = await orgName(orgId);
	await sendEmail({
		to: row.email,
		subject: `Request received — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `We got your request, ${row.customerName}`,
			lines: [
				`Thanks for reaching out about ${row.jobTypeName ?? row.summary}.`,
				'A dispatcher will contact you shortly to confirm a time.'
			],
			action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` },
			secondary: { label: 'Need to cancel? Click here', url: bookingCancelUrl(jobId) }
		})
	});
}

/** Customer cancelled a booking via the emailed link — alert staff (digest toggle gates). */
export async function notifyBookingCancelled(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({
			customerName: customer.name,
			phone: customer.phone,
			jobTypeName: jobType.name,
			summary: job.summary,
			number: job.number
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'booking_cancelled', jobId, email))) continue;
		await sendEmail({
			to: email,
			subject: `Booking cancelled — ${row.customerName} (${name})`,
			...renderEmail({
				orgName: name,
				heading: `${row.customerName} cancelled J-${row.number}`,
				lines: [
					`${row.jobTypeName ?? row.summary} was cancelled via the booking link.`,
					row.phone ? `Phone: ${row.phone}` : 'No phone on file.'
				],
				action: { label: 'Open dispatch', url: `${appOrigin()}/dispatch` }
			})
		});
	}
}

/** Text receipt of an online booking — complements the confirmation email. */
export async function notifyBookingConfirmationSms(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			phone: customer.phone,
			smsOptOut: customer.smsOptOut,
			number: job.number
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(eq(job.id, jobId));
	if (!row?.phone || row.smsOptOut || !flags.sms || !smsProvider()) return;
	if (!(await logOnce(orgId, 'booking_sms', jobId, row.phone))) return;
	const name = await orgName(orgId);
	await sendSmsQuiet(orgId, {
		to: row.phone,
		body: `${name}: we received your request J-${row.number} — we'll confirm a time shortly.`
	});
}

/** "Your invoice is ready" with the public pay link. Returns whether an email was sent. */
export async function notifyInvoiceSent(orgId: string, invoiceId: string) {
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			customerName: customer.name,
			number: invoice.number,
			dueDate: invoice.dueDate,
			status: invoice.status,
			total:
				sql`coalesce((select sum(i.qty * i.unit_price) from invoice_item i where i.invoice_id = ${invoice.id}), 0)`.mapWith(
					Number
				)
		})
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.where(eq(invoice.id, invoiceId));
	if (!row?.email || row.emailOptOut || row.status !== 'open') return false;
	if (!(await logOnce(orgId, 'invoice_sent', invoiceId, row.email))) return false;
	const name = await orgName(orgId);
	await sendEmail({
		to: row.email,
		subject: `Invoice INV-${row.number} from ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Invoice INV-${row.number} for ${formatMoney(row.total)}`,
			lines: [
				`${name} issued you an invoice for ${formatMoney(row.total)}, due ${row.dueDate}.`,
				'Open it to review the charges and pay online.'
			],
			action: { label: 'View and pay invoice', url: invoiceUrl(invoiceId) }
		})
	});
	return true;
}

/** Texts the customer their invoice's public pay link (manual "Text" button — not gated on notification toggles). */
export async function notifyInvoiceTexted(orgId: string, invoiceId: string) {
	if (!smsProvider()) return false;
	const [row] = await db
		.select({
			phone: customer.phone,
			smsOptOut: customer.smsOptOut,
			number: invoice.number,
			status: invoice.status,
			total:
				sql`coalesce((select sum(i.qty * i.unit_price) from invoice_item i where i.invoice_id = ${invoice.id}), 0)`.mapWith(
					Number
				)
		})
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.where(eq(invoice.id, invoiceId));
	if (!row?.phone || row.smsOptOut || row.status !== 'open') return false;
	if (!(await logOnce(orgId, 'invoice_texted', invoiceId, row.phone))) return false;
	const name = await orgName(orgId);
	await sendSmsQuiet(orgId, {
		to: row.phone,
		body: `${name}: invoice INV-${row.number} for ${formatMoney(row.total)} — view and pay: ${invoiceUrl(invoiceId)}`
	});
	return true;
}

/**
 * Manual free-text SMS to a customer from the Communications card.
 * Honors smsOptOut + the configured provider (like other manual sends) but not
 * the org's auto-notification toggles. Logged with a per-send entity key so
 * repeat texts all land in the comms history.
 */
export async function textCustomer(ctx: OrgContext, customerId: string, message: string) {
	if (!smsProvider()) error(400, 'No SMS provider configured');
	const [c] = await db
		.select({ name: customer.name, phone: customer.phone, smsOptOut: customer.smsOptOut })
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, customerId)));
	if (!c) error(404, 'Customer not found');
	if (!c.phone) error(400, 'Customer has no phone number');
	if (c.smsOptOut) error(409, 'Customer has opted out of texts');
	const name = await orgName(ctx.orgId);
	await sendSmsQuiet(ctx.orgId, { to: c.phone, body: `${name}: ${message}` });
	await db
		.insert(notificationLog)
		.values({
			organizationId: ctx.orgId,
			kind: 'manual_sms',
			entityId: `${customerId}:${Date.now()}`,
			recipient: c.phone
		})
		.onConflictDoNothing();
}

/** One-tap "we're ~N min out" text from a job page. Manual send, honors opt-out + provider. */
export async function textJobEta(ctx: OrgContext, jobId: string, minutes: number) {
	if (!smsProvider()) error(400, 'No SMS provider configured');
	const [row] = await db
		.select({
			phone: customer.phone,
			smsOptOut: customer.smsOptOut,
			number: job.number
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!row) error(404, 'Job not found');
	if (!row.phone) error(400, 'Customer has no phone number');
	if (row.smsOptOut) error(409, 'Customer has opted out of texts');
	const name = await orgName(ctx.orgId);
	await sendSmsQuiet(ctx.orgId, {
		to: row.phone,
		body: `${name}: we're on our way to job J-${row.number} — about ${minutes} min out.`
	});
	await db
		.insert(notificationLog)
		.values({
			organizationId: ctx.orgId,
			kind: 'job_eta_sms',
			entityId: `${jobId}:${Date.now()}`,
			recipient: row.phone
		})
		.onConflictDoNothing();
}

/** Bulk "we'll see you today" texts for scheduled/dispatched jobs starting on `dayStr`. */
export async function textDayEtas(ctx: OrgContext, dayStr: string) {
	if (!smsProvider()) error(400, 'No SMS provider configured');
	const tz = await orgTimezone(ctx.orgId);
	const from = zonedToUtc(`${dayStr}T00:00:00`, tz);
	const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
	const rows = await db
		.select({
			jobId: job.id,
			number: job.number,
			startsAt: job.startsAt,
			phone: customer.phone,
			smsOptOut: customer.smsOptOut,
			techName: user.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(job.organizationId, ctx.orgId),
				inArray(job.status, ['scheduled', 'dispatched']),
				gte(job.startsAt, from),
				lt(job.startsAt, to)
			)
		);
	const name = await orgName(ctx.orgId);
	let sent = 0;
	let skipped = 0;
	for (const row of rows) {
		if (
			!row.phone ||
			row.smsOptOut ||
			!(await logOnce(ctx.orgId, 'day_eta_sms', `${row.jobId}:${dayStr}`, row.phone))
		) {
			skipped++;
			continue;
		}
		const when = row.startsAt ? localTime(row.startsAt, tz) : 'sometime today';
		const who = row.techName ? `${row.techName} will see` : `we'll see`;
		await sendSmsQuiet(ctx.orgId, {
			to: row.phone,
			body: `${name}: ${who} you today${row.startsAt ? ` around ${when}` : ''} for job J-${row.number}.`
		});
		sent++;
	}
	return { sent, skipped };
}

/** Emails the customer a statement of open charges with a portal link. */
export async function emailStatement(ctx: OrgContext, customerId: string) {
	const [c] = await db
		.select({ name: customer.name, email: customer.email, emailOptOut: customer.emailOptOut })
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, customerId)));
	if (!c) error(404, 'Customer not found');
	if (!c.email) error(400, 'Customer has no email address');
	if (c.emailOptOut) error(409, 'Customer has opted out of emails');
	const rows = await db
		.select({
			description: charge.description,
			dueDate: charge.dueDate,
			balance:
				sql<number>`${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${charge.id}), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, ctx.orgId),
				eq(charge.customerId, customerId),
				eq(charge.status, 'open')
			)
		)
		.orderBy(asc(charge.dueDate));
	if (!rows.length) error(400, 'Nothing owed — no open charges');
	const total = rows.reduce((s, r) => s + r.balance, 0);
	const name = await orgName(ctx.orgId);
	const currency = await orgCurrencyOf(ctx.orgId);
	await sendEmail({
		to: c.email,
		subject: `Your statement from ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Your statement, ${c.name}`,
			lines: [
				...rows.map(
					(r) =>
						`${r.description ?? 'Charge'} — ${formatMoney(r.balance, currency)} due ${r.dueDate}`
				),
				`Total due: ${formatMoney(total, currency)}. Pay online any time from your portal.`
			],
			action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
		})
	});
	await db
		.insert(notificationLog)
		.values({
			organizationId: ctx.orgId,
			kind: 'statement',
			entityId: `${customerId}:${Date.now()}`,
			recipient: c.email
		})
		.onConflictDoNothing();
}

/** "Your job is scheduled" once a job gets a start time. Emails and/or texts the customer. */
export async function notifyJobScheduled(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			contactPref: customer.contactPref,
			phone: customer.phone,
			customerName: customer.name,
			summary: job.summary,
			number: job.number,
			startsAt: job.startsAt,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row?.startsAt || (!row.email && !row.phone)) return;
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const what = row.jobTypeName ?? row.summary;
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	// Preferred-channel routing: an sms/email preference suppresses the other
	// channel unless it's the only one that can reach the customer.
	const smsOk = !!row.phone && !row.smsOptOut && flags.sms && !!smsProvider();
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
		(row.contactPref !== 'sms' || !smsOk) &&
		(await logOnce(orgId, 'job_scheduled', jobId, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Job J-${row.number} scheduled — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Your appointment is booked, ${row.customerName}`,
				lines: [
					`${what} is scheduled for ${when}.`,
					'Reply to this email if you need to reschedule.'
				],
				action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
			})
		});
	if (
		row.phone &&
		!row.smsOptOut &&
		flags.sms &&
		smsProvider() &&
		row.contactPref !== 'email' &&
		(await logOnce(orgId, 'job_scheduled_sms', jobId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: ${what} is scheduled for ${when}. Reply to reschedule.`
		});
}

/** Customer-facing reschedule notice — emails/texts the new slot (re-armed per start time). */
export async function notifyJobRescheduledCustomer(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			contactPref: customer.contactPref,
			phone: customer.phone,
			customerName: customer.name,
			summary: job.summary,
			number: job.number,
			startsAt: job.startsAt,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row?.startsAt || (!row.email && !row.phone)) return;
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const what = row.jobTypeName ?? row.summary;
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	// Per-move dedupe: a different new start time re-arms the notification.
	const once = `${jobId}:${row.startsAt.getTime()}`;
	const smsOk = !!row.phone && !row.smsOptOut && flags.sms && !!smsProvider();
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
		(row.contactPref !== 'sms' || !smsOk) &&
		(await logOnce(orgId, 'job_rescheduled', once, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Job J-${row.number} moved — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Your appointment moved, ${row.customerName}`,
				lines: [
					`${what} is now scheduled for ${when}.`,
					'Reply to this email if the new time does not work.'
				],
				action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
			})
		});
	if (
		row.phone &&
		!row.smsOptOut &&
		flags.sms &&
		smsProvider() &&
		row.contactPref !== 'email' &&
		(await logOnce(orgId, 'job_rescheduled_sms', once, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: ${what} moved to ${when}. Reply if that doesn't work.`
		});
}

/** Scheduled job cancelled by staff — tell the customer the visit is off. */
export async function notifyJobCancelled(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			contactPref: customer.contactPref,
			phone: customer.phone,
			customerName: customer.name,
			summary: job.summary,
			number: job.number,
			startsAt: job.startsAt,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row?.startsAt || (!row.email && !row.phone)) return;
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const what = row.jobTypeName ?? row.summary;
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	const smsOk = !!row.phone && !row.smsOptOut && flags.sms && !!smsProvider();
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
		(row.contactPref !== 'sms' || !smsOk) &&
		(await logOnce(orgId, 'job_cancelled', jobId, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Job J-${row.number} cancelled — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Your appointment was cancelled, ${row.customerName}`,
				lines: [
					`${what} on ${when} has been cancelled.`,
					'Reply to this email or visit the portal to pick a new time.'
				],
				action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
			})
		});
	if (
		row.phone &&
		!row.smsOptOut &&
		flags.sms &&
		smsProvider() &&
		row.contactPref !== 'email' &&
		(await logOnce(orgId, 'job_cancelled_sms', jobId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: ${what} on ${when} was cancelled. Reply to reschedule.`
		});
}

/** "Reminder: appointment tomorrow-ish" — one email + text per job, cron-driven. */
export async function notifyAppointmentReminder(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			contactPref: customer.contactPref,
			phone: customer.phone,
			customerName: customer.name,
			summary: job.summary,
			number: job.number,
			startsAt: job.startsAt,
			status: job.status,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (
		!row?.startsAt ||
		(row.status !== 'scheduled' && row.status !== 'dispatched') ||
		(!row.email && !row.phone)
	)
		return;
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const what = row.jobTypeName ?? row.summary;
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	const smsOk = !!row.phone && !row.smsOptOut && flags.sms && !!smsProvider();
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
		(row.contactPref !== 'sms' || !smsOk) &&
		(await logOnce(orgId, 'appointment_reminder', jobId, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Reminder: J-${row.number} ${when} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Just a reminder, ${row.customerName}`,
				lines: [
					`Your ${what} appointment is coming up on ${when}.`,
					'Reply to this email if you need to reschedule.'
				],
				action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
			})
		});
	if (
		row.phone &&
		!row.smsOptOut &&
		flags.sms &&
		smsProvider() &&
		row.contactPref !== 'email' &&
		(await logOnce(orgId, 'appointment_reminder_sms', jobId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name} reminder: ${what} on ${when}. Reply to reschedule.`
		});
}

/** "Still interested?" email + SMS when a sent estimate has sat untouched for a week. */
export async function notifyEstimateFollowup(orgId: string, estimateId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			phone: customer.phone,
			smsOptOut: customer.smsOptOut,
			customerName: customer.name,
			number: estimate.number,
			status: estimate.status,
			total:
				sql`coalesce((select sum(i.qty * i.unit_price) from estimate_item i where i.estimate_id = ${estimate.id}), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row || row.status !== 'sent') return;
	const name = await orgName(orgId);
	if (
		flags.email &&
		row.email &&
		!row.emailOptOut &&
		(await logOnce(orgId, 'estimate_followup', estimateId, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Following up on estimate E-${row.number} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Still interested, ${row.customerName}?`,
				lines: [
					`${name} sent you estimate E-${row.number} for ${formatMoney(row.total)} and it's still open.`,
					"Approve or decline it online whenever you're ready."
				],
				action: { label: 'Review estimate', url: estimateUrl(estimateId) }
			})
		});
	if (
		flags.sms &&
		row.phone &&
		!row.smsOptOut &&
		smsProvider() &&
		(await logOnce(orgId, 'estimate_followup_sms', estimateId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: estimate E-${row.number} for ${formatMoney(row.total)} is still open. Review it here: ${estimateUrl(estimateId)}`
		});
}

/** Heads-up to the customer when a sent estimate is about to hit its valid-until date. */
export async function notifyEstimateExpiring(orgId: string, estimateId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			customerName: customer.name,
			number: estimate.number,
			status: estimate.status,
			validUntil: estimate.validUntil,
			total:
				sql`coalesce((select sum(i.qty * i.unit_price) from estimate_item i where i.estimate_id = ${estimate.id}), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row || row.status !== 'sent' || !row.validUntil) return;
	const name = await orgName(orgId);
	if (
		flags.email &&
		row.email &&
		!row.emailOptOut &&
		(await logOnce(orgId, 'estimate_expiring', estimateId, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Estimate E-${row.number} expires ${formatDate(row.validUntil)} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Last chance, ${row.customerName}`,
				lines: [
					`${name}'s estimate E-${row.number} for ${formatMoney(row.total)} expires on ${formatDate(row.validUntil)}.`,
					'Approve it online before then to lock in the price.'
				],
				action: { label: 'Review estimate', url: estimateUrl(estimateId) }
			})
		});
}

/** "Invoice INV-n is past due" — at 3 and 10 days overdue, deduped per stage. */
export async function notifyInvoiceOverdue(orgId: string, invoiceId: string, stage: number) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			phone: customer.phone,
			customerName: customer.name,
			number: invoice.number,
			dueDate: invoice.dueDate,
			status: invoice.status,
			total:
				sql`coalesce((select sum(i.qty * i.unit_price) from invoice_item i where i.invoice_id = ${invoice.id}), 0)`.mapWith(
					Number
				),
			paid: sql`coalesce((select sum(p.amount) from payment p join charge c on p.charge_id = c.id where c.invoice_id = ${invoice.id}), 0)`.mapWith(
				Number
			)
		})
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.where(eq(invoice.id, invoiceId));
	const balance = row ? row.total - row.paid : 0;
	if (!row || row.status !== 'open' || balance <= 0) return;
	const name = await orgName(orgId);
	if (
		flags.sms &&
		row.phone &&
		!row.smsOptOut &&
		smsProvider() &&
		(await logOnce(orgId, `invoice_overdue_sms_${stage}`, invoiceId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: invoice INV-${row.number} for ${formatMoney(balance)} was due ${row.dueDate} and is still open. Pay online: ${invoiceUrl(invoiceId)}`
		});
	if (!flags.email || !row.email || row.emailOptOut) return;
	if (!(await logOnce(orgId, `invoice_overdue_${stage}`, invoiceId, row.email))) return;
	await sendEmail({
		to: row.email,
		subject: `Invoice INV-${row.number} is past due — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Friendly reminder, ${row.customerName}`,
			lines: [
				`Invoice INV-${row.number} for ${formatMoney(balance)} was due ${row.dueDate} and is still open.`,
				'You can pay it online in a couple of minutes.'
			],
			action: { label: 'Pay invoice', url: invoiceUrl(invoiceId) }
		})
	});
}

/** Daily cron work: appointment reminders, stale-estimate follow-ups, staff schedule digests. */
/**
 * Monday-morning owner/admin digest: last week's completions + collections,
 * open receivables, and the coming week's scheduled work. Runs inside the daily
 * cron; skips itself on any non-Monday in the org timezone and dedupes per week.
 */
export async function runWeeklyDigest(orgId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const tz = await orgTimezone(orgId);
	const today = localDate(new Date(), tz);
	// Weekday of the local date (noon UTC avoids any DST edge).
	if (new Date(`${today}T12:00:00Z`).getUTCDay() !== 1) return;

	const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
	const nextWeek = new Date(Date.now() + 7 * 24 * 3600_000);

	const [done] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(eq(job.organizationId, orgId), eq(job.status, 'done'), gte(job.completedAt, weekAgo))
		);
	const [collected] = await db
		.select({ total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number) })
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), gte(payment.createdAt, weekAgo)));
	const [receivables] = await db
		.select({ total: sql<number>`coalesce(sum(${charge.amount}), 0)`.mapWith(Number) })
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.status, 'open')));
	const [upcoming] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				gte(job.startsAt, new Date()),
				lt(job.startsAt, nextWeek),
				inArray(job.status, ['scheduled', 'dispatched', 'in_progress'])
			)
		);
	// Finished-but-unapproved time still sitting in the payroll queue.
	const [payroll] = await db
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			minutes:
				sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60), 0)`.mapWith(
					Number
				)
		})
		.from(jobTimeEntry)
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				isNotNull(jobTimeEntry.endedAt),
				isNull(jobTimeEntry.approvedAt)
			)
		);
	const pendingMin = Math.round(payroll?.minutes ?? 0);
	const payrollLine =
		(payroll?.n ?? 0) > 0
			? `${payroll!.n} time entr${payroll!.n === 1 ? 'y' : 'ies'} (${Math.floor(pendingMin / 60)}h${pendingMin % 60 ? ` ${pendingMin % 60}m` : ''}) awaiting payroll approval.`
			: null;

	const cur = await orgCurrencyOf(orgId);
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'weekly_digest', today, email))) continue;
		await sendEmail({
			to: email,
			subject: `Week of ${today} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Your week in review`,
				lines: [
					`${done?.n ?? 0} job(s) completed in the last 7 days.`,
					`${formatMoney(collected?.total ?? 0, cur)} collected in the last 7 days.`,
					`${formatMoney(receivables?.total ?? 0, cur)} still open in receivables.`,
					`${upcoming?.n ?? 0} job(s) scheduled in the next 7 days.`,
					...(payrollLine ? [payrollLine] : [])
				],
				action: payrollLine
					? { label: 'Review payroll', url: `${appOrigin()}/payroll` }
					: { label: 'Open dashboard', url: `${appOrigin()}/dashboard` }
			})
		});
	}
}

/** Emails the customer a "payment due soon" nudge for a standalone charge
 * (installments, manual charges) whose due date is within the reminder window.
 * Invoice-linked charges are covered by the invoice reminders instead. */
export async function notifyChargeDueSoon(orgId: string, chargeId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.email) return;
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			customerName: customer.name,
			description: charge.description,
			dueDate: charge.dueDate,
			status: charge.status,
			invoiceId: charge.invoiceId,
			balance:
				sql<number>`${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${charge.id}), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.innerJoin(customer, eq(charge.customerId, customer.id))
		.where(eq(charge.id, chargeId));
	if (!row || row.status !== 'open' || row.balance <= 0 || row.invoiceId) return;
	if (!row.email || row.emailOptOut) return;
	if (!(await logOnce(orgId, 'charge_due_soon', chargeId, row.email))) return;
	const name = await orgName(orgId);
	const currency = await orgCurrencyOf(orgId);
	await sendEmail({
		to: row.email,
		subject: `Payment of ${formatMoney(row.balance, currency)} due ${row.dueDate} — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Heads up, ${row.customerName}`,
			lines: [
				`${row.description ?? 'A charge'} — ${formatMoney(row.balance, currency)} — is due on ${row.dueDate}.`,
				'You can pay it online any time from your customer portal.'
			],
			action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * 1st-of-month statements: customers with an open balance get their statement
 * email (deduped per customer+month). Runs inside the daily cron.
 */
export async function runMonthlyStatements(orgId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.email) return;
	const tz = await orgTimezone(orgId);
	const today = localDate(new Date(), tz);
	if (!today.endsWith('-01')) return;
	const month = today.slice(0, 7);

	const balances = await db
		.select({
			customerId: charge.customerId,
			email: customer.email,
			total: sql<number>`coalesce(sum(${charge.amount}), 0)`.mapWith(Number)
		})
		.from(charge)
		.innerJoin(customer, eq(charge.customerId, customer.id))
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.status, 'open'),
				eq(customer.emailOptOut, false)
			)
		)
		.groupBy(charge.customerId, customer.email);

	for (const b of balances) {
		if (!b.email || b.total <= 0) continue;
		if (!(await logOnce(orgId, 'statement_auto', `${b.customerId}:${month}`, b.email))) continue;
		try {
			await emailStatement(
				{
					orgId,
					userId: '',
					role: 'owner',
					org: { id: orgId, name: '', slug: '', logo: null }
				},
				b.customerId
			);
		} catch (err) {
			console.error(`monthly statement failed for customer ${b.customerId}`, err);
		}
	}
}

export async function runReminders(orgId: string) {
	await flushSmsOutbox(orgId);
	await expireEstimates(orgId);
	const now = new Date();
	const [st] = await db
		.select({ hours: companySettings.reminderHours })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	const horizon = new Date(now.getTime() + (st?.hours ?? 36) * 3600_000);
	const upcoming = await db
		.select({ id: job.id })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				inArray(job.status, ['scheduled', 'dispatched']),
				gte(job.startsAt, now),
				lte(job.startsAt, horizon)
			)
		);
	for (const j of upcoming) await notifyAppointmentReminder(orgId, j.id);

	const stale = await db
		.select({ id: estimate.id })
		.from(estimate)
		.where(
			and(
				eq(estimate.organizationId, orgId),
				eq(estimate.status, 'sent'),
				lt(estimate.sentAt, new Date(now.getTime() - 7 * 86400_000))
			)
		);
	for (const e of stale) await notifyEstimateFollowup(orgId, e.id);

	// Overdue-invoice reminders at 3 and 10 days past due.
	const todayIso = now.toISOString().slice(0, 10);
	const horizonIso = new Date(now.getTime() + 3 * 86400_000).toISOString().slice(0, 10);
	// Estimate expiry nudges — sent estimates within 3 days of validUntil.
	const expiringEstimates = await db
		.select({ id: estimate.id })
		.from(estimate)
		.where(
			and(
				eq(estimate.organizationId, orgId),
				eq(estimate.status, 'sent'),
				gte(estimate.validUntil, todayIso),
				lte(estimate.validUntil, horizonIso)
			)
		);
	for (const e of expiringEstimates) await notifyEstimateExpiring(orgId, e.id);

	// Due-soon nudges — standalone open charges (payment-plan installments,
	// manual charges) due within 3 days. Invoice charges use invoice reminders.
	const dueSoon = await db
		.select({ id: charge.id })
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.status, 'open'),
				isNull(charge.invoiceId),
				gte(charge.dueDate, todayIso),
				lte(charge.dueDate, horizonIso)
			)
		);
	for (const ch of dueSoon) await notifyChargeDueSoon(orgId, ch.id);

	const overdue = await db
		.select({ id: invoice.id, dueDate: invoice.dueDate })
		.from(invoice)
		.where(
			and(
				eq(invoice.organizationId, orgId),
				eq(invoice.status, 'open'),
				lt(invoice.dueDate, todayIso)
			)
		);
	for (const inv of overdue) {
		const daysPast = Math.floor(
			(now.getTime() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86400_000
		);
		const stage = daysPast >= 10 ? 10 : daysPast >= 3 ? 3 : 0;
		if (stage) await notifyInvoiceOverdue(orgId, inv.id, stage);
	}

	// Visit-rating asks — done jobs completed in the last 7 days, not yet rated,
	// with a texting-enabled customer. 'How did we do? Reply 1-5' — the reply is
	// recorded by the inbound webhook as a visit rating.
	const recentDone = await db
		.select({
			id: job.id,
			number: job.number,
			phone: customer.phone,
			smsOptOut: customer.smsOptOut
		})
		.from(job)
		.innerJoin(customer, eq(customer.id, job.customerId))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				isNull(job.rating),
				isNull(job.cancelledAt),
				gte(
					sql`coalesce(${job.endsAt}, ${job.updatedAt})`,
					sql`cast(${new Date(now.getTime() - 7 * 86400_000).toISOString()} as timestamptz)`
				)
			)
		);
	const ratingFlags = await notifFlags(orgId);
	if (ratingFlags.sms && smsProvider()) {
		const name = await orgName(orgId);
		for (const j of recentDone) {
			if (!j.phone || j.smsOptOut) continue;
			if (!(await logOnce(orgId, 'rating_sms_ask', j.id, j.phone))) continue;
			await sendSmsQuiet(orgId, {
				to: j.phone,
				body: `${name}: how did we do on J-${j.number}? Reply 1-5.`
			});
		}
	}

	// Late fee: one flat fee appended to any invoice 3+ days past due while the
	// org charges late fees — deduped per invoice via notification_log.
	const [cfg] = await db
		.select({ lateFeeCents: companySettings.lateFeeCents })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	if (cfg?.lateFeeCents && cfg.lateFeeCents > 0) {
		for (const inv of overdue) {
			const daysPast = Math.floor(
				(now.getTime() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86400_000
			);
			if (daysPast < 3) continue;
			if (!(await logOnce(orgId, 'late_fee', inv.id, 'system'))) continue;
			const [openCharge] = await db
				.select({ id: charge.id })
				.from(charge)
				.where(and(eq(charge.invoiceId, inv.id), eq(charge.status, 'open')));
			if (!openCharge) continue; // paid/void — nothing to add a fee to
			await db.insert(invoiceItem).values({
				invoiceId: inv.id,
				name: 'Late fee',
				description: `Added ${daysPast} days past the due date`,
				qty: 1,
				unitPrice: cfg.lateFeeCents
			});
			await db
				.update(charge)
				.set({ amount: sql`${charge.amount} + ${cfg.lateFeeCents}` })
				.where(eq(charge.id, openCharge.id));
		}
	}

	// Warranty-expiry heads-up: equipment whose warranty ends within 30 days — one email per unit.
	const in30 = addDays(todayIso, 30);
	const expiring = await db
		.select({
			equipment,
			customerName: customer.name,
			email: customer.email,
			emailOptOut: customer.emailOptOut
		})
		.from(equipment)
		.innerJoin(customer, eq(equipment.customerId, customer.id))
		.where(
			and(
				eq(equipment.organizationId, orgId),
				eq(equipment.active, true),
				gte(equipment.warrantyUntil, todayIso),
				lte(equipment.warrantyUntil, in30)
			)
		);
	{
		const flags = await notifFlags(orgId);
		const name = await orgName(orgId);
		for (const w of expiring) {
			if (!flags.email || !w.email || w.emailOptOut) continue;
			if (!(await logOnce(orgId, 'warranty_expiry', w.equipment.id, w.email))) continue;
			await sendEmail({
				to: w.email,
				subject: `Your ${w.equipment.name} warranty ends soon — ${name}`,
				...renderEmail({
					orgName: name,
					heading: `Hi ${w.customerName},`,
					lines: [
						`Your ${w.equipment.name}${w.equipment.brand ? ` (${[w.equipment.brand, w.equipment.model].filter(Boolean).join(' ')})` : ''} warranty ends on ${w.equipment.warrantyUntil}.`,
						'If anything needs attention before coverage runs out, reply to this email or request service from your customer portal and we will take a look.'
					],
					action: { label: 'Open customer portal', url: `${appOrigin()}/portal` }
				})
			});
		}
	}

	// Service-due reminder: active equipment with next_service_due inside 7 days —
	// one email + one text per unit per due date (key includes the date so a new
	// due date re-reminds).
	{
		const in7 = addDays(todayIso, 7);
		const due = await db
			.select({
				equipment,
				customerName: customer.name,
				email: customer.email,
				emailOptOut: customer.emailOptOut,
				phone: customer.phone,
				smsOptOut: customer.smsOptOut
			})
			.from(equipment)
			.innerJoin(customer, eq(equipment.customerId, customer.id))
			.where(
				and(
					eq(equipment.organizationId, orgId),
					eq(equipment.active, true),
					gte(equipment.nextServiceDue, todayIso),
					lte(equipment.nextServiceDue, in7)
				)
			);
		const flags = await notifFlags(orgId);
		const name = await orgName(orgId);
		for (const w of due) {
			const key = `${w.equipment.id}:${w.equipment.nextServiceDue}`;
			if (flags.email && w.email && !w.emailOptOut) {
				if (await logOnce(orgId, 'service_due', key, w.email))
					await sendEmail({
						to: w.email,
						subject: `Your ${w.equipment.name} is due for service — ${name}`,
						...renderEmail({
							orgName: name,
							heading: `Hi ${w.customerName},`,
							lines: [
								`Your ${w.equipment.name}${w.equipment.brand ? ` (${[w.equipment.brand, w.equipment.model].filter(Boolean).join(' ')})` : ''} is due for maintenance on ${w.equipment.nextServiceDue}.`,
								'Request service from your customer portal or reply to this email and we will get you on the schedule.'
							],
							action: { label: 'Request service', url: `${appOrigin()}/portal` }
						})
					});
			}
			if (flags.sms && w.phone && !w.smsOptOut) {
				if (await logOnce(orgId, 'service_due_sms', key, w.phone))
					await sendSmsQuiet(orgId, {
						to: w.phone,
						body: `${name}: your ${w.equipment.name} is due for service ${w.equipment.nextServiceDue}. Reply to book.`
					});
			}
		}
	}

	// Agreement renewal heads-up: active agreements billing within 7 days — one email per billing date.
	const in7 = addDays(todayIso, 7);
	const renewing = await db
		.select({
			id: serviceAgreement.id,
			nextChargeAt: serviceAgreement.nextChargeAt,
			planName: agreementPlan.name,
			amount: agreementPlan.amount,
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			phone: customer.phone,
			smsOptOut: customer.smsOptOut,
			customerName: customer.name
		})
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.innerJoin(customer, eq(serviceAgreement.customerId, customer.id))
		.where(
			and(
				eq(serviceAgreement.organizationId, orgId),
				eq(serviceAgreement.status, 'active'),
				gte(serviceAgreement.nextChargeAt, new Date(`${todayIso}T00:00:00Z`)),
				lte(serviceAgreement.nextChargeAt, new Date(`${in7}T23:59:59.999Z`))
			)
		);
	{
		const flags = await notifFlags(orgId);
		const name2 = await orgName(orgId);
		for (const a of renewing) {
			if (!a.nextChargeAt) continue;
			const renewsOn = a.nextChargeAt.toISOString().slice(0, 10);
			if (
				flags.sms &&
				a.phone &&
				!a.smsOptOut &&
				smsProvider() &&
				(await logOnce(orgId, 'agreement_renewal_sms', a.id, `${a.phone}:${renewsOn}`))
			)
				await sendSmsQuiet(orgId, {
					to: a.phone,
					body: `${name2}: your ${a.planName} plan renews ${renewsOn} for ${formatMoney(a.amount)}. Reply STOP to opt out.`
				});
			if (!flags.email || !a.email || a.emailOptOut) continue;
			if (!(await logOnce(orgId, 'agreement_renewal', a.id, `${a.email}:${renewsOn}`))) continue;
			await sendEmail({
				to: a.email,
				subject: `Your ${a.planName} plan renews ${renewsOn} — ${name2}`,
				...renderEmail({
					orgName: name2,
					heading: `Hi ${a.customerName},`,
					lines: [
						`Your ${a.planName} service plan renews on ${renewsOn} for ${formatMoney(a.amount)}.`,
						'Your portal shows the visits, balance and invoices under this plan.'
					],
					action: { label: 'Open customer portal', url: `${appOrigin()}/portal` }
				})
			});
		}
	}

	// Stale clock-out guard: auto-end open time entries running >16h (cap at 12h
	// worked) so they can be approved; alert the member + admins.
	const staleEntries = await db
		.select({
			id: jobTimeEntry.id,
			jobId: jobTimeEntry.jobId,
			memberId: jobTimeEntry.memberId,
			startedAt: jobTimeEntry.startedAt,
			email: user.email,
			jobNumber: job.number
		})
		.from(jobTimeEntry)
		.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				isNull(jobTimeEntry.endedAt),
				lt(jobTimeEntry.startedAt, new Date(now.getTime() - 16 * 3600_000))
			)
		);
	if (staleEntries.length) {
		const admins = await adminEmails(orgId);
		for (const e of staleEntries) {
			const capped = new Date(e.startedAt.getTime() + 12 * 3600_000);
			await db
				.update(jobTimeEntry)
				.set({
					endedAt: capped,
					note: sql`case when ${jobTimeEntry.note} = '' then 'auto-ended after 12h (never clocked out)' else ${jobTimeEntry.note} || ' · auto-ended after 12h' end`
				})
				.where(eq(jobTimeEntry.id, e.id));
			const recipients = [...(e.email ? [e.email] : []), ...admins];
			for (const r of new Set(recipients)) {
				await logOnce(orgId, 'time_auto_ended', `${e.jobId}:${e.id}`, r);
			}
		}
	}

	// Morning digest: each technician's jobs starting today (org timezone).
	const tz = await orgTimezone(orgId);
	const name = await orgName(orgId);
	const today = localDate(now, tz);

	// Staff follow-ups due today or earlier — inbox row + email to the assignee.
	const dueFollowUpRows = await db
		.select({
			id: followUp.id,
			note: followUp.note,
			dueOn: followUp.dueOn,
			customerId: followUp.customerId,
			jobId: followUp.jobId,
			email: user.email,
			customerName: customer.name,
			jobNumber: job.number
		})
		.from(followUp)
		.innerJoin(member, eq(followUp.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.leftJoin(customer, eq(followUp.customerId, customer.id))
		.leftJoin(job, eq(followUp.jobId, job.id))
		.where(
			and(eq(followUp.organizationId, orgId), isNull(followUp.doneAt), lte(followUp.dueOn, today))
		);
	for (const f of dueFollowUpRows) {
		if (!f.email) continue;
		const link = f.jobId
			? `/jobs/${f.jobId}`
			: f.customerId
				? `/customers/${f.customerId}`
				: '/dashboard';
		if (!(await logOnce(orgId, 'follow_up_due', `${f.id}:${link}`, f.email))) continue;
		await sendEmail({
			to: f.email,
			subject: `Follow-up due today — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Follow-up due ${f.dueOn}`,
				lines: [
					f.note,
					f.customerName ? `Customer: ${f.customerName}` : '',
					f.jobNumber ? `Job: J-${f.jobNumber}` : ''
				].filter(Boolean),
				action: { label: 'Open', url: `${appOrigin()}${link}` }
			})
		});
	}

	const todays = await db
		.select({
			memberId: job.technicianId,
			number: job.number,
			startsAt: job.startsAt,
			summary: job.summary,
			jobTypeName: jobType.name,
			customerName: customer.name,
			email: user.email,
			memberName: user.name
		})
		.from(job)
		.innerJoin(member, eq(job.technicianId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				inArray(job.status, ['scheduled', 'dispatched', 'in_progress']),
				gte(job.startsAt, zonedToUtc(`${today}T00:00`, tz)),
				lt(job.startsAt, zonedToUtc(`${addDays(today, 1)}T00:00`, tz))
			)
		)
		.orderBy(asc(job.startsAt));
	const byMember = new Map<string, typeof todays>();
	for (const r of todays) {
		if (!r.memberId) continue;
		byMember.set(r.memberId, [...(byMember.get(r.memberId) ?? []), r]);
	}
	const flags = await notifFlags(orgId);
	for (const rows of byMember.values()) {
		if (!flags.digest) break;
		const r = rows[0];
		if (!(await logOnce(orgId, 'daily_digest', today, r.email))) continue;
		await sendEmail({
			to: r.email,
			subject: `${rows.length} job${rows.length === 1 ? '' : 's'} today — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Good morning, ${r.memberName}`,
				lines: [
					`You have ${rows.length} job${rows.length === 1 ? '' : 's'} on the schedule today:`,
					...rows
						.slice(0, 12)
						.map(
							(x) =>
								`${localTime(x.startsAt!, tz)} — J-${x.number} ${x.jobTypeName ?? x.summary} (${x.customerName})`
						)
				],
				action: { label: 'Open My Day', url: `${appOrigin()}/myday` }
			})
		});
	}
}

/** "Your technician is on the way" text when a job is marked en_route. SMS only. */
export async function notifyJobEnRoute(orgId: string, jobId: string) {
	if (!smsProvider()) return;
	if (!(await notifFlags(orgId)).sms) return;
	const [row] = await db
		.select({
			phone: customer.phone,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			number: job.number,
			jobTypeName: jobType.name,
			technicianName: user.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(eq(job.id, jobId));
	if (!row?.phone || row.smsOptOut) return;
	if (!(await logOnce(orgId, 'job_en_route_sms', jobId, row.phone))) return;
	const name = await orgName(orgId);
	await sendSmsQuiet(orgId, {
		to: row.phone,
		body: `${name}: ${row.technicianName ?? 'Your technician'} is on the way for ${row.jobTypeName ?? `job J-${row.number}`}.`
	});
}

/** "How did we do?" thank-you email when a job is marked completed. Review CTA when the org set a review link. */
export async function notifyJobCompleted(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			phone: customer.phone,
			customerName: customer.name,
			summary: job.summary,
			number: job.number,
			status: job.status,
			jobTypeName: jobType.name,
			reviewUrl: companySettings.reviewUrl,
			autoReport: companySettings.autoSendReport
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.innerJoin(companySettings, eq(companySettings.organizationId, job.organizationId))
		.where(eq(job.id, jobId));
	if ((!row?.email && !row?.phone) || row?.status !== 'done') return;
	const name = await orgName(orgId);
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
		(await logOnce(orgId, 'job_completed', jobId, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Thanks for choosing ${name}`,
			...renderEmail({
				orgName: name,
				heading: `All done, ${row.customerName}`,
				lines: [
					`${name} finished ${row.jobTypeName ?? row.summary} (J-${row.number}).`,
					...(row.reviewUrl
						? ['If we earned it, a quick review helps us a lot — it takes under a minute.']
						: ['You can view this visit and your documents anytime in the customer portal.'])
				],
				action: row.reviewUrl
					? { label: 'Leave a review', url: row.reviewUrl }
					: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
			})
		});
	if (
		row.phone &&
		!row.smsOptOut &&
		flags.sms &&
		smsProvider() &&
		(await logOnce(orgId, 'job_completed_sms', jobId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: row.reviewUrl
				? `${name} finished ${row.jobTypeName ?? row.summary} (J-${row.number}). Thanks! A quick review helps a lot: ${row.reviewUrl}`
				: `${name} finished ${row.jobTypeName ?? row.summary} (J-${row.number}). Thanks for choosing us!`
		});
	if (row.autoReport) await notifyServiceReport(orgId, jobId);
}

/** Emails admins/dispatchers the moment a booking request lands (staffDigest toggle gates it). */
export async function notifyStaffBooking(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({
			customerName: customer.name,
			phone: customer.phone,
			jobTypeName: jobType.name,
			summary: job.summary,
			preferredTime: job.preferredTime
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'booking_staff_alert', jobId, email))) continue;
		await sendEmail({
			to: email,
			subject: `New booking request — ${row.customerName} (${name})`,
			...renderEmail({
				orgName: name,
				heading: `New booking request from ${row.customerName}`,
				lines: [
					`${row.jobTypeName ?? row.summary}${row.preferredTime ? ` — asks for ${row.preferredTime}` : ''}.`,
					row.phone ? `Phone: ${row.phone}` : 'No phone on file.'
				],
				action: { label: 'Open dispatch', url: `${appOrigin()}/dispatch` }
			})
		});
	}
}

/** Emails admins when an item's on-hand drops to/below its reorder point. Re-arms on restock. */
export async function notifyLowStock(orgId: string, itemId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [i] = await db
		.select({
			name: inventoryItem.name,
			qty: inventoryItem.qtyOnHand,
			rp: inventoryItem.reorderPoint,
			unit: inventoryItem.unit
		})
		.from(inventoryItem)
		.where(eq(inventoryItem.id, itemId));
	if (!i || i.rp == null || i.qty > i.rp) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'low_stock', itemId, email))) continue;
		await sendEmail({
			to: email,
			subject: `Low stock: ${i.name} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `${i.name} is running low`,
				lines: [
					`${i.qty} ${i.unit} on hand — the reorder point is ${i.rp}.`,
					'Restock it or raise a purchase order from the inventory page.'
				],
				action: { label: 'Open inventory', url: `${appOrigin()}/inventory` }
			})
		});
	}
}

/** Re-arms an item's low-stock alerts after stock is added back above the reorder point. */
export async function rearmLowStock(orgId: string, itemId: string) {
	const [i] = await db
		.select({ qty: inventoryItem.qtyOnHand, rp: inventoryItem.reorderPoint })
		.from(inventoryItem)
		.where(eq(inventoryItem.id, itemId));
	if (!i || i.rp == null || i.qty <= i.rp) return;
	await db
		.delete(notificationLog)
		.where(
			and(
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.kind, 'low_stock'),
				eq(notificationLog.entityId, itemId)
			)
		);
}

/** "Your job is waiting on a part" — once per job, when staff set the blocked flag. */
export async function notifyPartsDelay(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.email && !flags.sms) return;
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			phone: customer.phone,
			number: job.number
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(eq(job.id, jobId));
	if (!row || (!row.email && !row.phone)) return;
	const name = await orgName(orgId);
	if (!(await logOnce(orgId, 'parts_delay', jobId, row.email ?? row.phone ?? 'unknown'))) return;
	const lines = [
		`A quick update on your job J-${row.number}: we're waiting on a part to complete the work.`,
		`We'll reach out as soon as it's in — no action needed on your end.`
	];
	if (flags.email && row.email && !row.emailOptOut)
		await sendEmail({
			to: row.email,
			subject: `Update on your job — ${name}`,
			...renderEmail({ orgName: name, heading: 'Waiting on a part', lines })
		});
	if (flags.sms && row.phone && !row.smsOptOut)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: J-${row.number} is waiting on a part. We'll reach out once it's in.`
		});
}

/** Customer rated a visit — staff inbox for admins; 5★ also nudges the public review. */
export async function notifyVisitRated(orgId: string, jobId: string, rating: number) {
	const [row] = await db
		.select({
			number: job.number,
			summary: job.summary,
			customerName: customer.name,
			customerEmail: customer.email,
			emailOptOut: customer.emailOptOut,
			reviewUrl: companySettings.reviewUrl
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.innerJoin(companySettings, eq(companySettings.organizationId, job.organizationId))
		.where(eq(job.id, jobId));
	if (!row) return;
	const flags = await notifFlags(orgId);
	const name = await orgName(orgId);
	if (flags.digest)
		for (const email of await adminEmails(orgId))
			// Inbox row only — the activity feed already shows the rating.
			await logOnce(orgId, 'visit_rated', jobId, email);
	if (
		rating === 5 &&
		row.reviewUrl &&
		row.customerEmail &&
		!row.emailOptOut &&
		flags.email &&
		(await logOnce(orgId, 'review_ask', jobId, row.customerEmail))
	)
		await sendEmail({
			to: row.customerEmail,
			subject: `Thanks for the 5 stars — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Glad we earned it, ${row.customerName}`,
				lines: [
					`Thanks for rating J-${row.number} ${row.summary} 5 stars.`,
					'A public review takes under a minute and means a lot to a local crew like ours.'
				],
				action: { label: 'Leave a review', url: row.reviewUrl }
			})
		});
}

/** A saved-card auto-charge failed — alerts staff; the charge stays open for follow-up. */
export async function notifyAutoChargeFailed(
	orgId: string,
	customerId: string,
	chargeId: string,
	cardLabel: string | null
) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [c] = await db
		.select({ name: customer.name })
		.from(customer)
		.where(and(eq(customer.organizationId, orgId), eq(customer.id, customerId)));
	if (!c) return;
	const name = await orgName(orgId);
	const stamp = `${customerId}:${chargeId}`;
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'auto_charge_failed', stamp, email))) continue;
		await sendEmail({
			to: email,
			subject: `Auto-charge failed — ${c.name} (${name})`,
			...renderEmail({
				orgName: name,
				heading: `Auto-charge failed for ${c.name}`,
				lines: [
					`The recurring charge could not be collected from ${cardLabel ?? 'the card on file'}.`,
					'The charge was left open — the customer can still pay it from the portal or by invoice.'
				],
				action: { label: 'Open customer', url: `${appOrigin()}/customers/${customerId}` }
			})
		});
	}
}

/** Customer-facing dunning email when an auto-charge fails — pay online or update the card. */
export async function emailAutoChargeFailedToCustomer(
	orgId: string,
	customerId: string,
	chargeId: string,
	amount: number,
	cardLabel: string | null
) {
	const flags = await notifFlags(orgId);
	if (!flags.email) return;
	const [c] = await db
		.select({ name: customer.name, email: customer.email, emailOptOut: customer.emailOptOut })
		.from(customer)
		.where(and(eq(customer.organizationId, orgId), eq(customer.id, customerId)));
	if (!c?.email || c.emailOptOut) return;
	const name = await orgName(orgId);
	if (!(await logOnce(orgId, 'auto_charge_failed_customer', `${customerId}:${chargeId}`, c.email)))
		return;
	const [settings] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	await sendEmail({
		to: c.email,
		subject: `We couldn't collect your payment — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Hi ${c.name},`,
			lines: [
				`We tried to collect ${formatMoney(amount, settings?.currency ?? 'usd')} from ${cardLabel ?? 'your card on file'}, but the charge didn't go through.`,
				'You can pay online from your customer portal — or update your saved card there and we will try the recurring charge again next period.'
			],
			action: { label: 'Pay online', url: `${appOrigin()}/portal` }
		})
	});
}

/** "The job blocking yours is done" — emails + inboxes the dependent job's tech. */
export async function notifyJobUnblocked(
	orgId: string,
	dependentJobId: string,
	predNumber: number
) {
	const [row] = await db
		.select({
			number: job.number,
			summary: job.summary,
			technicianId: job.technicianId,
			customerName: customer.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(eq(job.id, dependentJobId));
	if (!row?.technicianId) return;
	const [m] = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, orgId),
				eq(member.id, row.technicianId),
				eq(member.staffAlerts, true)
			)
		);
	if (!m?.email) return;
	if (!(await logOnce(orgId, 'job_unblocked', dependentJobId, m.email))) return;
	const name = await orgName(orgId);
	await sendEmail({
		to: m.email,
		subject: `J-${row.number} is unblocked — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `J-${row.number} ${row.summary} can start`,
			lines: [`Its dependency J-${predNumber} was completed.`, `Customer: ${row.customerName}`],
			action: { label: 'Open job', url: `${appOrigin()}/jobs/${dependentJobId}` }
		})
	});
}

/** "You've been assigned a job" — emails the technician. Once per job+tech. */
export async function notifyTechAssigned(orgId: string, jobId: string, memberId: string) {
	const m = await db
		.select({ email: user.email, name: user.name, staffAlerts: member.staffAlerts })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(eq(member.organizationId, orgId), eq(member.id, memberId), eq(member.staffAlerts, true))
		)
		.limit(1);
	const j = await db
		.select({
			number: job.number,
			summary: job.summary,
			startsAt: job.startsAt,
			customerId: job.customerId
		})
		.from(job)
		.where(eq(job.id, jobId))
		.limit(1);
	if (!m.length || !j.length || !m[0].email) return;
	if (!(await logOnce(orgId, 'tech_assigned', `${jobId}:${memberId}`, m[0].email))) return;
	const [name, c] = await Promise.all([
		orgName(orgId),
		db
			.select({ name: customer.name })
			.from(customer)
			.where(eq(customer.id, j[0].customerId))
			.limit(1)
			.then((r) => r[0])
	]);
	const when = j[0].startsAt
		? ` on ${new Date(j[0].startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
		: '';
	await sendEmail({
		to: m[0].email,
		subject: `New job assigned — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `You've been assigned J-${j[0].number}`,
			lines: [
				`${j[0].summary} — ${c?.name ?? 'customer'}${when}.`,
				'See it in My Day or the dispatch board.'
			],
			action: { label: 'Open My Day', url: `${appOrigin()}/myday` }
		})
	});
}

/** "Your job moved" — emails the assigned tech, once per (job,tech,new-start). */
export async function notifyTechRescheduled(orgId: string, jobId: string, memberId: string) {
	const m = await db
		.select({ email: user.email, staffAlerts: member.staffAlerts })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(eq(member.organizationId, orgId), eq(member.id, memberId), eq(member.staffAlerts, true))
		)
		.limit(1);
	const j = await db
		.select({
			number: job.number,
			summary: job.summary,
			startsAt: job.startsAt,
			customerId: job.customerId
		})
		.from(job)
		.where(eq(job.id, jobId))
		.limit(1);
	if (!m.length || !j.length || !m[0].email || !j[0].startsAt) return;
	// Only reschedules: jobs that were never assigned don't get this email.
	const assigned = await db
		.select({ id: notificationLog.id })
		.from(notificationLog)
		.where(
			and(
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.kind, 'tech_assigned'),
				eq(notificationLog.entityId, `${jobId}:${memberId}`)
			)
		)
		.limit(1);
	if (!assigned.length) return;
	if (
		!(await logOnce(
			orgId,
			'tech_rescheduled',
			`${jobId}:${memberId}:${new Date(j[0].startsAt).toISOString()}`,
			m[0].email
		))
	)
		return;
	const [name, c] = await Promise.all([
		orgName(orgId),
		db
			.select({ name: customer.name })
			.from(customer)
			.where(eq(customer.id, j[0].customerId))
			.limit(1)
			.then((r) => r[0])
	]);
	const when = new Date(j[0].startsAt).toLocaleString('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
	await sendEmail({
		to: m[0].email,
		subject: `Job rescheduled — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `J-${j[0].number} moved to ${when}`,
			lines: [
				`${j[0].summary} — ${c?.name ?? 'customer'}.`,
				'See the updated slot in My Day or the dispatch board.'
			],
			action: { label: 'Open My Day', url: `${appOrigin()}/myday` }
		})
	});
}

/** "Customer answered your estimate" — emails owner/admins, once per estimate. */
export async function notifyStaffEstimateDecision(orgId: string, estimateId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({
			number: estimate.number,
			status: estimate.status,
			decisionName: estimate.decisionName,
			customerName: customer.name
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row || !['converted', 'declined'].includes(row.status)) return;
	const approved = row.status === 'converted';
	const name = await orgName(orgId);
	const who = `${row.customerName}${row.decisionName ? ` (${row.decisionName})` : ''}`;
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'estimate_decision', estimateId, email))) continue;
		await sendEmail({
			to: email,
			subject: `E-${row.number} ${approved ? 'approved' : 'declined'} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Estimate E-${row.number} ${approved ? 'approved 🎉' : 'declined'}`,
				lines: [
					`${who} ${approved ? 'approved the estimate — a job was created and is waiting in the dispatch queue.' : 'declined the estimate.'}`
				],
				action: {
					label: approved ? 'Open dispatch' : 'Open estimates',
					url: `${appOrigin()}${approved ? '/dispatch' : '/estimates'}`
				}
			})
		});
	}
}

/** "Customer opened the estimate" staff alert — once per estimate per admin email. */
export async function notifyStaffEstimateViewed(orgId: string, estimateId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({ number: estimate.number, customerName: customer.name })
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'estimate_viewed', estimateId, email))) continue;
		await sendEmail({
			to: email,
			subject: `E-${row.number} viewed — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Estimate E-${row.number} was opened`,
				lines: [
					`${row.customerName} just viewed estimate E-${row.number} — a good moment to follow up.`
				],
				action: { label: 'Open estimate', url: `${appOrigin()}/estimates/${estimateId}` }
			})
		});
	}
}

/** Customer opened their public invoice link — staff alert, once per invoice. */
export async function notifyStaffInvoiceViewed(orgId: string, invoiceId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({ number: invoice.number, customerName: customer.name })
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.where(eq(invoice.id, invoiceId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'invoice_viewed', invoiceId, email))) continue;
		await sendEmail({
			to: email,
			subject: `INV-${row.number} viewed — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Invoice INV-${row.number} was opened`,
				lines: [
					`${row.customerName} just viewed invoice INV-${row.number} — a good moment to follow up on payment.`
				],
				action: { label: 'Open billing', url: `${appOrigin()}/billing` }
			})
		});
	}
}

/** Customer told us when works best after approving an estimate — staff alert per visit. */
export async function notifyVisitPreference(orgId: string, jobId: string, note: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({ number: job.number, customerName: customer.name })
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(eq(job.id, jobId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'visit_preference', jobId, email))) continue;
		await sendEmail({
			to: email,
			subject: `J-${row.number} — customer picked a time (${name})`,
			...renderEmail({
				orgName: name,
				heading: `${row.customerName} told you when works best for J-${row.number}`,
				lines: [
					`"${note.slice(0, 500)}"`,
					'The preference is on the job — schedule the visit and send a confirmation.'
				],
				action: { label: 'Open job', url: `${appOrigin()}/jobs/${jobId}` }
			})
		});
	}
}

/** A tech self-requested time off from My Day — heads-up to admins. */
export async function notifyTimeOffRequest(
	orgId: string,
	memberId: string,
	range: string,
	reason: string
) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({ name: user.name })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.id, memberId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'timeoff_request', memberId, email))) continue;
		await sendEmail({
			to: email,
			subject: `Time off: ${row.name} — ${range} (${name})`,
			...renderEmail({
				orgName: name,
				heading: `${row.name} marked time off for ${range}`,
				lines: [
					reason ? `Reason: ${reason.slice(0, 200)}` : 'No reason given.',
					'It already shows on the dispatch board — remove it in Settings if it was a mistake.'
				],
				action: { label: 'Open settings', url: `${appOrigin()}/settings` }
			})
		});
	}
}

/** Customer clicked "Request changes" on the public estimate — staff alert, once per estimate. */
export async function notifyStaffEstimateChanges(orgId: string, estimateId: string, note: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({ number: estimate.number, customerName: customer.name })
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'estimate_changes', estimateId, email))) continue;
		await sendEmail({
			to: email,
			subject: `E-${row.number} change request — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `${row.customerName} asked for changes on E-${row.number}`,
				lines: [note.slice(0, 500), 'The estimate stays in sent status until you revise it.'],
				action: { label: 'Open estimate', url: `${appOrigin()}/estimates/${estimateId}` }
			})
		});
	}
}

export async function notifyStaffQuoteRequest(orgId: string, estimateId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({ number: estimate.number, customerName: customer.name })
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.id, estimateId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'quote_request', estimateId, email))) continue;
		await sendEmail({
			to: email,
			subject: `Quote requested — ${row.customerName} (E-${row.number})`,
			...renderEmail({
				orgName: name,
				heading: `${row.customerName} asked for a quote`,
				lines: ['A draft estimate was created from their portal request — price it and send.'],
				action: { label: 'Open estimate', url: `${appOrigin()}/estimates/${estimateId}` }
			})
		});
	}
}

/** Staff alert: a portal customer uploaded a document. */
export async function notifyStaffDocument(orgId: string, docId: string) {
	const flags = await notifFlags(orgId);
	if (!flags.digest) return;
	const [row] = await db
		.select({
			fileName: customerDocument.fileName,
			customerName: customer.name,
			customerId: customer.id
		})
		.from(customerDocument)
		.innerJoin(customer, eq(customerDocument.customerId, customer.id))
		.where(eq(customerDocument.id, docId));
	if (!row) return;
	const name = await orgName(orgId);
	for (const email of await adminEmails(orgId)) {
		if (!(await logOnce(orgId, 'customer_document', docId, email))) continue;
		await sendEmail({
			to: email,
			subject: `Document from ${row.customerName} — ${name}`,
			...renderEmail({
				orgName: name,
				heading: `${row.customerName} shared a document`,
				lines: [`"${row.fileName}" was uploaded from the customer portal.`],
				action: { label: 'Open customer', url: `${appOrigin()}/customers/${row.customerId}` }
			})
		});
	}
}

/** "We received your payment" receipt email — once per batch of payment rows. */
export async function notifyPaymentReceived(orgId: string, paymentIds: string[]) {
	const flags = await notifFlags(orgId);
	if (!paymentIds.length) return;
	const [row] = await db
		.select({
			amount: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number),
			method: payment.method,
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			phone: customer.phone,
			smsOptOut: customer.smsOptOut
		})
		.from(payment)
		.innerJoin(customer, eq(payment.customerId, customer.id))
		.where(inArray(payment.id, paymentIds))
		.groupBy(
			payment.method,
			customer.email,
			customer.emailOptOut,
			customer.phone,
			customer.smsOptOut
		);
	if (!row || row.amount <= 0) return;
	const name = await orgName(orgId);
	const currency = await orgCurrencyOf(orgId);
	if (
		flags.email &&
		row.email &&
		!row.emailOptOut &&
		(await logOnce(orgId, 'payment_receipt', paymentIds[0], row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Payment received — ${formatMoney(row.amount, currency)}`,
			...renderEmail({
				orgName: name,
				heading: `Thanks — we got your ${formatMoney(row.amount, currency)} payment`,
				lines: [
					`Paid by ${row.method === 'other' ? 'other method' : row.method} to ${name}.`,
					'Your balance updates automatically in your customer portal.'
				],
				action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
			})
		});
	// SMS receipt — same payment batch, its own dedupe key.
	if (flags.sms && row.phone && !row.smsOptOut) {
		if (await logOnce(orgId, 'payment_receipt_sms', paymentIds[0], row.phone)) {
			await sendSmsQuiet(orgId, {
				to: row.phone,
				body: `${name}: we received your ${formatMoney(row.amount, currency)} payment. Thanks!`
			});
		}
	}
}

/** Parts arrived on a blocked job — emails the assigned tech so they can reschedule. */
export async function notifyPartsArrived(orgId: string, jobId: string, memberId: string) {
	const m = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(eq(member.organizationId, orgId), eq(member.id, memberId), eq(member.staffAlerts, true))
		)
		.limit(1);
	const j = await db
		.select({ number: job.number, summary: job.summary, customerName: customer.name })
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(eq(job.id, jobId))
		.limit(1);
	if (!m.length || !j.length || !m[0].email) return;
	const day = new Date().toISOString().slice(0, 10);
	if (!(await logOnce(orgId, 'parts_arrived', `${jobId}:${day}`, m[0].email))) return;
	const name = await orgName(orgId);
	await sendEmail({
		to: m[0].email,
		subject: `Parts arrived — J-${j[0].number} ready to schedule (${name})`,
		...renderEmail({
			orgName: name,
			heading: `J-${j[0].number} ${j[0].summary} is unblocked`,
			lines: [
				'The parts hold was cleared — this job can be scheduled again.',
				`Customer: ${j[0].customerName}`
			],
			action: { label: 'Open job', url: `${appOrigin()}/jobs/${jobId}` }
		})
	});
}

/** Daily cron: place a credit hold on customers with a charge open 30+ days past due. */
export async function runCreditHolds(orgId: string) {
	const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
	const rows = await db
		.select({ id: customer.id, name: customer.name })
		.from(charge)
		.innerJoin(customer, eq(customer.id, charge.customerId))
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.status, 'open'),
				lt(charge.dueDate, cutoff),
				eq(customer.onHold, false)
			)
		)
		.groupBy(customer.id, customer.name);
	for (const c of rows) {
		await db.update(customer).set({ onHold: true }).where(eq(customer.id, c.id));
		await emit({
			orgId,
			entityType: 'customer',
			entityId: c.id,
			action: 'credit_hold',
			summary: `Credit hold placed on ${c.name} — open charge 30+ days past due`
		});
		const flags = await notifFlags(orgId);
		if (!flags.digest) continue;
		const name = await orgName(orgId);
		for (const email of await adminEmails(orgId)) {
			if (!(await logOnce(orgId, 'credit_hold_auto', c.id, email))) continue;
			await sendEmail({
				to: email,
				subject: `Credit hold placed — ${c.name} (${name})`,
				...renderEmail({
					orgName: name,
					heading: `${c.name} is now on credit hold`,
					lines: [
						'An open charge is more than 30 days past due, so new jobs are blocked until the hold is lifted.',
						'You can release the hold from the customer page.'
					],
					action: { label: 'Open customer', url: `${appOrigin()}/customers/${c.id}` }
				})
			});
		}
	}
}

/** Sends the public service-report link for a completed job (on demand — resends are allowed). */
export async function notifyServiceReport(orgId: string, jobId: string) {
	const flags = await notifFlags(orgId);
	const [row] = await db
		.select({
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			smsOptOut: customer.smsOptOut,
			phone: customer.phone,
			customerName: customer.name,
			number: job.number,
			status: job.status,
			summary: job.summary,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row || row.status !== 'done') return;
	const name = await orgName(orgId);
	const url = serviceReportUrl(jobId);
	// Manual send — each dispatch gets a fresh log row (timestamped) rather than deduping.
	const stamp = `${jobId}:${Date.now()}`;
	if (
		row.phone &&
		!row.smsOptOut &&
		flags.sms &&
		smsProvider() &&
		(await logOnce(orgId, 'report_sent_sms', stamp, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: your visit summary for J-${row.number} is ready — ${url}`
		});
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
		(await logOnce(orgId, 'report_sent', stamp, row.email))
	)
		await sendEmail({
			to: row.email,
			subject: `Your visit summary from ${name}`,
			...renderEmail({
				orgName: name,
				heading: `Your service report is ready, ${row.customerName}`,
				lines: [
					`${name} completed ${row.jobTypeName ?? row.summary} (J-${row.number}).`,
					'Open the report for the work summary, checklist, materials and photos.'
				],
				action: { label: 'View service report', url }
			})
		});
}

// ---------- Customer announcements ----------

type AnnouncementSegment = { type: string; tag: string; status: string };

async function announcementSegment(orgId: string, seg: AnnouncementSegment) {
	return db
		.select({
			id: customer.id,
			name: customer.name,
			email: customer.email,
			emailOptOut: customer.emailOptOut,
			phone: customer.phone,
			smsOptOut: customer.smsOptOut
		})
		.from(customer)
		.where(
			and(
				eq(customer.organizationId, orgId),
				seg.status !== 'any' ? eq(customer.status, seg.status as 'active' | 'inactive') : undefined,
				seg.type !== 'any'
					? eq(customer.type, seg.type as 'residential' | 'commercial')
					: undefined,
				seg.tag ? sql`${customer.tags} @> array[${seg.tag}]::text[]` : undefined
			)
		);
}

/** Reachable-counts preview for the announcement dialog. */
export async function previewAnnouncement(orgId: string, seg: AnnouncementSegment) {
	const flags = await notifFlags(orgId);
	const smsOk = !!smsProvider() && flags.sms;
	const rows = await announcementSegment(orgId, seg);
	return {
		total: rows.length,
		emails: flags.email ? rows.filter((c) => c.email && !c.emailOptOut).length : 0,
		phones: smsOk ? rows.filter((c) => c.phone && !c.smsOptOut).length : 0
	};
}

/** Blasts a one-off message to a customer segment — opt-outs, quiet hours and the
 * org's master channel toggles all apply; an identical blast is deduped. */
export async function sendAnnouncement(
	ctx: OrgContext,
	input: AnnouncementSegment & {
		channel: 'email' | 'sms' | 'both';
		subject: string;
		body: string;
	}
) {
	if (input.channel !== 'sms' && !input.subject.trim())
		error(400, 'A subject is required for email announcements');
	const flags = await notifFlags(ctx.orgId);
	const smsOk = !!smsProvider() && flags.sms;
	const rows = await announcementSegment(ctx.orgId, input);
	if (!rows.length) error(409, 'No customers match that segment');
	const blastId = createHash('sha256')
		.update(
			`${input.type}|${input.tag}|${input.status}|${input.channel}|${input.subject}|${input.body}`
		)
		.digest('hex')
		.slice(0, 16);
	const name = await orgName(ctx.orgId);
	let emailed = 0;
	let texted = 0;
	let skipped = 0;
	for (const c of rows) {
		let sent = false;
		if (
			input.channel !== 'sms' &&
			c.email &&
			!c.emailOptOut &&
			flags.email &&
			(await logOnce(ctx.orgId, 'announcement', blastId, c.email))
		) {
			await sendEmail({
				to: c.email,
				subject: input.subject.trim(),
				...renderEmail({
					orgName: name,
					heading: input.subject.trim(),
					lines: input.body
						.split('\n')
						.map((l) => l.trim())
						.filter(Boolean)
				})
			});
			emailed++;
			sent = true;
		}
		if (
			input.channel !== 'email' &&
			c.phone &&
			!c.smsOptOut &&
			smsOk &&
			(await logOnce(ctx.orgId, 'announcement_sms', blastId, c.phone))
		) {
			await sendSmsQuiet(ctx.orgId, { to: c.phone, body: `${name}: ${input.body}` });
			texted++;
			sent = true;
		}
		if (!sent) skipped++;
	}
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'customer',
		entityId: blastId,
		action: 'announcement',
		summary: `Announcement sent — ${emailed} email${emailed === 1 ? '' : 's'}, ${texted} text${texted === 1 ? '' : 's'}`
	});
	return { total: rows.length, emailed, texted, skipped };
}
