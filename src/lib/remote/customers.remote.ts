import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { getDashboard } from './workspace.remote.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/customers.ts';
import { portalToken } from '#lib/server/services/portal.ts';
import { textCustomer } from '#lib/server/services/notifications.ts';
import { appOrigin } from '#lib/server/email.ts';
import {
	customerImportInput,
	customerInput,
	customerUpdate,
	equipmentInput,
	equipmentUpdate,
	idSchema,
	mergeCustomerInput,
	serviceLocationInput,
	serviceLocationUpdate,
	textCustomerInput
} from '#lib/schemas.ts';

export const getCustomers = query(
	v.optional(v.object({ q: v.optional(v.string()) })),
	async (opts) => svc.listCustomers((await requireOrg()).orgId, opts?.q)
);
export const getCustomer = query(idSchema, async (id) =>
	svc.getCustomer((await requireOrg()).orgId, id)
);
export const textCustomerCmd = command(textCustomerInput, async (input) => {
	await textCustomer(await requireOrg(), input.customerId, input.message);
	await refreshQuery(getCustomer, input.customerId);
});
export const createCustomer = command(customerInput, async (input) => {
	const c = await svc.createCustomer(await requireOrg(), input);
	await refreshQuery(getCustomers, undefined);
	await refreshQuery(getDashboard, undefined);
	return c;
});
export const importCustomers = command(customerImportInput, async (rows) => {
	const r = await svc.importCustomers(await requireOrg(), rows);
	await refreshQuery(getCustomers, undefined);
	await refreshQuery(getDashboard, undefined);
	return r;
});
export const updateCustomer = command(customerUpdate, async (input) => {
	const c = await svc.updateCustomer(await requireOrg(), input);
	await refreshQuery(getCustomer, c!.id);
	await refreshQuery(getCustomers, undefined);
	// Contact fields drive duplicate detection — a new shared email/phone flags it.
	await refreshQuery(getCustomerDuplicates, c!.id);
	return c;
});

export const addServiceLocation = command(serviceLocationInput, async (input) => {
	const l = await svc.addServiceLocation(await requireOrg(), input);
	await refreshQuery(getCustomer, input.customerId);
	return l;
});
export const updateServiceLocation = command(serviceLocationUpdate, async (input) => {
	const l = await svc.updateServiceLocation(await requireOrg(), input);
	return l;
});

export const createEquipment = command(equipmentInput, async (input) => {
	const e = await svc.createEquipment(await requireOrg(), input);
	await refreshQuery(getCustomer, input.customerId);
	return e;
});
export const updateEquipment = command(equipmentUpdate, async (input) => {
	const e = await svc.updateEquipment(await requireOrg(), input);
	if (e) await refreshQuery(getCustomer, e.customerId);
	return e;
});

/** The shareable claim link for attaching a customer's login to the portal. */
export const getPortalInvite = query(idSchema, async (customerId) => {
	await requireOrg();
	return { url: `${appOrigin()}/portal/claim/${portalToken(customerId)}` };
});

export const getCustomerDuplicates = query(idSchema, async (id) =>
	svc.findDuplicates((await requireOrg()).orgId, id)
);

export const checkCustomerDuplicates = query(
	v.object({
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string())
	}),
	async (fields) => svc.findPotentialDuplicates((await requireOrg()).orgId, fields)
);
export const mergeCustomers = command(mergeCustomerInput, async (input) => {
	const c = await svc.mergeCustomers(await requireOrg('admin'), input.sourceId, input.targetId);
	await refreshQuery(getCustomer, input.targetId);
	await refreshQuery(getCustomerDuplicates, input.targetId);
	await refreshQuery(getCustomers, undefined);
	await refreshQuery(getDashboard, undefined);
	return c;
});
