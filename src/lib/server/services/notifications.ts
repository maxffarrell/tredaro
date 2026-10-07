import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	companySettings,
	customer,
	estimate,
	invoice,
	job,
	jobType,
	notificationLog,
	organization
} from '#lib/server/db/schema.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import { appOrigin, sendEmail } from '#lib/server/email.ts';
import { sendSms, smsProvider } from '#lib/server/sms.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { estimateUrl } from './estimates.ts';
import { invoiceUrl } from './billing.ts';
import { addDays, localDate, localTime, zonedToUtc } from '#lib/tz.ts';
import { formatMoney } from '#lib/format.ts';

async function orgName(orgId: string) {
	const [o] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, orgId));
	return o?.name ?? 'your service company';
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

/** "Your estimate is ready" with the approve/decline link. */
export async function notifyEstimateSent(orgId: string, estimateId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'estimate_sent', estimateId, row.email))) return;
	const name = await orgName(orgId);
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

/** "We got your request" after a public /book submission creates the job. */
export async function notifyBookingReceived(orgId: string, jobId: string) {
	const [row] = await db
		.select({
			email: customer.email,
			customerName: customer.name,
			summary: job.summary,
			jobTypeName: jobType.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(job.id, jobId));
	if (!row?.email) return;
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

/** "Your invoice is ready" with the public pay link. Returns whether an email was sent. */
export async function notifyInvoiceSent(orgId: string, invoiceId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (!row?.email || row.status !== 'open') return false;
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

/** "Your job is scheduled" once a job gets a start time. Emails and/or texts the customer. */
export async function notifyJobScheduled(orgId: string, jobId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (row.email && (await logOnce(orgId, 'job_scheduled', jobId, row.email)))
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
	if (row.phone && smsProvider() && (await logOnce(orgId, 'job_scheduled_sms', jobId, row.phone)))
		await sendSms({
			to: row.phone,
			body: `${name}: ${what} is scheduled for ${when}. Reply to reschedule.`
		});
}

/** "Reminder: appointment tomorrow-ish" — one email + text per job, cron-driven. */
export async function notifyAppointmentReminder(orgId: string, jobId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (row.email && (await logOnce(orgId, 'appointment_reminder', jobId, row.email)))
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
		smsProvider() &&
		(await logOnce(orgId, 'appointment_reminder_sms', jobId, row.phone))
	)
		await sendSms({
			to: row.phone,
			body: `${name} reminder: ${what} on ${when}. Reply to reschedule.`
		});
}

/** "Still interested?" email when a sent estimate has sat untouched for a week. */
export async function notifyEstimateFollowup(orgId: string, estimateId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (!row?.email || row.status !== 'sent') return;
	if (!(await logOnce(orgId, 'estimate_followup', estimateId, row.email))) return;
	const name = await orgName(orgId);
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
}

/** Daily cron work: appointment reminders, stale-estimate follow-ups, staff schedule digests. */
export async function runReminders(orgId: string) {
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
	for (const rows of byMember.values()) {
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
	const [row] = await db
		.select({
			phone: customer.phone,
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
	if (!row?.phone) return;
	if (!(await logOnce(orgId, 'job_en_route_sms', jobId, row.phone))) return;
	const name = await orgName(orgId);
	await sendSms({
		to: row.phone,
		body: `${name}: ${row.technicianName ?? 'Your technician'} is on the way for ${row.jobTypeName ?? `job J-${row.number}`}.`
	});
}

/** "How did we do?" thank-you email when a job is marked completed. Review CTA when the org set a review link. */
export async function notifyJobCompleted(orgId: string, jobId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (row.email && (await logOnce(orgId, 'job_completed', jobId, row.email)))
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
	if (row.phone && smsProvider() && (await logOnce(orgId, 'job_completed_sms', jobId, row.phone)))
		await sendSms({
			to: row.phone,
			body: row.reviewUrl
				? `${name} finished ${row.jobTypeName ?? row.summary} (J-${row.number}). Thanks! A quick review helps a lot: ${row.reviewUrl}`
				: `${name} finished ${row.jobTypeName ?? row.summary} (J-${row.number}). Thanks for choosing us!`
		});
}
