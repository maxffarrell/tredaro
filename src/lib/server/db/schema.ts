import { getTableName, sql } from 'drizzle-orm';
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	doublePrecision
} from 'drizzle-orm/pg-core';
import { member, organization, user } from './auth.schema.ts';

export * from './auth.schema.ts';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Table-qualified column for correlated subqueries; Drizzle omits the qualifier on single-table selects. */
export const outer = (column: AnyPgColumn) =>
	sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const orgId = () =>
	text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' });

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
};

/** One row per workspace: branding, timezone, document numbering and public-booking settings. */
export const companySettings = pgTable('company_settings', {
	organizationId: text('organization_id')
		.primaryKey()
		.references(() => organization.id, { onDelete: 'cascade' }),
	/** IANA timezone used for "today", dispatch display and invoice due dates. */
	timezone: text('timezone').notNull().default('UTC'),
	/** ISO 4217, lowercase (e.g. `usd`). */
	currency: text('currency').notNull().default('usd'),
	/** Public booking page at /book/[org-slug]. */
	publicPage: boolean('public_page').notNull().default(true),
	/** Short pitch shown on the public booking page. */
	tagline: text('tagline').notNull().default(''),
	address: text('address').notNull().default(''),
	phone: text('phone').notNull().default(''),
	/** Free-text operating hours shown on the public booking page. */
	businessHours: text('business_hours').notNull().default(''),
	website: text('website').notNull().default(''),
	/** Contractor license / registration number, printed on estimates and work orders. */
	licenseNumber: text('license_number').notNull().default(''),
	/** Logo shown on print documents and public estimate/invoice pages. */
	logoUrl: text('logo_url').notNull().default(''),
	/** Public review link (Google/Yelp/etc.) shown as a button in the job-completed email. Empty disables it. */
	reviewUrl: text('review_url').notNull().default(''),
	/** Master switches for automated sends — manual Send buttons always work. */
	emailNotifications: boolean('email_notifications').notNull().default(true),
	smsNotifications: boolean('sms_notifications').notNull().default(true),
	staffDigest: boolean('staff_digest').notNull().default(true),
	/** Days until a new invoice is due — prefills the new-invoice dialog and auto-drafts. */
	invoiceTermsDays: integer('invoice_terms_days').notNull().default(30),
	/** Days a sent estimate stays valid unless staff set a different expiry. */
	estimateValidDays: integer('estimate_valid_days').notNull().default(30),
	/** When on, completing a job with materials drafts an invoice automatically. */
	autoInvoiceOnComplete: boolean('auto_invoice_on_complete').notNull().default(false),
	/** Minimum days of advance notice required on the public booking page (0 = same-day ok). */
	bookingNoticeDays: integer('booking_notice_days').notNull().default(0),
	/** Sales tax in basis points appended as a line item on new invoices (0 = untaxed). */
	taxRateBps: integer('tax_rate_bps').notNull().default(0),
	/** Max public bookings accepted per requested day (0 = unlimited). */
	bookingDailyLimit: integer('booking_daily_limit').notNull().default(0),
	/** Fixed deposit collected via the payment provider right after an online booking (0 = off). */
	bookingDeposit: integer('booking_deposit').notNull().default(0),
	/** Flat late fee added once to an invoice that goes 3+ days past due (0 = off). */
	lateFeeCents: integer('late_fee_cents').notNull().default(0),
	/** Deposit invoice created on estimate approval, % of the estimate total (0 = none). */
	estimateDepositPct: integer('estimate_deposit_pct').notNull().default(0),
	/** Round billed labor up to this many minutes on invoices (0 = exact). */
	laborRoundingMin: integer('labor_rounding_min').notNull().default(0),
	/** Comma-separated ZIPs the public booking page accepts (blank = anywhere). */
	serviceZips: text('service_zips').notNull().default(''),
	/** Master switch for the public /book/[slug] form. */
	bookingEnabled: boolean('booking_enabled').notNull().default(true),
	/** Custom confirmation message on the booking success card (blank = default copy). */
	bookingMessage: text('booking_message').notNull().default(''),
	/** Per-workspace counters for human-readable document numbers. */
	nextJobNumber: integer('next_job_number').notNull().default(1),
	nextEstimateNumber: integer('next_estimate_number').notNull().default(1),
	nextInvoiceNumber: integer('next_invoice_number').notNull().default(1),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});

/** A business office/branch. Technicians and jobs can be scoped to one. */
export const office = pgTable(
	'office',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		address: text('address').notNull().default(''),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [index('office_org_idx').on(t.organizationId)]
);

