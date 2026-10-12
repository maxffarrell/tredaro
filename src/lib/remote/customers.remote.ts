import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { getDashboard } from './workspace.remote.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/customers.ts';
import { chargeOpenBalance } from '#lib/server/services/billing.ts';
import { createPortalInvite } from '#lib/server/services/portal.ts';
import {
	deleteCustomerDoc,
	setCustomerDocShared,
	setCustomerDocExpiry
} from '#lib/server/services/photos.ts';
import { listJobs } from '#lib/server/services/jobs.ts';
import {
	emailStatement,
	previewAnnouncement as previewAnnouncementSvc,
	sendAnnouncement as sendAnnouncementSvc,
	textCustomer
} from '#lib/server/services/notifications.ts';
import { appOrigin } from '#lib/server/email.ts';
import {
	announcementInput,
	announcementSegmentInput,
	customerImportInput,
	contactDeleteInput,
	contactInput,
	customerDocDeleteInput,
	customerDocExpiryInput,
	customerDocShareInput,
	contactUpdate,
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
export const getEquipmentJobs = query(idSchema, async (equipmentId) =>
	listJobs((await requireOrg()).orgId, { equipmentId })
);
export const textCustomerCmd = command(textCustomerInput, async (input) => {
	await textCustomer(await requireOrg(), input.customerId, input.message);
	await refreshQuery(getCustomer, input.customerId);
});
export const emailStatementCmd = command(idSchema, async (customerId) => {
	await emailStatement(await requireOrg(), customerId);
	await refreshQuery(getCustomer, customerId);
	return { sent: true };
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

export const addContact = command(contactInput, async (input) => {
	const ctx = await requireOrg();
	const r = await svc.addContact(ctx.orgId, input);
	await refreshQuery(getCustomer, input.customerId);
	return r;
});
export const updateContact = command(contactUpdate, async (input) => {
	const ctx = await requireOrg();
	const r = await svc.updateContact(ctx.orgId, input);
	await refreshQuery(getCustomer, input.customerId);
	return r;
});
export const removeContact = command(contactDeleteInput, async (input) => {
	const ctx = await requireOrg();
	const r = await svc.removeContact(ctx.orgId, input.id);
	await refreshQuery(getCustomer, input.customerId);
	return r;
});

export const removeCustomerDoc = command(customerDocDeleteInput, async (input) => {
	await deleteCustomerDoc(await requireOrg(), input.id);
	await refreshQuery(getCustomer, input.customerId);
	return { ok: true };
});

export const shareCustomerDoc = command(customerDocShareInput, async (input) => {
	await setCustomerDocShared(await requireOrg(), input.id, input.shared);
	await refreshQuery(getCustomer, input.customerId);
	return { ok: true };
});

export const setDocExpiry = command(customerDocExpiryInput, async (input) => {
	await setCustomerDocExpiry(await requireOrg(), input.id, input.expiresOn ?? null);
	await refreshQuery(getCustomer, input.customerId);
	return { ok: true };
});

export const chargeCardOnFile = command(idSchema, async (customerId) => {
	const result = await chargeOpenBalance(await requireOrg(), customerId);
	await refreshQuery(getCustomer, customerId);
	await refreshQuery(getDashboard);
	return result;
});

export const removeSavedCard = command(idSchema, async (customerId) => {
	await svc.removeSavedCard(await requireOrg(), customerId);
	await refreshQuery(getCustomer, customerId);
	return { ok: true };
});

export const revokePortalAccess = command(idSchema, async (customerId) => {
	await svc.revokePortalAccess(await requireOrg(), customerId);
	await refreshQuery(getCustomer, customerId);
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
export const getPortalInvite = command(idSchema, async (customerId) => {
	const token = await createPortalInvite(await requireOrg(), customerId);
	return { url: `${appOrigin()}/portal/claim/${token}` };
});

export const getMergePreview = query(idSchema, async (id) => {
	const ctx = await requireOrg();
	return svc.getMergePreview(ctx, id);
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

/** Reachable-counts preview for the announcement dialog. */
export const previewAnnouncement = query(announcementSegmentInput, async (seg) => {
	const { orgId } = await requireOrg('admin');
	return previewAnnouncementSvc(orgId, seg);
});

/** Blasts a one-off email/SMS announcement to a customer segment. */
export const sendAnnouncement = command(announcementInput, async (input) => {
	const ctx = await requireOrg('admin');
	return sendAnnouncementSvc(ctx, input);
});
