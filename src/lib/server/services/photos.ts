import { error } from '@sveltejs/kit';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { UPLOADS_DIR } from '$app/env/private';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { customer, job, jobPhoto, member } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';

const ROOT = UPLOADS_DIR || 'data/uploads';
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);

function storageDir(orgId: string) {
	return normalize(join(ROOT, orgId));
}

export async function listJobPhotos(orgId: string, jobId: string) {
	return db
		.select()
		.from(jobPhoto)
		.where(and(eq(jobPhoto.organizationId, orgId), eq(jobPhoto.jobId, jobId)))
		.orderBy(asc(jobPhoto.createdAt));
}

export async function saveJobPhoto(
	ctx: OrgContext,
	jobId: string,
	file: { name: string; type: string; size: number; bytes: Uint8Array }
) {
	const [j] = await db
		.select({ id: job.id, number: job.number })
		.from(job)
		.where(and(eq(job.id, jobId), eq(job.organizationId, ctx.orgId)))
		.limit(1);
	if (!j) error(404, 'Job not found');
	if (!ALLOWED.has(file.type))
		error(400, 'Unsupported file type — upload a JPG, PNG, WebP, GIF or HEIC');
	if (file.size > MAX_BYTES) error(400, 'File is larger than 15 MB');

	const id = crypto.randomUUID();
	const safe = (file.name || 'photo').replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'photo';
	const dir = storageDir(ctx.orgId);
	await mkdir(dir, { recursive: true });
	const rel = join(dir, `${id}-${safe}`);
	await writeFile(rel, file.bytes);

	const [m] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, ctx.userId), eq(member.organizationId, ctx.orgId)))
		.limit(1);

	const [row] = await db
		.insert(jobPhoto)
		.values({
			id,
			organizationId: ctx.orgId,
			jobId,
			uploadedById: m?.id ?? null,
			fileName: safe,
			mime: file.type,
			size: file.size,
			path: rel
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: jobId,
		action: 'photo_added',
		summary: `Photo added to job J-${j.number}`
	});
	return row;
}

/** Reads a photo for an authenticated org member. Returns file + metadata. */
export async function readJobPhoto(orgId: string, id: string) {
	const [row] = await db
		.select()
		.from(jobPhoto)
		.where(and(eq(jobPhoto.id, id), eq(jobPhoto.organizationId, orgId)))
		.limit(1);
	if (!row) error(404, 'Photo not found');
	const bytes = await readFile(row.path);
	return { row, bytes };
}

/** Toggles whether a photo is visible to the customer in their portal. */
export async function setJobPhotoShared(ctx: OrgContext, id: string, shared: boolean) {
	const [row] = await db
		.update(jobPhoto)
		.set({ shared })
		.where(and(eq(jobPhoto.id, id), eq(jobPhoto.organizationId, ctx.orgId)))
		.returning({ id: jobPhoto.id });
	if (!row) error(404, 'Photo not found');
	return row;
}

/** Reads a shared photo for a portal customer — only when it belongs to one of their jobs. */
export async function readPortalJobPhoto(userId: string, id: string) {
	const [row] = await db
		.select({ photo: jobPhoto })
		.from(jobPhoto)
		.innerJoin(job, eq(jobPhoto.jobId, job.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(and(eq(jobPhoto.id, id), eq(jobPhoto.shared, true), eq(customer.portalUserId, userId)))
		.limit(1);
	if (!row) error(404, 'Photo not found');
	const bytes = await readFile(row.photo.path);
	return { row: row.photo, bytes };
}

export async function deleteJobPhoto(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(jobPhoto)
		.where(and(eq(jobPhoto.id, id), eq(jobPhoto.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Photo not found');
	await unlink(row.path).catch(() => {});
	return row;
}
