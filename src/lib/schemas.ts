import * as v from 'valibot';

const optionalText = v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(5000))));
const requiredText = (label: string) =>
	v.pipe(v.string(), v.trim(), v.nonEmpty(`${label} is required`), v.maxLength(200));
const isoDate = v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD'));
/** Money is sent in cents. */
const cents = v.pipe(v.number(), v.integer(), v.minValue(0));
const emailField = v.optional(
	v.nullable(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email('Invalid email'))]))
);

export const idSchema = v.pipe(v.string(), v.nonEmpty());

export const customerStatuses = ['active', 'inactive'] as const;
export const customerTypes = ['residential', 'commercial'] as const;
export const agreementIntervals = ['month', 'year'] as const;
export const agreementStatuses = ['active', 'paused', 'cancelled'] as const;
export const pricebookKinds = ['service', 'material'] as const;
export const jobStatuses = [
	'unscheduled',
	'scheduled',
	'dispatched',
	'in_progress',
	'done',
	'cancelled'
] as const;
export const jobPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export const jobEventKinds = [
	'scheduled',
	'dispatched',
	'en_route',
	'on_site',
	'completed',
	'note',
	/** Customer tapped "Confirm" on the portal — no status change. */
	'confirmed'
] as const;
export const estimateStatuses = ['draft', 'sent', 'approved', 'declined', 'converted'] as const;
export const invoiceStatuses = ['open', 'void'] as const;
export const chargeKinds = ['job', 'agreement', 'initial', 'other'] as const;
export const chargeStatuses = ['open', 'paid', 'void'] as const;
export const paymentMethods = ['card', 'cash', 'check', 'bank', 'stripe', 'other'] as const;

export const customerInput = v.object({
	type: v.optional(v.picklist(customerTypes), 'residential'),
	companyName: optionalText,
	name: requiredText('Name'),
	email: emailField,
	phone: optionalText,
	officeId: v.optional(v.nullable(idSchema)),
	status: v.optional(v.picklist(customerStatuses), 'active'),
	notes: optionalText,
	since: v.optional(v.nullable(isoDate)),
	tags: v.optional(v.array(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(40))), []),
	smsOptOut: v.optional(v.boolean(), false),
	emailOptOut: v.optional(v.boolean(), false),
	leadSource: optionalText,
	preferredMemberId: v.optional(v.nullable(idSchema)),
	/** Credit hold — blocks new jobs until cleared. */
	onHold: v.optional(v.boolean(), false)
});
export const customerImportRow = v.object({
	name: requiredText('Name'),
	email: emailField,
	phone: optionalText
});
export const customerImportInput = v.pipe(
	v.array(customerImportRow),
	v.minLength(1),
	v.maxLength(2000)
);

export const customerUpdate = v.object({ id: idSchema, ...v.partial(customerInput).entries });

export const serviceLocationInput = v.object({
	customerId: idSchema,
	label: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	address1: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)), ''),
	city: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	state: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50)), ''),
	zip: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20)), ''),
	accessNotes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	isPrimary: v.optional(v.boolean(), false)
});
export const serviceLocationUpdate = v.object({
	id: idSchema,
	...v.partial(v.omit(serviceLocationInput, ['customerId'])).entries
});

export const equipmentInput = v.object({
	customerId: idSchema,
	serviceLocationId: v.optional(v.nullable(idSchema)),
	name: requiredText('Name'),
	category: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	brand: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	model: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	serial: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	installedOn: v.optional(v.nullable(isoDate)),
	warrantyUntil: v.optional(v.nullable(isoDate)),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), ''),
	active: v.optional(v.boolean(), true)
});
export const equipmentUpdate = v.object({
	id: idSchema,
	...v.partial(v.omit(equipmentInput, ['customerId'])).entries
});