export const customerStatus = pgEnum('customer_status', ['active', 'inactive']);
export const customerType = pgEnum('customer_type', ['residential', 'commercial']);

/** A customer. `portalUserId` links their login once they claim the portal. */
export const customer = pgTable(
	'customer',
	{
		id: id(),
		organizationId: orgId(),
		officeId: text('office_id').references(() => office.id, { onDelete: 'set null' }),
		portalUserId: text('portal_user_id').references(() => user.id, { onDelete: 'set null' }),
		type: customerType('type').notNull().default('residential'),
		/** Company name for commercial accounts. */
		companyName: text('company_name'),
		name: text('name').notNull(),
		email: text('email'),
		phone: text('phone'),
		status: customerStatus('status').notNull().default('active'),
		notes: text('notes'),
		/** Freeform labels for filtering/segmenting ("VIP", "Property manager"). */
		tags: text('tags').array(),
		/** Do-not-contact flags: suppress automated customer-facing texts/emails. */
		smsOptOut: boolean('sms_opt_out').notNull().default(false),
		emailOptOut: boolean('email_opt_out').notNull().default(false),
		/** Where the customer came from ("Google", "Referral", ...) for the leads report. */
		leadSource: text('lead_source'),
		/** Credit hold — blocks new jobs/bookings until the balance is resolved. */
		onHold: boolean('on_hold').notNull().default(false),
		/** Tax-exempt account — invoices skip the org's sales-tax line. */
		taxExempt: boolean('tax_exempt').notNull().default(false),
		/** Per-customer sales-tax override in basis points; null = org default rate. */
		taxRateBps: integer('tax_rate_bps'),
		/** Per-customer invoice terms in days; null = org default. */
		termsDays: integer('terms_days'),
		/** Preferred channel for scheduling comms: 'email'|'sms'; null = both. */
		contactPref: text('contact_pref'),
		/** Tech the customer prefers — pre-fills new jobs. */
		preferredMemberId: text('preferred_member_id').references(() => member.id, {
			onDelete: 'set null'
		}),
		/** Card on file: provider id ('stripe'), its customer object id, the saved payment-method ref, and a display label ("Visa ····4242"). */
		savedCardProvider: text('saved_card_provider'),
		savedCardCustomer: text('saved_card_customer'),
		savedCardRef: text('saved_card_ref'),
		savedCardLabel: text('saved_card_label'),
		since: date('since', { mode: 'string' }),
		...timestamps
	},
	(t) => [
		index('customer_org_idx').on(t.organizationId),
		index('customer_email_idx').on(t.organizationId, t.email),
		index('customer_portal_idx').on(t.portalUserId)
	]
);

/** A site a customer gets work done at — "Home", "Warehouse 2", etc. */
export const serviceLocation = pgTable(
	'service_location',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		label: text('label').notNull().default(''),
		address1: text('address1').notNull().default(''),
		city: text('city').notNull().default(''),
		state: text('state').notNull().default(''),
		zip: text('zip').notNull().default(''),
		/** Gate codes, parking, access instructions for the tech. */
		accessNotes: text('access_notes').notNull().default(''),
		isPrimary: boolean('is_primary').notNull().default(false),
		...timestamps
	},
	(t) => [
		index('service_location_customer_idx').on(t.customerId),
		index('service_location_org_idx').on(t.organizationId)
	]
);

/** A contact at a customer account (property manager, tenant, AP clerk, site lead). */
export const customerContact = pgTable(
	'customer_contact',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Free-text role: "office mgr", "tenant", "AP". */
		role: text('role').notNull().default(''),
		email: text('email').notNull().default(''),
		phone: text('phone').notNull().default(''),
		/** Primary contact — the person comms should go to first. */
		isPrimary: boolean('is_primary').notNull().default(false),
		...timestamps
	},
	(t) => [index('customer_contact_customer_idx').on(t.customerId)]
);

