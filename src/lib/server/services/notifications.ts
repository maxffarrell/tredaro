import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { OrgContext } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	companySettings,
	customer,
	equipment,
	agreementPlan,
	estimate,
	invoice,
	invoiceItem,
	job,
	payment,
	serviceAgreement,
	jobType,
	notificationLog,
	organization,
	inventoryItem,
	smsOutbox
} from '#lib/server/db/schema.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import { appOrigin, sendEmail } from '#lib/server/email.ts';
import { sendSms, smsProvider } from '#lib/server/sms.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { estimateUrl, expireEstimates } from './estimates.ts';
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
			action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
		})
	});
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
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
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
		(await logOnce(orgId, 'job_scheduled_sms', jobId, row.phone))
	)
		await sendSmsQuiet(orgId, {
			to: row.phone,
			body: `${name}: ${what} is scheduled for ${when}. Reply to reschedule.`
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
	if (
		row.email &&
		!row.emailOptOut &&
		flags.email &&
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
export async function runReminders(orgId: string) {
	await flushSmsOutbox(orgId);
	await expireEstimates(orgId);
	const now = new Date();
	const horizon = new Date(now.getTime() + 36 * 60 * 60 * 1000);
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

	// Morning digest: each technician's jobs starting today (org timezone).
	const tz = await orgTimezone(orgId);
	const name = await orgName(orgId);
	const today = localDate(now, tz);
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
			reviewUrl: companySettings.reviewUrl
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