export const agreementPlanInput = v.object({
	name: requiredText('Name'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	amount: cents,
	interval: v.optional(v.picklist(agreementIntervals), 'month'),
	initialFee: v.optional(cents, 0),
	includedVisits: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Job type generated visits default to; null = untyped. */
	jobTypeId: v.optional(v.nullable(idSchema)),
	listed: v.optional(v.boolean(), true),
	active: v.optional(v.boolean(), true)
});
export const agreementPlanUpdate = v.object({
	id: idSchema,
	...v.partial(agreementPlanInput).entries
});

export const agreementInput = v.object({
	customerId: idSchema,
	planId: idSchema,
	startsAt: v.optional(isoDate)
});
export const agreementUpdate = v.object({
	id: idSchema,
	status: v.optional(v.picklist(agreementStatuses))
});

export const officeInput = v.object({
	name: requiredText('Name'),
	address: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)), '')
});
export const officeUpdate = v.object({
	id: idSchema,
	...v.partial(officeInput).entries,
	archived: v.optional(v.boolean())
});

export const pricebookItemInput = v.object({
	kind: v.optional(v.picklist(pricebookKinds), 'service'),
	category: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	name: requiredText('Name'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	price: cents,
	durationMin: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(1440)))
	),
	active: v.optional(v.boolean(), true)
});
export const pricebookImportRow = v.object({
	name: requiredText('Name'),
	kind: v.optional(v.picklist(pricebookKinds), 'service'),
	category: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	/** Whole units of the org currency (e.g. dollars), converted to cents on import. */
	price: v.pipe(v.number(), v.minValue(0)),
	durationMin: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(1440)))
	)
});
export const pricebookImportInput = v.pipe(
	v.array(pricebookImportRow),
	v.minLength(1),
	v.maxLength(2000)
);

export const pricebookItemUpdate = v.object({
	id: idSchema,
	...v.partial(pricebookItemInput).entries
});

export const inventoryItemInput = v.object({
	name: requiredText('Name'),
	sku: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80)), ''),
	unit: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20)), 'each'),
	qtyOnHand: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	reorderPoint: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	unitCost: v.optional(cents, 0),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), '')
});
export const inventoryItemUpdate = v.object({
	id: idSchema,
	...v.partial(inventoryItemInput).entries
});
export const inventoryAdjustInput = v.object({
	id: idSchema,
	delta: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000))
});
export const jobMaterialInput = v.object({
	jobId: idSchema,
	inventoryItemId: idSchema,
	qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
	unitPrice: v.optional(cents, 0),
	/** Set to take the units from this tech's truck stock instead of the warehouse. */
	truckMemberId: v.optional(v.nullable(idSchema), null)
});
export const jobRepeatInput = v.object({
	jobId: idSchema,
	/** Repeat every N weeks from the job's scheduled time (unscheduled jobs clone into the queue). */
	everyWeeks: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(52)),
	count: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(24))
});
export const truckTransferInput = v.object({
	inventoryItemId: idSchema,
	memberId: idSchema,
	qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
	direction: v.picklist(['to_truck', 'to_warehouse'])
});
export const jobExpenseInput = v.object({
	jobId: idSchema,
	description: requiredText('Description'),
	vendor: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	amount: cents,
	incurredOn: v.optional(v.nullable(isoDate), null)
});

/** `sourceId` (the duplicate) is deleted; `targetId` (the survivor) absorbs its records. */
export const mergeCustomerInput = v.object({
	sourceId: idSchema,
	targetId: idSchema
});

export const textCustomerInput = v.object({
	customerId: idSchema,
	message: v.pipe(v.string(), v.trim(), v.minLength(1, 'Message required'), v.maxLength(500))
});

export const purchaseOrderInput = v.object({
	supplier: requiredText('Supplier'),
	expectedOn: v.optional(v.union([isoDate, v.literal('')]), ''),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	items: v.pipe(
		v.array(
			v.object({
				inventoryItemId: idSchema,
				qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
				unitCost: v.optional(cents, 0)
			})
		),
		v.minLength(1, 'Add at least one line')
	)
});
export const purchaseOrderUpdate = v.object({
	id: idSchema,
	supplier: v.optional(
		v.pipe(v.string(), v.trim(), v.nonEmpty('Supplier is required'), v.maxLength(200))
	),
	expectedOn: v.optional(v.union([isoDate, v.literal('')])),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)))
});