/** Installed equipment at a customer's site — an AC unit, water heater, etc. Jobs can link to it. */
export const equipment = pgTable(
	'equipment',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		serviceLocationId: text('service_location_id').references(() => serviceLocation.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		/** Freeform category, e.g. "HVAC", "Water heater", "Generator". */
		category: text('category').notNull().default(''),
		brand: text('brand').notNull().default(''),
		model: text('model').notNull().default(''),
		serial: text('serial').notNull().default(''),
		installedOn: date('installed_on', { mode: 'string' }),
		warrantyUntil: date('warranty_until', { mode: 'string' }),
		nextServiceDue: date('next_service_due', { mode: 'string' }),
		notes: text('notes').notNull().default(''),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [
		index('equipment_customer_idx').on(t.organizationId, t.customerId),
		index('equipment_location_idx').on(t.serviceLocationId)
	]
);

export const agreementInterval = pgEnum('agreement_interval', ['month', 'year']);

/** A service-agreement tier a customer can subscribe to, e.g. "Comfort Club — $29/mo". */
export const agreementPlan = pgTable(
	'agreement_plan',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		/** Price in minor units (cents) per interval. */
		amount: integer('amount').notNull(),
		interval: agreementInterval('interval').notNull().default('month'),
		initialFee: integer('initial_fee').notNull().default(0),
		/** Included maintenance visits per interval; null = none tracked. */
		includedVisits: integer('included_visits'),
		/** % off invoiced work for members of this plan (membership perk). */
		discountPct: integer('discount_pct').notNull().default(0),
		/** Job type generated visits use (defaults duration/assignee/office); null = untyped. */
		jobTypeId: text('job_type_id'),
		/** Shown on the public booking page. */
		listed: boolean('listed').notNull().default(true),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('agreement_plan_org_idx').on(t.organizationId)]
);

export const agreementStatus = pgEnum('agreement_status', [
	'active',
	'paused',
	'cancelled',
	'completed'
]);

/** A customer's service agreement; drives recurring charges. */
export const serviceAgreement = pgTable(
	'service_agreement',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		planId: text('plan_id')
			.notNull()
			.references(() => agreementPlan.id, { onDelete: 'restrict' }),
		status: agreementStatus('status').notNull().default('active'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		/** When the next recurring agreement charge should be posted. */
		nextChargeAt: timestamp('next_charge_at', { withTimezone: true }),
		/** Fixed-term: auto-complete the agreement after this many billed periods (null = runs forever). */
		maxPeriods: integer('max_periods'),
		...timestamps
	},
	(t) => [
		index('service_agreement_customer_idx').on(t.customerId),
		index('service_agreement_org_charge_idx').on(t.organizationId, t.nextChargeAt)
	]
);

export const pricebookKind = pgEnum('pricebook_kind', ['service', 'material']);

/** A flat-rate item in the pricebook: billable services and materials. */
export const pricebookItem = pgTable(
	'pricebook_item',
	{
		id: id(),
		organizationId: orgId(),
		kind: pricebookKind('kind').notNull().default('service'),
		category: text('category').notNull().default(''),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		/** Flat price in minor units. */
		price: integer('price').notNull(),
		/** Typical cost in minor units — feeds estimate margin + job profitability. */
		cost: integer('cost').notNull().default(0),
		/** Typical duration for scheduling; null for materials. */
		durationMin: integer('duration_min'),
		/** Job type this item typically bills to; drives estimate "suggested items". */
		jobTypeId: text('job_type_id').references(() => jobType.id, { onDelete: 'set null' }),
		/** Excluded from the sales-tax base when false (e.g. non-taxable labor). */
		taxable: boolean('taxable').notNull().default(true),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('pricebook_item_org_idx').on(t.organizationId)]
);

