import { error } from '@sveltejs/kit';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { UPLOADS_DIR } from '$app/env/private';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	customer,
	customerDocument,
	equipment,
	job,
	jobDocument,
	jobPhoto,
	member,
	user
} from '#lib/server/db/schema.ts';
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
	file: { name: string; type: string; size: number; bytes: Uint8Array },
	phase?: string | null
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
			path: rel,
			phase: ['before', 'during', 'after'].includes(phase ?? '') ? phase : null
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

export async function listJobDocs(orgId: string, jobId: string) {
	return db
		.select({
			id: jobDocument.id,
			fileName: jobDocument.fileName,
			mime: jobDocument.mime,
			size: jobDocument.size,
			shared: jobDocument.shared,
			uploadedBy: user.name,
			createdAt: jobDocument.createdAt
		})
		.from(jobDocument)
		.leftJoin(member, eq(jobDocument.uploadedById, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(jobDocument.organizationId, orgId), eq(jobDocument.jobId, jobId)))
		.orderBy(desc(jobDocument.createdAt));
}

/** Saves any office-type file against a job (permits, contracts, signed paperwork). */
export async function saveJobDoc(
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
	if (!DOC_ALLOWED.has(file.type))
		error(400, 'Unsupported file type — upload a PDF, image, Word, Excel, CSV or text file');
	if (file.size > MAX_BYTES) error(400, 'File is larger than 15 MB');

	const id = crypto.randomUUID();
	const safe = (file.name || 'document').replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'document';
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
		.insert(jobDocument)
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
		action: 'document_added',
		summary: `Document "${safe}" added to job J-${j.number}`
	});
	return row;
}

/** Streams a job document to an authenticated org member. */
export async function readJobDoc(orgId: string, id: string) {
	const [row] = await db
		.select()
		.from(jobDocument)
		.where(and(eq(jobDocument.id, id), eq(jobDocument.organizationId, orgId)))
		.limit(1);
	if (!row) error(404, 'Document not found');
	const bytes = await readFile(row.path);
	return { row, bytes };
}

export async function deleteJobDoc(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(jobDocument)
		.where(and(eq(jobDocument.id, id), eq(jobDocument.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Document not found');
	await unlink(row.path).catch(() => {});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: row.jobId,
		action: 'document_removed',
		summary: `Document "${row.fileName}" removed`
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

/** Attaches (or replaces) a photo on an equipment unit. */
export async function saveEquipmentPhoto(
	ctx: OrgContext,
	equipmentId: string,
	file: { name: string; type: string; size: number; bytes: Uint8Array }
) {
	const [e] = await db
		.select({ id: equipment.id, photoPath: equipment.photoPath, name: equipment.name })
		.from(equipment)
		.where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, ctx.orgId)))
		.limit(1);
	if (!e) error(404, 'Equipment not found');
	if (!ALLOWED.has(file.type))
		error(400, 'Unsupported file type — upload a JPG, PNG, WebP, GIF or HEIC');
	if (file.size > MAX_BYTES) error(400, 'File is larger than 15 MB');

	const safe = (file.name || 'photo').replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'photo';
	const dir = storageDir(ctx.orgId);
	await mkdir(dir, { recursive: true });
	const rel = join(dir, `equip-${e.id}-${crypto.randomUUID()}-${safe}`);
	await writeFile(rel, file.bytes);
	if (e.photoPath) await unlink(e.photoPath).catch(() => {});
	await db
		.update(equipment)
		.set({ photoPath: rel, photoMime: file.type })
		.where(eq(equipment.id, e.id));
}

/** Reads an equipment photo for an authenticated org member. */
export async function readEquipmentPhoto(orgId: string, equipmentId: string) {
	const [e] = await db
		.select({
			id: equipment.id,
			name: equipment.name,
			photoPath: equipment.photoPath,
			photoMime: equipment.photoMime
		})
		.from(equipment)
		.where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, orgId)))
		.limit(1);
	if (!e?.photoPath) error(404, 'No photo');
	const bytes = await readFile(e.photoPath);
	return { row: e, bytes };
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

/** Share/unshare a job document with the customer on their portal. */
export async function setJobDocShared(ctx: OrgContext, id: string, shared: boolean) {
	const [row] = await db
		.update(jobDocument)
		.set({ shared })
		.where(and(eq(jobDocument.id, id), eq(jobDocument.organizationId, ctx.orgId)))
		.returning({ id: jobDocument.id });
	if (!row) error(404, 'Document not found');
	return row;
}

