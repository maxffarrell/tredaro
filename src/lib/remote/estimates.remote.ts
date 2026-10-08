import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/estimates.ts';
import { notifyEstimateSent } from '#lib/server/services/notifications.ts';
import { getCustomer } from './customers.remote.ts';
import { estimateInput, estimateUpdate, idSchema } from '#lib/schemas.ts';

export const getEstimates = query(
	v.optional(v.object({ status: v.optional(v.string()) })),
	async (opts) => svc.listEstimates((await requireOrg()).orgId, opts?.status)
);
export const getEstimate = query(idSchema, async (id) =>
	svc.getEstimate((await requireOrg()).orgId, id)
);
export const createEstimate = command(estimateInput, async (input) => {
	const e = await svc.createEstimate(await requireOrg(), input);
	await refreshQuery(getEstimates, undefined);
	void getCustomer(input.customerId).refresh();
	return e;
});
export const updateEstimate = command(estimateUpdate, async (input) => {
	const e = await svc.updateEstimate(await requireOrg(), input);
	await refreshQuery(getEstimate, e!.id);
	await refreshQuery(getEstimates, undefined);
	return e;
});

/** Marks the estimate sent and emails the customer the approve/decline link. */
export const sendEstimate = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	const r = await svc.sendEstimate(ctx, id);
	void notifyEstimateSent(ctx.orgId, id).catch((err) =>
		console.error('estimate email failed', err)
	);
	await refreshQuery(getEstimate, id);
	await refreshQuery(getEstimates, undefined);
	return r;
});

export const reviseEstimate = command(idSchema, async (id) => {
	const rev = await svc.reviseEstimate(await requireOrg(), id);
	await refreshQuery(getEstimate, id);
	await refreshQuery(getEstimates, undefined);
	return rev;
});