/** A type of work, e.g. "AC Repair". Sets the default duration, price and assignee for jobs. */
export const jobType = pgTable(
	'job_type',
	{
		id: id(),
		organizationId: orgId(),
		officeId: text('office_id').references(() => office.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		/** Hex color for dispatch chips, e.g. `#3b82f6`. */
		color: text('color').notNull().default(''),
		durationMin: integer('duration_min').notNull().default(60),
		/** Flat amount invoiced for this work; null = quote it. */
		defaultAmount: integer('default_amount'),
		/** Billable cents/hour — time entries become a Labor line in invoice prefill; null = no labor billing. */
		hourlyRate: integer('hourly_rate'),
		/** Staff member (org `member` row) jobs default to. */
		technicianId: text('technician_id').references(() => member.id, { onDelete: 'set null' }),
		/** Checklist labels copied onto each new job of this type. */
		checklist: text('checklist').array(),
		/** Completion gates: the job can't be marked complete until every checklist
		 * item is done / at least one photo is attached. */
		requireChecklist: boolean('require_checklist').notNull().default(false),
		requirePhoto: boolean('require_photo').notNull().default(false),
		/** Customer signature required before completion. */
		requireSignature: boolean('require_signature').notNull().default(false),
		/** Whether the type is selectable on the public /book page. */
		bookable: boolean('bookable').notNull().default(true),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('job_type_org_idx').on(t.organizationId)]
);

export const jobStatus = pgEnum('job_status', [
	'unscheduled',
	'scheduled',
	'dispatched',
	'in_progress',
	'done',
	'cancelled'
]);
export const jobPriority = pgEnum('job_priority', ['low', 'normal', 'high', 'urgent']);
export const jobSource = pgEnum('job_source', [
	'manual',
	'booking',
	'estimate',
	'agreement',
	'maintenance'
]);

/** One piece of work for a customer at a service location. */
export const job = pgTable(
	'job',
	{
		id: id(),
		organizationId: orgId(),
		/** Human-readable number, e.g. J-1042. */
		number: integer('number').notNull(),
		jobTypeId: text('job_type_id').references(() => jobType.id, { onDelete: 'set null' }),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		serviceLocationId: text('service_location_id').references(() => serviceLocation.id, {
			onDelete: 'set null'
		}),
		equipmentId: text('equipment_id').references(() => equipment.id, { onDelete: 'set null' }),
		officeId: text('office_id').references(() => office.id, { onDelete: 'set null' }),
		technicianId: text('technician_id').references(() => member.id, { onDelete: 'set null' }),
		summary: text('summary').notNull().default(''),
		description: text('description').notNull().default(''),
		status: jobStatus('status').notNull().default('unscheduled'),
		priority: jobPriority('priority').notNull().default('normal'),
		/** Flagged when the job can't proceed (waiting on parts/approval) — dispatcher attention. */
		blocked: boolean('blocked').notNull().default(false),
		/** Warranty/no-charge work — skips auto-invoice-on-complete and is badged. */
		warranty: boolean('warranty').notNull().default(false),
		/** Customer's requested timing from a booking/portal request ("weekday mornings"). */
		preferredTime: text('preferred_time'),
		/** Communicated arrival window shown to customer/tech ("8-10 AM"); display only. */
		arrivalWindow: text('arrival_window'),
		/** Visit window; null while unscheduled. */
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		source: jobSource('source').notNull().default('manual'),
		/** Predecessor job that must finish before this one can be scheduled/started. */
		dependsOnJobId: text('depends_on_job_id').references((): AnyPgColumn => job.id, {
			onDelete: 'set null'
		}),
		estimateId: text('estimate_id'),
		/** For agreement-generated visits: the agreement + which visit of the billed period. */
		serviceAgreementId: text('service_agreement_id'),
		/** Billed period start (`YYYY-MM-DD`) the visit belongs to. */
		agreementPeriod: text('agreement_period'),
		agreementVisitNo: integer('agreement_visit_no'),
		/** For maintenance-schedule jobs: the schedule + the due date it covers. */
		maintenanceScheduleId: text('maintenance_schedule_id'),
		schedulePeriod: date('schedule_period', { mode: 'string' }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		/** Optional note recorded when the job is cancelled. */
		cancelReason: text('cancel_reason'),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		/** Portal rating of the completed visit (1-5 stars + optional note). */
		rating: integer('rating'),
		ratingNote: text('rating_note'),
		ratedAt: timestamp('rated_at', { withTimezone: true }),
		/** Customer sign-off captured on completion — PNG data URL (~tens of KB). */
		signature: text('signature'),
		signedName: text('signed_name'),
		signedAt: timestamp('signed_at', { withTimezone: true }),
		/** Tech's "work performed" summary captured at completion — portal/work-order facing. */
		completionNotes: text('completion_notes').notNull().default(''),
		...timestamps
	},
	(t) => [
		index('job_org_starts_idx').on(t.organizationId, t.startsAt),
		index('job_org_status_idx').on(t.organizationId, t.status),
		index('job_customer_idx').on(t.customerId),
		index('job_technician_idx').on(t.technicianId),
		uniqueIndex('job_org_number_idx').on(t.organizationId, t.number),
		uniqueIndex('job_agreement_visit_idx').on(
			t.serviceAgreementId,
			t.agreementPeriod,
			t.agreementVisitNo
		),
		uniqueIndex('job_schedule_period_idx').on(t.maintenanceScheduleId, t.schedulePeriod)
	]
);

export const jobEventKind = pgEnum('job_event_kind', [
	'scheduled',
	'dispatched',
	'en_route',
	'on_site',
	'completed',
	'note',
	'confirmed'
]);

/** Technician status pings and notes on a job — the audit trail ServiceTitan calls dispatch history. */
export const jobEvent = pgTable(
	'job_event',
	{
		id: id(),
		organizationId: orgId(),
		jobId: text('job_id')
			.notNull()
			.references(() => job.id, { onDelete: 'cascade' }),
		kind: jobEventKind('kind').notNull(),
		/** Staff member who triggered it (the tech, or the dispatcher). */
		memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
		note: text('note'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('job_event_job_idx').on(t.jobId, t.at),
		index('job_event_org_idx').on(t.organizationId, t.at)
	]
);

/** Clock-in/out or manually logged time a staff member spent on a job. */
export const jobTimeEntry = pgTable(
	'job_time_entry',
	{
		id: id(),
		organizationId: orgId(),
		jobId: text('job_id')
			.notNull()
			.references(() => job.id, { onDelete: 'cascade' }),
		memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
		/** Null while the member is still clocked in. */
		endedAt: timestamp('ended_at', { withTimezone: true }),
		note: text('note').notNull().default(''),
		...timestamps
	},
	(t) => [
		index('job_time_entry_job_idx').on(t.jobId),
		index('job_time_entry_member_idx').on(t.organizationId, t.memberId)
	]
);

export const estimateStatus = pgEnum('estimate_status', [
	'draft',
	'sent',
	'approved',
	'declined',
	'converted',
	'superseded',
	'expired'
]);

/** A quote for work. Customers approve it on a public link; approval books the job. */
export const estimate = pgTable(
	'estimate',
	{
		id: id(),
		organizationId: orgId(),
		number: integer('number').notNull(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		serviceLocationId: text('service_location_id').references(() => serviceLocation.id, {
			onDelete: 'set null'
		}),
		status: estimateStatus('status').notNull().default('draft'),
		notes: text('notes').notNull().default(''),
		/** Quote expires after this date; the public link stops accepting answers. */
		validUntil: date('valid_until', { mode: 'string' }),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		respondedAt: timestamp('responded_at', { withTimezone: true }),
		/** Typed name captured on the public approval page. */
		decisionName: text('decision_name'),
		decisionNote: text('decision_note'),
		/** Staff-only notes — never shown on the public quote. */
		internalNotes: text('internal_notes').notNull().default(''),
		/** Customer's purchase-order / reference number, printed on the quote. */
		customerPo: text('customer_po').notNull().default(''),
		/** Job created on approval. */
		jobId: text('job_id'),
		/** Kind of work quoted; drives suggested pricebook items + job type on approval. */
		jobTypeId: text('job_type_id').references(() => jobType.id, { onDelete: 'set null' }),
		/** Revision number — a revised estimate shares the number of the one it supersedes. */
		version: integer('version').notNull().default(1),
		/** Earlier revision this one replaces (set null keeps history queryable). */
		supersedesId: text('supersedes_id'),
		...timestamps
	},
	(t) => [
		index('estimate_org_idx').on(t.organizationId),
		index('estimate_customer_idx').on(t.customerId),
		uniqueIndex('estimate_org_number_idx').on(t.organizationId, t.number, t.version)
	]
);

export const estimateItem = pgTable(
	'estimate_item',
	{
		id: id(),
		estimateId: text('estimate_id')
			.notNull()
			.references(() => estimate.id, { onDelete: 'cascade' }),
		pricebookItemId: text('pricebook_item_id').references(() => pricebookItem.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		qty: doublePrecision('qty').notNull().default(1),
		/** Minor units. */
		unitPrice: integer('unit_price').notNull(),
		/** Customer may include/exclude the line on the public approval page. */
		optional: boolean('optional').notNull().default(false),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('estimate_item_estimate_idx').on(t.estimateId)]
);

export const invoiceStatus = pgEnum('invoice_status', ['open', 'void']);

/** A bill sent for a job. Line items live on `invoice_item`; the receivable is one `charge`. */
export const invoice = pgTable(
	'invoice',
	{
		id: id(),
		organizationId: orgId(),
		number: integer('number').notNull(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
		status: invoiceStatus('status').notNull().default('open'),
		issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
		dueDate: date('due_date', { mode: 'string' }).notNull(),
		notes: text('notes').notNull().default(''),
		...timestamps
	},
	(t) => [
		index('invoice_org_idx').on(t.organizationId),
		index('invoice_customer_idx').on(t.customerId),
		uniqueIndex('invoice_org_number_idx').on(t.organizationId, t.number)
	]
);

export const invoiceItem = pgTable(
	'invoice_item',
	{
		id: id(),
		invoiceId: text('invoice_id')
			.notNull()
			.references(() => invoice.id, { onDelete: 'cascade' }),
		pricebookItemId: text('pricebook_item_id').references(() => pricebookItem.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		qty: doublePrecision('qty').notNull().default(1),
		unitPrice: integer('unit_price').notNull(),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('invoice_item_invoice_idx').on(t.invoiceId)]
);

export const chargeKind = pgEnum('charge_kind', ['job', 'agreement', 'initial', 'other']);
export const chargeStatus = pgEnum('charge_status', ['open', 'paid', 'void', 'written_off']);

/** A receivable against a customer: invoice totals, agreement dues, one-off charges. */
export const charge = pgTable(
	'charge',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		agreementId: text('agreement_id').references(() => serviceAgreement.id, {
			onDelete: 'set null'
		}),
		jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
		invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
		kind: chargeKind('kind').notNull().default('other'),
		description: text('description'),
		/** Billing period start for agreement charges; keeps re-runs idempotent. */
		periodStart: date('period_start', { mode: 'string' }),
		dueDate: date('due_date', { mode: 'string' }).notNull(),
		amount: integer('amount').notNull(),
		status: chargeStatus('status').notNull().default('open'),
		...timestamps
	},
	(t) => [
		index('charge_org_due_idx').on(t.organizationId, t.dueDate),
		index('charge_customer_idx').on(t.customerId),
		index('charge_invoice_idx').on(t.invoiceId),
		uniqueIndex('charge_agreement_period_idx')
			.on(t.agreementId, t.periodStart)
			.where(sql`${t.kind} = 'agreement'`)
	]
);

export const paymentMethod = pgEnum('payment_method', [
	'card',
	'cash',
	'check',
	'bank',
	'stripe',
	'other'
]);

/** Money received from a customer, applied to a charge or held as credit. */
export const payment = pgTable(
	'payment',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		chargeId: text('charge_id').references(() => charge.id, { onDelete: 'set null' }),
		amount: integer('amount').notNull(),
		method: paymentMethod('method').notNull().default('card'),
		reference: text('reference'),
		notes: text('notes'),
		recordedBy: text('recorded_by').references(() => user.id, { onDelete: 'set null' }),
		/** Provider payment ID (e.g. a Stripe PaymentIntent) for payments made online. */
		externalId: text('external_id'),
		paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
		/** Set when this payment was refunded — a negative payment row records the money back. */
		refundedAt: timestamp('refunded_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('payment_org_paid_idx').on(t.organizationId, t.paidAt),
		uniqueIndex('payment_external_idx').on(t.externalId),
		index('payment_customer_idx').on(t.customerId)
	]
);

/** A workspace's settings for one online payment provider (`stripe`, …). */
export const paymentProvider = pgTable(
	'payment_provider',
	{
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		enabled: boolean('enabled').notNull().default(false),
		/** The workspace's own account with the provider, e.g. a Stripe Connect account. */
		accountId: text('account_id'),
		accountReady: boolean('account_ready').notNull().default(false),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		primaryKey({ columns: [t.organizationId, t.provider] }),
		index('payment_provider_account_idx').on(t.provider, t.accountId)
	]
);

export const webhook = pgTable(
	'webhook',
	{
		id: id(),
		organizationId: orgId(),
		url: text('url').notNull(),
		secret: text('secret').notNull(),
		events: text('events')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		enabled: boolean('enabled').notNull().default(true),
		lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
		lastDeliveryStatus: integer('last_delivery_status'),
		...timestamps
	},
	(t) => [index('webhook_org_idx').on(t.organizationId)]
);

/** One row per email sent, so each notice goes out once per recipient. */
export const notificationLog = pgTable(
	'notification_log',
	{
		id: id(),
		organizationId: orgId(),
		kind: text('kind').notNull(),
		entityId: text('entity_id').notNull(),
		recipient: text('recipient').notNull(),
		/** Read receipt for the staff inbox (null = unread). */
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('notification_log_once_idx').on(t.kind, t.entityId, t.recipient)]
);

export const activity = pgTable(
	'activity',
	{
		id: id(),
		organizationId: orgId(),
		actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		action: text('action').notNull(),
		summary: text('summary').notNull(),
		data: jsonb('data').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('activity_org_created_idx').on(t.organizationId, t.createdAt),
		index('activity_entity_idx').on(t.entityType, t.entityId)
	]
);

/** A stock item the shop carries — warehouse qty + reorder alert level. */
export const inventoryItem = pgTable(
	'inventory_item',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		sku: text('sku').notNull().default(''),
		/** Freeform unit label, e.g. "each", "ft", "box". */
		unit: text('unit').notNull().default('each'),
		/** Where it lives in the warehouse/van ("Bay 2", "Van A"). */
		location: text('location').notNull().default(''),
		/** Supplier's own SKU — makes reordering/POs unambiguous. */
		supplierSku: text('supplier_sku').notNull().default(''),
		qtyOnHand: integer('qty_on_hand').notNull().default(0),
		/** Attention-card alert when on-hand drops to this level; null = never alert. */
		reorderPoint: integer('reorder_point'),
		/** Cost per unit in minor units (cents). */
		unitCost: integer('unit_cost').notNull().default(0),
		notes: text('notes').notNull().default(''),
		...timestamps
	},
	(t) => [index('inventory_item_org_idx').on(t.organizationId, t.name)]
);

/** Stock consumed on a job — decrements the item's on-hand when logged, restores when removed. */
export const jobMaterial = pgTable(
	'job_material',
	{
		id: id(),
		organizationId: orgId(),
		jobId: text('job_id')
			.notNull()
			.references(() => job.id, { onDelete: 'cascade' }),
		inventoryItemId: text('inventory_item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'restrict' }),
		qty: integer('qty').notNull().default(1),
		/** Sell price per unit at the time it was logged, minor units. */
		unitPrice: integer('unit_price').notNull().default(0),
		memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
		/** When set, the units came from this tech's truck rather than warehouse stock. */
		sourceMemberId: text('source_member_id').references(() => member.id, {
			onDelete: 'set null'
		}),
		...timestamps
	},
	(t) => [
		index('job_material_job_idx').on(t.jobId),
		index('job_material_item_idx').on(t.organizationId, t.inventoryItemId)
	]
);

/** Units loaded onto a technician's truck — separate stock from the warehouse. */
export const truckStock = pgTable(
	'truck_stock',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		inventoryItemId: text('inventory_item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'cascade' }),
		qty: integer('qty').notNull().default(0),
		...timestamps
	},
	(t) => [
		uniqueIndex('truck_stock_member_item_idx').on(t.memberId, t.inventoryItemId),
		index('truck_stock_org_idx').on(t.organizationId)
	]
);

/** A non-material cost on a job — permits, subcontractors, dump fees, misc. */
export const jobExpense = pgTable(
	'job_expense',
	{
		id: id(),
		organizationId: orgId(),
		jobId: text('job_id')
			.notNull()
			.references(() => job.id, { onDelete: 'cascade' }),
		description: text('description').notNull(),
		vendor: text('vendor').notNull().default(''),
		/** Cost in minor units. */
		amount: integer('amount').notNull().default(0),
		/** Date the cost was incurred (iso date). */
		incurredOn: date('incurred_on', { mode: 'string' }),
		memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [
		index('job_expense_job_idx').on(t.jobId),
		index('job_expense_org_idx').on(t.organizationId)
	]
);

/** A to-do line on a job — seeded from the job type's checklist or added ad hoc. */
export const jobChecklistItem = pgTable(
	'job_checklist_item',
	{
		id: id(),
		organizationId: orgId(),
		jobId: text('job_id')
			.notNull()
			.references(() => job.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		done: boolean('done').notNull().default(false),
		doneAt: timestamp('done_at', { withTimezone: true }),
		sort: integer('sort').notNull().default(0),
		...timestamps
	},
	(t) => [index('job_checklist_job_idx').on(t.jobId, t.sort)]
);

export const poStatus = pgEnum('po_status', ['draft', 'ordered', 'received', 'cancelled']);

/** An order to a supplier for stock — draft → ordered → received applies qty to on-hand. */
export const purchaseOrder = pgTable(
	'purchase_order',
	{
		id: id(),
		organizationId: orgId(),
		number: integer('number').notNull(),
		supplier: text('supplier').notNull(),
		status: poStatus('status').notNull().default('draft'),
		expectedOn: date('expected_on', { mode: 'string' }),
		notes: text('notes').notNull().default(''),
		orderedAt: timestamp('ordered_at', { withTimezone: true }),
		receivedAt: timestamp('received_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [index('purchase_order_org_idx').on(t.organizationId, t.status)]
);

export const purchaseOrderItem = pgTable(
	'purchase_order_item',
	{
		id: id(),
		organizationId: orgId(),
		purchaseOrderId: text('purchase_order_id')
			.notNull()
			.references(() => purchaseOrder.id, { onDelete: 'cascade' }),
		inventoryItemId: text('inventory_item_id').references(() => inventoryItem.id, {
			onDelete: 'set null'
		}),
		/** Snapshot of the item name/unit so the line survives deleting the stock item. */
		name: text('name').notNull(),
		unit: text('unit').notNull().default('each'),
		qty: integer('qty').notNull().default(1),
		/** Units already received into stock — a line is fully received at receivedQty = qty. */
		receivedQty: integer('received_qty').notNull().default(0),
		unitCost: integer('unit_cost').notNull().default(0),
		...timestamps
	},
	(t) => [index('po_item_po_idx').on(t.purchaseOrderId)]
);

/** PTO/availability block for a staff member — dispatch flags these days. */
export const memberTimeOff = pgTable(
	'member_time_off',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		startsOn: date('starts_on', { mode: 'string' }).notNull(),
		endsOn: date('ends_on', { mode: 'string' }).notNull(),
		reason: text('reason').notNull().default(''),
		...timestamps
	},
	(t) => [index('member_time_off_member_idx').on(t.memberId, t.startsOn)]
);

/** A photo attached to a job — bytes live on disk under UPLOADS_DIR. */
export const jobPhoto = pgTable(
	'job_photo',
	{
		id: id(),
		organizationId: orgId(),
		jobId: text('job_id')
			.notNull()
			.references(() => job.id, { onDelete: 'cascade' }),
		uploadedById: text('uploaded_by_id').references(() => member.id, { onDelete: 'set null' }),
		fileName: text('file_name').notNull(),
		mime: text('mime').notNull(),
		size: integer('size').notNull(),
		path: text('path').notNull(),
		/** Staff flag: show the photo on the customer portal visit. */
		shared: boolean('shared').notNull().default(false),
		/** Visit phase tag: 'before' | 'during' | 'after'. */
		phase: text('phase'),
		...timestamps
	},
	(t) => [index('job_photo_job_idx').on(t.jobId)]
);

/** A recurring maintenance cadence on a customer — cron generates unscheduled jobs when due. */
export const maintenanceSchedule = pgTable(
	'maintenance_schedule',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		jobTypeId: text('job_type_id').references(() => jobType.id, { onDelete: 'set null' }),
		summary: text('summary').notNull().default(''),
		/** Days between visits (7, 30, 90, 180, 365 presets). */
		intervalDays: integer('interval_days').notNull(),
		nextDueOn: date('next_due_on', { mode: 'string' }).notNull(),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [
		index('maintenance_schedule_customer_idx').on(t.customerId),
		index('maintenance_schedule_due_idx').on(t.organizationId, t.active, t.nextDueOn)
	]
);

/** Texts queued during quiet hours (21:00–08:00 org-local); flushed by the cron. */
export const smsOutbox = pgTable(
	'sms_outbox',
	{
		id: id(),
		organizationId: orgId(),
		to: text('to').notNull(),
		body: text('body').notNull(),
		sendAfter: timestamp('send_after', { withTimezone: true }).notNull(),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		/** Twilio MessageSid captured at send time; correlates status callbacks. */
		providerSid: text('provider_sid'),
		/** queued → sent → delivered / undelivered / failed (Twilio MessageStatus). */
		status: text('status').notNull().default('queued'),
		statusDetail: text('status_detail'),
		...timestamps
	},
	(t) => [index('sms_outbox_pending_idx').on(t.organizationId, t.sendAfter)]
);

/** A dated reminder for a staff member, optionally tied to a customer/job. */
export const followUp = pgTable(
	'follow_up',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		customerId: text('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
		jobId: text('job_id').references(() => job.id, { onDelete: 'cascade' }),
		note: text('note').notNull(),
		/** Org-local date it should be done by. */
		dueOn: date('due_on', { mode: 'string' }).notNull(),
		doneAt: timestamp('done_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('follow_up_member_due_idx').on(t.memberId, t.dueOn),
		index('follow_up_customer_idx').on(t.customerId),
		index('follow_up_job_idx').on(t.jobId)
	]
);

/** A dispatcher's note pinned to one tech's day — banner on My Day, marker on the board. */
export const memberDayNote = pgTable(
	'member_day_note',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		/** Org-local date the note applies to. */
		on: date('on', { mode: 'string' }).notNull(),
		note: text('note').notNull(),
		...timestamps
	},
	(t) => [uniqueIndex('member_day_note_member_on_idx').on(t.memberId, t.on)]
);

/** A document attached to a customer account — contracts, permits, signed paperwork. */
export const customerDocument = pgTable(
	'customer_document',
	{
		id: id(),
		organizationId: orgId(),
		customerId: text('customer_id')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		uploadedById: text('uploaded_by_id').references(() => member.id, { onDelete: 'set null' }),
		fileName: text('file_name').notNull(),
		mime: text('mime').notNull(),
		size: integer('size').notNull(),
		path: text('path').notNull(),
		...timestamps
	},
	(t) => [index('customer_document_customer_idx').on(t.customerId)]
);