/** Reads a shared job document for a portal customer — only when it belongs to one of their jobs. */
export async function readPortalJobDoc(userId: string, id: string) {
	const [row] = await db
		.select({ doc: jobDocument })
		.from(jobDocument)
		.innerJoin(job, eq(jobDocument.jobId, job.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(
			and(eq(jobDocument.id, id), eq(jobDocument.shared, true), eq(customer.portalUserId, userId))
		)
		.limit(1);
	if (!row) error(404, 'Document not found');
	const bytes = await readFile(row.doc.path);
	return { row: row.doc, bytes };
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

// ---------- Customer documents (contracts, permits, paperwork) ----------

const DOC_ALLOWED = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/heic',
	'application/pdf',
	'text/plain',
	'text/csv',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

export async function listCustomerDocs(orgId: string, customerId: string) {
	return db
		.select({
			id: customerDocument.id,
			fileName: customerDocument.fileName,
			mime: customerDocument.mime,
			size: customerDocument.size,
			shared: customerDocument.shared,
			viaPortal: customerDocument.viaPortal,
			expiresOn: customerDocument.expiresOn,
			uploadedBy: user.name,
			createdAt: customerDocument.createdAt
		})
		.from(customerDocument)
		.leftJoin(member, eq(customerDocument.uploadedById, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(eq(customerDocument.organizationId, orgId), eq(customerDocument.customerId, customerId))
		)
		.orderBy(desc(customerDocument.createdAt));
}

export async function saveCustomerDoc(
	ctx: OrgContext,
	customerId: string,
	file: { name: string; type: string; size: number; bytes: Uint8Array }
) {
	const [c] = await db
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(and(eq(customer.id, customerId), eq(customer.organizationId, ctx.orgId)))
		.limit(1);
	if (!c) error(404, 'Customer not found');
	if (!DOC_ALLOWED.has(file.type))
		error(400, 'Unsupported file type — upload a PDF, image, Word, Excel, CSV or text file');
	if (file.size > MAX_BYTES) error(400, 'File is larger than 15 MB');

	const id = crypto.randomUUID();
	const safe = (file.name || 'document').replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'document';
	const dir = storageDir(ctx.orgId);
	await mkdir(dir, { recursive: true });
	const rel = join(dir, `doc-${id}-${safe}`);
	await writeFile(rel, file.bytes);

	const [m] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, ctx.userId), eq(member.organizationId, ctx.orgId)))
		.limit(1);

	const [row] = await db
		.insert(customerDocument)
		.values({
			id,
			organizationId: ctx.orgId,
			customerId,
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
		entityType: 'customer',
		entityId: customerId,
		action: 'document_added',
		summary: `Document "${safe}" added to ${c.name}`
	});
	return row;
}

/** Customer self-upload from the portal — same file/validation rules, viaPortal=true. */
export async function savePortalCustomerDoc(
	userId: string,
	customerId: string,
	file: { name: string; type: string; size: number; bytes: Uint8Array }
) {
	const [c] = await db
		.select({ id: customer.id, name: customer.name, orgId: customer.organizationId })
		.from(customer)
		.where(and(eq(customer.id, customerId), eq(customer.portalUserId, userId)))
		.limit(1);
	if (!c) error(404, 'Customer not found');
	if (!DOC_ALLOWED.has(file.type))
		error(400, 'Unsupported file type — upload a PDF, image, Word, Excel, CSV or text file');
	if (file.size > MAX_BYTES) error(400, 'File is larger than 15 MB');

	const id = crypto.randomUUID();
	const safe = (file.name || 'document').replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'document';
	const dir = storageDir(c.orgId);
	await mkdir(dir, { recursive: true });
	const rel = join(dir, `doc-${id}-${safe}`);
	await writeFile(rel, file.bytes);

	const [row] = await db
		.insert(customerDocument)
		.values({
			id,
			organizationId: c.orgId,
			customerId,
			fileName: safe,
			mime: file.type,
			size: file.size,
			path: rel,
			viaPortal: true
		})
		.returning();
	await emit({
		orgId: c.orgId,
		actorId: userId,
		entityType: 'customer',
		entityId: customerId,
		action: 'document_added',
		summary: `${c.name} shared a document via the portal: "${safe}"`
	});
	return { row, orgId: c.orgId };
}

export async function readCustomerDoc(orgId: string, id: string) {
	const [row] = await db
		.select()
		.from(customerDocument)
		.where(and(eq(customerDocument.id, id), eq(customerDocument.organizationId, orgId)))
		.limit(1);
	if (!row) error(404, 'Document not found');
	const bytes = await readFile(row.path);
	return { row, bytes };
}

/** Sets (or clears) a document's expiry date — warranties, permits, insurance certs. */
export async function setCustomerDocExpiry(ctx: OrgContext, id: string, expiresOn: string | null) {
	const [row] = await db
		.update(customerDocument)
		.set({ expiresOn })
		.where(and(eq(customerDocument.id, id), eq(customerDocument.organizationId, ctx.orgId)))
		.returning({ id: customerDocument.id });
	if (!row) error(404, 'Document not found');
	return row;
}

/** Toggles whether a customer document is visible in the customer portal. */
export async function setCustomerDocShared(ctx: OrgContext, id: string, shared: boolean) {
	const [row] = await db
		.update(customerDocument)
		.set({ shared })
		.where(and(eq(customerDocument.id, id), eq(customerDocument.organizationId, ctx.orgId)))
		.returning({ id: customerDocument.id });
	if (!row) error(404, 'Document not found');
	return row;
}

/** Reads a shared document for a portal customer — only when it's theirs and shared. */
export async function readPortalCustomerDoc(userId: string, id: string) {
	const [row] = await db
		.select({ doc: customerDocument })
		.from(customerDocument)
		.innerJoin(customer, eq(customerDocument.customerId, customer.id))
		.where(
			and(
				eq(customerDocument.id, id),
				or(eq(customerDocument.shared, true), eq(customerDocument.viaPortal, true)),
				eq(customer.portalUserId, userId)
			)
		)
		.limit(1);
	if (!row) error(404, 'Document not found');
	const bytes = await readFile(row.doc.path);
	return { row: row.doc, bytes };
}

/** Reads a shared photo for the public service-report page — the /r/<token> route
 * verifies the job token first, so this only checks the photo belongs to that
 * job and is customer-shared. */
export async function readSharedJobPhoto(jobId: string, id: string) {
	const [row] = await db
		.select()
		.from(jobPhoto)
		.where(and(eq(jobPhoto.id, id), eq(jobPhoto.jobId, jobId), eq(jobPhoto.shared, true)))
		.limit(1);
	if (!row) error(404, 'Photo not found');
	const bytes = await readFile(row.path);
	return { row, bytes };
}

export async function deleteCustomerDoc(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(customerDocument)
		.where(and(eq(customerDocument.id, id), eq(customerDocument.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Document not found');
	await unlink(row.path).catch(() => {});
	return row;
}
