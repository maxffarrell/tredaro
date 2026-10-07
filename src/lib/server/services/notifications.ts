import { eq, sql } from 'drizzle-orm';
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
import { appOrigin, sendEmail } from '#lib/server/email.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { estimateUrl } from './estimates.ts';
import { invoiceUrl } from './billing.ts';
import { localDate, localTime } from '#lib/tz.ts';
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

/** "Your job is scheduled" once a job gets a start time. */
export async function notifyJobScheduled(orgId: string, jobId: string) {
	const [row] = await db
		.select({
			email: customer.email,
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
	if (!row?.email || !row.startsAt) return;
	if (!(await logOnce(orgId, 'job_scheduled', jobId, row.email))) return;
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	await sendEmail({
		to: row.email,
		subject: `Job J-${row.number} scheduled — ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Your appointment is booked, ${row.customerName}`,
			lines: [
				`${row.jobTypeName ?? row.summary} is scheduled for ${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}.`,
				'Reply to this email if you need to reschedule.'
			],
			action: { label: 'Open the customer portal', url: `${appOrigin()}/portal` }
		})
	});
}
