import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { getDashboard } from './workspace.remote.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/billing.ts';
import {
	notifyInvoiceSent,
	notifyInvoiceTexted,
	notifyPaymentReceived
} from '#lib/server/services/notifications.ts';
import { getCustomer } from './customers.remote.ts';
import { getJobs } from './jobs.remote.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import {
	agreementInput,
	agreementPlanInput,
	agreementPlanUpdate,
	agreementUpdate,
	chargeInput,
	chargeUpdate,
	idSchema,
	invoiceInput,
	invoiceUpdate,
	paymentInput,
	pricebookItemInput,
	pricebookItemUpdate,
	pricebookImportInput,
	splitChargeInput
} from '#lib/schemas.ts';

export const getPlans = query(async () => svc.listPlans((await requireOrg()).orgId));
export const createPlan = command(agreementPlanInput, async (input) => {
	const p = await svc.createPlan(await requireOrg('admin'), input);
	await refreshQuery(getPlans, undefined);
	return p;
});
export const updatePlan = command(agreementPlanUpdate, async (input) => {
	const p = await svc.updatePlan(await requireOrg('admin'), input);
	await refreshQuery(getPlans, undefined);
	return p;
});

export const getAgreements = query(
	v.optional(v.object({ status: v.optional(v.array(v.string())) })),
	async (opts) => svc.listAgreements((await requireOrg()).orgId, opts?.status)
);
export const getAgreement = query(idSchema, async (id) =>
	svc.getAgreement((await requireOrg()).orgId, id)
);
export const createAgreement = command(agreementInput, async (input) => {
	const a = await svc.createAgreement(await requireOrg(), input);
	await refreshQuery(getAgreements, undefined);
	await refreshQuery(getCharges, undefined);
	void getCustomer(input.customerId).refresh();
	return a;
});
export const updateAgreement = command(agreementUpdate, async (input) => {
	const a = await svc.updateAgreement(await requireOrg(), input);
	await refreshQuery(getAgreements, undefined);
	await refreshQuery(getAgreement, input.id);
	void getCustomer(a.customerId).refresh();
	return a;
});
export const chargeAgreementNow = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	const r = await svc.chargeAgreementNow(ctx, id);
	await refreshQuery(getAgreements, undefined);
	await refreshQuery(getAgreement, id);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getJobs, undefined);
	return r;
});

export const getPricebook = query(
	v.optional(v.object({ q: v.optional(v.string()) })),
	async (opts) => svc.listPricebook((await requireOrg()).orgId, opts?.q)
);
export const createPricebookItem = command(pricebookItemInput, async (input) => {
	const i = await svc.createPricebookItem(await requireOrg(), input);
	await refreshQuery(getPricebook, undefined);
	return i;
});
export const importPricebookItems = command(pricebookImportInput, async (rows) => {
	const r = await svc.importPricebookItems(await requireOrg(), rows);
	await refreshQuery(getPricebook, undefined);
	return r;
});

export const updatePricebookItem = command(pricebookItemUpdate, async (input) => {
	const i = await svc.updatePricebookItem(await requireOrg(), input);
	await refreshQuery(getPricebook, undefined);
	return i;
});

const adjustPricesInput = v.object({
	/** Percent change, e.g. 5 or -10. */
	pct: v.pipe(v.number(), v.minValue(-90), v.maxValue(500)),
	category: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)))
});

/** Applies a % price change to active pricebook items, optionally one category. */
export const adjustPricebookPrices = command(adjustPricesInput, async (input) => {
	const r = await svc.adjustPricebookPrices(await requireOrg('admin'), input);
	await refreshQuery(getPricebook, undefined);
	return r;
});

