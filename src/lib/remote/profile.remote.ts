import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { idSchema } from '#lib/schemas.ts';
import { disconnect, getLink, setCustomerSync, syncLink } from '#lib/server/profile/client.ts';

export const getProfileLink = query(async () => getLink(requireUser().user.id));

export const setProfileSync = command(
	v.object({ customerId: idSchema, on: v.boolean() }),
	async ({ customerId, on }) => {
		await setCustomerSync(requireUser().user.id, customerId, on);
		void getProfileLink().refresh();
	}
);

export const syncProfileNow = command(async () => {
	const r = await syncLink(requireUser().user.id);
	void getProfileLink().refresh();
	return r;
});

export const disconnectProfile = command(async () => {
	await disconnect(requireUser().user.id);
	void getProfileLink().refresh();
});
