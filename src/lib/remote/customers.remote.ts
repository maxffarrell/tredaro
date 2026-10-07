import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/customers.ts';
import { portalToken } from '#lib/server/services/portal.ts';
import { appOrigin } from '#lib/server/email.ts';
import {
	customerImportInput,
	customerInput,
	customerUpdate,
	equipmentInput,
	equipmentUpdate,
	idSchema,
	serviceLocationInput,
	serviceLocationUpdate
} from '#lib/schemas.ts';

export const getCustomers = query(
	v.optional(v.object({ q: v.optional(v.string()) })),
	async (opts) => svc.listCustomers((await requireOrg()).orgId, opts?.q)
);
export const getCustomer = query(idSchema, async (id) =>
	svc.getCustomer((await requireOrg()).orgId, id)
);
export const createCustomer = command(customerInput, async (input) => {
	const c = await svc.createCustomer(await requireOrg(), input);
	await refreshQuery(getCustomers, undefined);
	return c;
});
export const importCustomers = command(customerImportInput, async (rows) => {
	const r = await svc.importCustomers(await requireOrg(), rows);
	await refreshQuery(getCustomers, undefined);
	return r;
});
export const updateCustomer = command(customerUpdate, async (input) => {
	const c = await svc.updateCustomer(await requireOrg(), input);
	await refreshQuery(getCustomer, c!.id);
	await refreshQuery(getCustomers, undefined);
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