export const getInvoices = query(
	v.optional(v.object({ status: v.optional(v.string()) })),
	async (opts) => svc.listInvoices((await requireOrg()).orgId, opts?.status)
);
export const getInvoice = query(idSchema, async (id) =>
	svc.getInvoice((await requireOrg()).orgId, id)
);
/** Suggested line items when invoicing a completed job. */
export const getInvoicePrefill = query(idSchema, async (jobId) =>
	svc.invoicePrefill((await requireOrg()).orgId, jobId)
);
export const createInvoice = command(invoiceInput, async (input) => {
	const inv = await svc.createInvoice(await requireOrg(), input);
	await refreshQuery(getInvoices, undefined);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getPayments, undefined);
	await refreshQuery(getDashboard, undefined);
	void getCustomer(input.customerId).refresh();
	return inv;
});
/** One click: draft an invoice per completed-but-uninvoiced job for a customer. */
export const invoiceUninvoicedJobs = command(
	v.object({ customerId: v.string(), dueDate: v.string() }),
	async (input) => {
		const res = await svc.invoiceUninvoicedJobs(
			await requireOrg(),
			input.customerId,
			input.dueDate
		);
		await refreshQuery(getInvoices, undefined);
		await refreshQuery(getCharges, undefined);
		await refreshQuery(getDashboard, undefined);
		void getCustomer(input.customerId).refresh();
		return res;
	}
);
export const updateInvoice = command(invoiceUpdate, async (input) => {
	const inv = await svc.updateInvoice(await requireOrg(), input);
	await refreshQuery(getInvoices, undefined);
	await refreshQuery(getInvoice, inv!.id);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getDashboard, undefined);
	return inv;
});

/** Emails the customer their invoice with the public pay link. `sent` is false without a customer email or if already sent. */
export const emailInvoice = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	// Existence + org check before the notification path fires.
	await svc.getInvoice(ctx.orgId, id);
	const sent = await notifyInvoiceSent(ctx.orgId, id);
	return { sent };
});

export const textInvoice = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	await svc.getInvoice(ctx.orgId, id);
	const sent = await notifyInvoiceTexted(ctx.orgId, id);
	return { sent };
});

export const getCustomerOpenBalance = query(idSchema, async (customerId) =>
	svc.customerOpenBalance((await requireOrg()).orgId, customerId)
);

export const getCharges = query(
	v.optional(v.object({ status: v.optional(v.string()) })),
	async (opts) => svc.listCharges((await requireOrg()).orgId, opts?.status)
);
export const splitCharge = command(splitChargeInput, async (input) => {
	const made = await svc.splitCharge(await requireOrg(), input);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getDashboard, undefined);
	return made;
});

export const addCharge = command(chargeInput, async (input) => {
	const c = await svc.addCharge(await requireOrg(), input);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getDashboard, undefined);
	void getCustomer(input.customerId).refresh();
	return c;
});
export const updateCharge = command(chargeUpdate, async (input) => {
	const c = await svc.updateCharge(await requireOrg(), input);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getDashboard, undefined);
	void getCustomer(c.customerId).refresh();
	return c;
});

const creditInput = v.object({
	customerId: idSchema,
	amount: v.pipe(v.number(), v.integer(), v.minValue(1)),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)))
});

/** Adds an account credit (negative open charge) to a customer. */
export const addCredit = command(creditInput, async (input) => {
	const c = await svc.addCredit(await requireOrg(), input);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getDashboard, undefined);
	void getCustomer(input.customerId).refresh();
	return c;
});

export const getPayments = query(async () => svc.listPayments((await requireOrg()).orgId));
export const recordPayment = command(paymentInput, async (input) => {
	const ctx = await requireOrg();
	const p = await svc.recordPayment(ctx, input);
	if (p?.length)
		void notifyPaymentReceived(
			ctx.orgId,
			p.map((r) => r.id)
		).catch((err) => console.error('payment receipt email failed', err));
	await refreshQuery(getPayments, undefined);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getInvoices, undefined);
	await refreshQuery(getDashboard, undefined);
	void getCustomer(input.customerId).refresh();
	return p;
});

export const refundPayment = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	await svc.refundPayment(ctx, id);
	await refreshQuery(getPayments, undefined);
	await refreshQuery(getCharges, undefined);
	await refreshQuery(getInvoices, undefined);
	await refreshQuery(getDashboard, undefined);
	return { refunded: true };
});

export const getCustomerBalance = query(idSchema, async (customerId) =>
	svc.customerBalance((await requireOrg()).orgId, customerId)
);

export const getCurrency = query(async () => {
	const { orgId } = await requireOrg();
	return (await getSettings(orgId)).currency;
});