export const jobTypeInput = v.object({
	name: requiredText('Name'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	color: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20)), ''),
	durationMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(1440)), 60),
	defaultAmount: v.optional(v.nullable(cents)),
	officeId: v.optional(v.nullable(idSchema)),
	technicianId: v.optional(v.nullable(idSchema)),
	/** One checklist line per entry; copied onto new jobs of this type. */
	checklist: v.optional(v.array(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(200))), []),
	active: v.optional(v.boolean(), true)
});
export const jobTypeUpdate = v.object({ id: idSchema, ...v.partial(jobTypeInput).entries });

/** Local wall-clock time (`YYYY-MM-DDTHH:mm`) in the workspace timezone. */
const localDateTime = v.pipe(v.string(), v.isoDateTime('Use YYYY-MM-DDTHH:mm'));

export const jobInput = v.object({
	jobTypeId: v.optional(v.nullable(idSchema)),
	customerId: idSchema,
	serviceLocationId: v.optional(v.nullable(idSchema)),
	equipmentId: v.optional(v.nullable(idSchema)),
	officeId: v.optional(v.nullable(idSchema)),
	technicianId: v.optional(v.nullable(idSchema)),
	summary: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)), ''),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(5000)), ''),
	priority: v.optional(v.picklist(jobPriorities), 'normal'),
	preferredTime: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200))), null),
	/** Omit for an unscheduled job. */
	startsAt: v.optional(v.nullable(localDateTime))
});
export const jobUpdate = v.object({
	id: idSchema,
	jobTypeId: v.optional(v.nullable(idSchema)),
	serviceLocationId: v.optional(v.nullable(idSchema)),
	equipmentId: v.optional(v.nullable(idSchema)),
	officeId: v.optional(v.nullable(idSchema)),
	technicianId: v.optional(v.nullable(idSchema)),
	summary: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(5000))),
	priority: v.optional(v.picklist(jobPriorities)),
	blocked: v.optional(v.boolean()),
	/** Set to schedule; null unschedules. */
	startsAt: v.optional(v.nullable(localDateTime)),
	durationMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(1440))),
	cancelled: v.optional(v.boolean()),
	cancelReason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)))
});

/** Technician or dispatcher status ping on a job. */
export const jobEventInput = v.object({
	jobId: idSchema,
	kind: v.picklist(['dispatched', 'en_route', 'on_site', 'completed', 'note']),
	note: optionalText
});

/** Customer signature captured on job completion — PNG data URL from the signature pad. */
export const jobSignatureInput = v.object({
	jobId: idSchema,
	name: requiredText('Name'),
	signature: v.pipe(
		v.string(),
		v.maxLength(200_000, 'Signature image is too large'),
		v.check((s) => s.startsWith('data:image/png;base64,'), 'Signature must be a PNG data URL')
	)
});

/** Manually logged time on a job (start/end are wall-clock in the workspace timezone). */
export const timeEntryInput = v.object({
	jobId: idSchema,
	memberId: v.optional(v.nullable(idSchema)),
	startedAt: localDateTime,
	endedAt: v.optional(v.nullable(localDateTime)),
	note: optionalText
});

const lineItem = v.object({
	pricebookItemId: v.optional(v.nullable(idSchema)),
	name: requiredText('Item'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	qty: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
	unitPrice: cents
});

export const estimateInput = v.object({
	customerId: idSchema,
	serviceLocationId: v.optional(v.nullable(idSchema)),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), ''),
	items: v.pipe(v.array(lineItem), v.minLength(1, 'Add at least one line item'))
});
export const estimateUpdate = v.object({
	id: idSchema,
	serviceLocationId: v.optional(v.nullable(idSchema)),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
	validUntil: v.optional(v.nullable(isoDate)),
	items: v.optional(v.pipe(v.array(lineItem), v.minLength(1, 'Add at least one line item')))
});

/** Public estimate decision: approve (typed name) or decline (optional reason). */
export const estimateDecisionInput = v.object({
	token: requiredText('Token'),
	approve: v.boolean(),
	name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120)), ''),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), '')
});

