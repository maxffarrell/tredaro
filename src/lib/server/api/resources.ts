import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import type { OrgContext } from '#lib/server/context.ts';
import * as customers from '#lib/server/services/customers.ts';
import * as billing from '#lib/server/services/billing.ts';
import * as jobs from '#lib/server/services/jobs.ts';
import * as estimates from '#lib/server/services/estimates.ts';
import * as inventory from '#lib/server/services/inventory.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import * as s from '#lib/schemas.ts';

type Resource = {
	description: string;
	list: (ctx: OrgContext, url: URL) => Promise<unknown>;
	get?: (ctx: OrgContext, id: string) => Promise<unknown>;
	create?: { schema: v.GenericSchema; run: (ctx: OrgContext, input: never) => Promise<unknown> };
	update?: { schema: v.GenericSchema; run: (ctx: OrgContext, input: never) => Promise<unknown> };
};

/** Public REST surface, mirrored by the OpenAPI document. Mutations go through the same services as the UI. */
export const resources: Record<string, Resource> = {
	customers: {
		description: 'Customers (`?q=` to search)',
		list: (ctx, url) => customers.listCustomers(ctx.orgId, url.searchParams.get('q') ?? undefined),
		get: (ctx, id) => customers.getCustomer(ctx.orgId, id),
		create: { schema: s.customerInput, run: customers.createCustomer as never },
		update: { schema: s.customerUpdate, run: customers.updateCustomer as never }
	},
	jobs: {
		description:
			'Jobs between `?from=` and `?to=` (ISO dates, default next 14 days); `?status=unscheduled` for the queue',
		list: async (ctx, url) => {
			const from = url.searchParams.get('from')
				? new Date(`${url.searchParams.get('from')}T00:00:00Z`)
				: new Date();
			const to = url.searchParams.get('to')
				? new Date(`${url.searchParams.get('to')}T00:00:00Z`)
				: new Date(from.getTime() + 14 * 86400_000);
			return jobs.listJobs(ctx.orgId, {
				from,
				to,
				status: url.searchParams.getAll('status'),
				technicianId: url.searchParams.get('technicianId') ?? undefined
			});
		},
		get: (ctx, id) => jobs.getJob(ctx.orgId, id),
		create: {
			schema: s.jobInput,
			run: async (ctx: OrgContext, input: never) => {
				const settings = await getSettings(ctx.orgId);
				return jobs.createJob(ctx, settings.timezone, input as never);
			}
		},
		update: {
			schema: s.jobUpdate,
			run: async (ctx: OrgContext, input: never) => {
				const settings = await getSettings(ctx.orgId);
				return jobs.updateJob(ctx, settings.timezone, input as never);
			}
		}
	},
	equipment: {
		description: 'Installed customer equipment (`?customerId=` to filter)',
		list: (ctx, url) =>
			customers.listEquipment(ctx.orgId, url.searchParams.get('customerId') ?? undefined),
		get: (ctx, id) => customers.getEquipment(ctx.orgId, id),
		create: { schema: s.equipmentInput, run: customers.createEquipment as never },
		update: { schema: s.equipmentUpdate, run: customers.updateEquipment as never }
	},
	job_types: {
		description: 'Job types (service catalog for dispatch)',
		list: (ctx) => jobs.listJobTypes(ctx.orgId),
		create: { schema: s.jobTypeInput, run: jobs.createJobType as never },
		update: { schema: s.jobTypeUpdate, run: jobs.updateJobType as never }
	},
	estimates: {
		description: 'Estimates (`?status=sent`)',
		list: (ctx, url) =>
			estimates.listEstimates(ctx.orgId, url.searchParams.get('status') ?? undefined),
		get: (ctx, id) => estimates.getEstimate(ctx.orgId, id),
		create: { schema: s.estimateInput, run: estimates.createEstimate as never },
		update: { schema: s.estimateUpdate, run: estimates.updateEstimate as never }
	},
	invoices: {
		description: 'Invoices (`?status=open`)',
		list: (ctx, url) =>
			billing.listInvoices(ctx.orgId, url.searchParams.get('status') ?? undefined),
		get: (ctx, id) => billing.getInvoice(ctx.orgId, id),
		create: { schema: s.invoiceInput, run: billing.createInvoice as never },
		update: { schema: s.invoiceUpdate, run: billing.updateInvoice as never }
	},
	agreements: {
		description: 'Service agreements (`?status=active`)',
		list: (ctx, url) => billing.listAgreements(ctx.orgId, url.searchParams.getAll('status')),
		get: (ctx, id) => billing.getAgreement(ctx.orgId, id),
		create: { schema: s.agreementInput, run: billing.createAgreement as never },
		update: { schema: s.agreementUpdate, run: billing.updateAgreement as never }
	},
	plans: {
		description: 'Service agreement plans',
		list: (ctx) => billing.listPlans(ctx.orgId),
		get: (ctx, id) => billing.getPlan(ctx.orgId, id),
		create: { schema: s.agreementPlanInput, run: billing.createPlan as never },
		update: { schema: s.agreementPlanUpdate, run: billing.updatePlan as never }
	},
	pricebook: {
		description: 'Pricebook items (`?q=` to search)',
		list: (ctx, url) => billing.listPricebook(ctx.orgId, url.searchParams.get('q') ?? undefined),
		create: { schema: s.pricebookItemInput, run: billing.createPricebookItem as never },
		update: { schema: s.pricebookItemUpdate, run: billing.updatePricebookItem as never }
	},
	charges: {
		description: 'Receivables against customers (`?status=open`)',
		list: (ctx, url) => billing.listCharges(ctx.orgId, url.searchParams.get('status') ?? undefined),
		create: { schema: s.chargeInput, run: billing.addCharge as never },
		update: { schema: s.chargeUpdate, run: billing.updateCharge as never }
	},
	payments: {
		description: 'Record received payments',
		list: (ctx) => billing.listPayments(ctx.orgId),
		create: { schema: s.paymentInput, run: billing.recordPayment as never }
	},
	technicians: {
		description: 'Org technicians (read-only)',
		list: (ctx) => jobs.listTechnicians(ctx.orgId)
	},
	inventory: {
		description: 'Warehouse stock items (`?low=1` for at/below reorder point)',
		list: async (ctx, url) =>
			url.searchParams.get('low') ? inventory.lowStock(ctx.orgId) : inventory.listItems(ctx.orgId),
		create: { schema: s.inventoryItemInput, run: inventory.createItem as never },
		update: { schema: s.inventoryItemUpdate, run: inventory.updateItem as never }
	},
	purchase_orders: {
		description:
			'Purchase orders to suppliers (create/update status via `?` — see /inventory UI for receive flow)',
		list: (ctx) => inventory.listPurchaseOrders(ctx.orgId),
		create: { schema: s.purchaseOrderInput, run: inventory.createPurchaseOrder as never },
		update: { schema: s.purchaseOrderUpdate, run: inventory.updatePurchaseOrder as never }
	},
	truck_stock: {
		description: 'Per-technician truck inventory (read-only)',
		list: (ctx) => inventory.listTruckStock(ctx.orgId)
	}
};

export function resource(name: string) {
	const r = resources[name];
	if (!r) error(404, `Unknown resource "${name}"`);
	return r;
}

export async function parseBody<T extends v.GenericSchema>(
	schema: T,
	request: Request,
	extra: Record<string, unknown> = {}
) {
	const body = await request.json().catch(() => error(400, 'Body must be JSON'));
	const result = v.safeParse(schema, { ...body, ...extra });
	if (!result.success) {
		error(422, result.issues.map((i) => `${v.getDotPath(i) ?? 'body'}: ${i.message}`).join('; '));
	}
	return result.output as v.InferOutput<T>;
}
