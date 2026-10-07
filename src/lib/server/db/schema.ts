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
	uniqueIndex
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
	website: text('website').notNull().default(''),
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
		/** Job type generated visits use (defaults duration/assignee/office); null = untyped. */
		jobTypeId: text('job_type_id'),
		/** Shown on the public booking page. */
		listed: boolean('listed').notNull().default(true),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('agreement_plan_org_idx').on(t.organizationId)]
);

export const agreementStatus = pgEnum('agreement_status', ['active', 'paused', 'cancelled']);

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
		/** Typical duration for scheduling; null for materials. */
		durationMin: integer('duration_min'),
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
		/** Staff member (org `member` row) jobs default to. */
		technicianId: text('technician_id').references(() => member.id, { onDelete: 'set null' }),
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
export const jobSource = pgEnum('job_source', ['manual', 'booking', 'estimate', 'agreement']);

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
		officeId: text('office_id').references(() => office.id, { onDelete: 'set null' }),
		technicianId: text('technician_id').references(() => member.id, { onDelete: 'set null' }),
		summary: text('summary').notNull().default(''),
		description: text('description').notNull().default(''),
		status: jobStatus('status').notNull().default('unscheduled'),
		priority: jobPriority('priority').notNull().default('normal'),
		/** Visit window; null while unscheduled. */
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		source: jobSource('source').notNull().default('manual'),
		estimateId: text('estimate_id'),
		/** For agreement-generated visits: the agreement + which visit of the billed period. */
		serviceAgreementId: text('service_agreement_id'),
		/** Billed period start (`YYYY-MM-DD`) the visit belongs to. */
		agreementPeriod: text('agreement_period'),
		agreementVisitNo: integer('agreement_visit_no'),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
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
		)
	]
);

export const jobEventKind = pgEnum('job_event_kind', [
	'scheduled',
	'dispatched',
	'en_route',
	'on_site',
	'completed',
	'note'
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
	'converted'
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
		sentAt: timestamp('sent_at', { withTimezone: true }),
		respondedAt: timestamp('responded_at', { withTimezone: true }),
		/** Typed name captured on the public approval page. */
		decisionName: text('decision_name'),
		decisionNote: text('decision_note'),
		/** Job created on approval. */
		jobId: text('job_id'),
		...timestamps
	},
	(t) => [
		index('estimate_org_idx').on(t.organizationId),
		index('estimate_customer_idx').on(t.customerId),
		uniqueIndex('estimate_org_number_idx').on(t.organizationId, t.number)
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
		qty: integer('qty').notNull().default(1),
		/** Minor units. */
		unitPrice: integer('unit_price').notNull(),
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
		qty: integer('qty').notNull().default(1),
		unitPrice: integer('unit_price').notNull(),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('invoice_item_invoice_idx').on(t.invoiceId)]
);

export const chargeKind = pgEnum('charge_kind', ['job', 'agreement', 'initial', 'other']);
export const chargeStatus = pgEnum('charge_status', ['open', 'paid', 'void']);

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