export const invoiceInput = v.object({
	customerId: idSchema,
	jobId: v.optional(v.nullable(idSchema)),
	dueDate: isoDate,
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), ''),
	items: v.pipe(v.array(lineItem), v.minLength(1, 'Add at least one line item'))
});
export const invoiceUpdate = v.object({
	id: idSchema,
	status: v.optional(v.picklist(invoiceStatuses)),
	dueDate: v.optional(isoDate),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)))
});

export const refundInput = v.object({
	paymentId: idSchema
});

export const chargeInput = v.object({
	customerId: idSchema,
	jobId: v.optional(v.nullable(idSchema)),
	kind: v.optional(v.picklist(chargeKinds), 'other'),
	description: optionalText,
	amount: cents,
	dueDate: isoDate
});
export const chargeUpdate = v.object({
	id: idSchema,
	status: v.optional(v.picklist(chargeStatuses)),
	description: optionalText,
	amount: v.optional(cents),
	dueDate: v.optional(isoDate)
});

export const paymentInput = v.object({
	customerId: idSchema,
	chargeId: v.optional(v.nullable(idSchema)),
	amount: v.pipe(v.number(), v.integer(), v.minValue(1)),
	method: v.optional(v.picklist(paymentMethods), 'card'),
	reference: optionalText,
	notes: optionalText
});

export const settingsInput = v.object({
	timezone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
	currency: v.optional(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.length(3))),
	publicPage: v.optional(v.boolean()),
	tagline: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	address: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	phone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50))),
	website: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	reviewUrl: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	emailNotifications: v.optional(v.boolean()),
	smsNotifications: v.optional(v.boolean()),
	staffDigest: v.optional(v.boolean()),
	invoiceTermsDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
	autoInvoiceOnComplete: v.optional(v.boolean())
});

export const webhookInput = v.object({
	url: v.pipe(v.string(), v.trim(), v.url('Use a full https:// URL')),
	events: v.array(v.pipe(v.string(), v.trim(), v.maxLength(60)))
});

/** Public booking-page form: request a service call. */
export const bookingInput = v.object({
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: requiredText('Phone'),
	jobTypeId: v.optional(v.nullable(idSchema)),
	/** Address of the work site. */
	address1: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)), ''),
	city: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
	state: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50)), ''),
	zip: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20)), ''),
	/** Preferred day/time, free text ("weekday mornings"). */
	preferredTime: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), ''),
	/** Honeypot: must stay empty. */
	website: v.optional(v.string(), '')
});

/** Portal customers requesting work on an existing location. */
export const portalRequestInput = v.object({
	customerId: idSchema,
	serviceLocationId: v.optional(v.nullable(idSchema)),
	jobTypeId: v.optional(v.nullable(idSchema)),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), ''),
	preferredTime: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), '')
});

export const portalContactInput = v.object({
	customerId: idSchema,
	email: v.optional(
		v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email('Invalid email'))]),
		''
	),
	phone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40)), ''),
	smsOptOut: v.optional(v.boolean()),
	emailOptOut: v.optional(v.boolean())
});

export const timeOffInput = v.object({
	memberId: idSchema,
	startsOn: isoDate,
	endsOn: isoDate,
	reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), '')
});

export const checklistItemInput = v.object({
	jobId: idSchema,
	label: requiredText('Label')
});
export const checklistToggleInput = v.object({
	id: idSchema,
	done: v.boolean()
});
export const activityFilter = v.object({
	entityType: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40)))
});

/** A recurring maintenance cadence on a customer. */
export const scheduleInput = v.object({
	customerId: idSchema,
	jobTypeId: v.optional(v.nullable(idSchema)),
	summary: optionalText,
	intervalDays: v.picklist([7, 14, 30, 90, 180, 365]),
	nextDueOn: isoDate,
	active: v.optional(v.boolean(), true)
});
export const scheduleUpdate = v.object({
	id: idSchema,
	jobTypeId: v.optional(v.nullable(idSchema)),
	summary: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	intervalDays: v.optional(v.picklist([7, 14, 30, 90, 180, 365])),
	nextDueOn: v.optional(isoDate),
	active: v.optional(v.boolean())
});
