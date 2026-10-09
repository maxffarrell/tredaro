import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	agreementPlan,
	charge,
	companySettings,
	customer,
	customerContact,
	customerDocument,
	equipment,
	estimate,
	estimateItem,
	followUp,
	invoice,
	invoiceItem,
	inventoryItem,
	job,
	jobChecklistItem,
	jobEvent,
	jobExpense,
	jobMaterial,
	jobPhoto,
	jobTimeEntry,
	jobType,
	maintenanceSchedule,
	memberDayNote,
	notificationLog,
	office,
	pricebookItem,
	purchaseOrder,
	purchaseOrderItem,
	serviceAgreement,
	serviceLocation,
	smsOutbox,
	truckStock,
	member,
	memberTimeOff,
	payment,
	user
} from '#lib/server/db/schema.ts';

/**
 * Full workspace backup: every org-owned table as a plain JSON dump. Used by
 * `GET /api/export/workspace.json` for data portability / local backups. File
 * contents (photos, documents) are not embedded — only their metadata.
 * Secrets (payment-provider config, webhook signing keys, API keys) are
 * deliberately excluded.
 */
export async function exportWorkspace(orgId: string) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rows = (table: any) => db.select().from(table).where(eq(table.organizationId, orgId));

	const staff = await db
		.select({
			id: member.id,
			name: user.name,
			email: user.email,
			role: member.role,
			commissionPct: member.commissionPct,
			laborCostCents: member.laborCostCents,
			skillTags: member.skillTags,
			color: member.color,
			dispatchVisible: member.dispatchVisible,
			staffAlerts: member.staffAlerts,
			createdAt: member.createdAt
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId));

	const stripPath = <T extends { path?: string | null }>(list: T[]) =>
		list.map(({ path: _path, ...rest }) => rest);

	return {
		exportedAt: new Date().toISOString(),
		format: 'tredaro-workspace@1',
		settings: await db
			.select()
			.from(companySettings)
			.where(eq(companySettings.organizationId, orgId)),
		offices: await db.select().from(office).where(eq(office.organizationId, orgId)),
		staff,
		customers: await rows(customer),
		serviceLocations: await rows(serviceLocation),
		customerContacts: await rows(customerContact),
		customerDocuments: stripPath(await rows(customerDocument)),
		equipment: await rows(equipment),
		agreementPlans: await rows(agreementPlan),
		serviceAgreements: await rows(serviceAgreement),
		pricebookItems: await rows(pricebookItem),
		jobTypes: await rows(jobType),
		jobs: await rows(job),
		jobEvents: await rows(jobEvent),
		jobTimeEntries: await rows(jobTimeEntry),
		jobMaterials: await rows(jobMaterial),
		jobExpenses: await rows(jobExpense),
		jobChecklistItems: await rows(jobChecklistItem),
		jobPhotos: stripPath(await rows(jobPhoto)),
		estimates: await rows(estimate),
		// Item tables have no organization_id — join through the parent.
		estimateItems: await db
			.select({ item: estimateItem })
			.from(estimateItem)
			.innerJoin(estimate, eq(estimateItem.estimateId, estimate.id))
			.where(eq(estimate.organizationId, orgId))
			.then((r) => r.map((x) => x.item)),
		invoices: await rows(invoice),
		invoiceItems: await db
			.select({ item: invoiceItem })
			.from(invoiceItem)
			.innerJoin(invoice, eq(invoiceItem.invoiceId, invoice.id))
			.where(eq(invoice.organizationId, orgId))
			.then((r) => r.map((x) => x.item)),
		charges: await rows(charge),
		payments: await rows(payment),
		inventoryItems: await rows(inventoryItem),
		truckStock: await rows(truckStock),
		purchaseOrders: await rows(purchaseOrder),
		purchaseOrderItems: await rows(purchaseOrderItem),
		maintenanceSchedules: await rows(maintenanceSchedule),
		memberTimeOff: await rows(memberTimeOff),
		memberDayNotes: await rows(memberDayNote),
		followUps: await rows(followUp),
		smsOutbox: await rows(smsOutbox),
		notificationLog: await rows(notificationLog),
		activity: await rows(activity)
	};
}
