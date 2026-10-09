import * as v from 'valibot';

export const API_RESOURCES = [
	'customers',
	'equipment',
	'jobs',
	'job_types',
	'estimates',
	'invoices',
	'agreements',
	'plans',
	'pricebook',
	'charges',
	'payments',
	'technicians',
	'inventory',
	'purchase_orders',
	'truck_stock',
	'time_entries',
	'job_events',
	'time_off',
	'customer_documents',
	'refunds'
] as const;
export type ApiResource = (typeof API_RESOURCES)[number];

export const API_ACTIONS = ['read', 'write'] as const;
export type ApiAction = (typeof API_ACTIONS)[number];

export type ApiPermissions = Partial<Record<ApiResource, ApiAction[]>>;
export type AccessLevel = 'none' | 'read' | 'write';
type RawPermissions = Record<string, readonly string[] | undefined> | null | undefined;

export const API_RESOURCE_LABELS: Record<ApiResource, string> = {
	customers: 'Customers',
	equipment: 'Equipment',
	jobs: 'Jobs',
	job_types: 'Job types',
	estimates: 'Estimates',
	invoices: 'Invoices',
	agreements: 'Service agreements',
	plans: 'Agreement plans',
	pricebook: 'Pricebook',
	charges: 'Charges',
	payments: 'Payments',
	technicians: 'Technicians',
	inventory: 'Inventory',
	purchase_orders: 'Purchase orders',
	truck_stock: 'Truck stock',
	time_entries: 'Time entries',
	job_events: 'Job events',
	time_off: 'Time off',
	customer_documents: 'Customer documents',
	refunds: 'Refunds'
};

const actionsFor = (level: Exclude<AccessLevel, 'none'>): ApiAction[] =>
	level === 'write' ? ['read', 'write'] : ['read'];

export function levelOf(permissions: RawPermissions, resource: ApiResource): AccessLevel {
	const actions = permissions?.[resource] ?? [];
	return actions.includes('write') ? 'write' : actions.includes('read') ? 'read' : 'none';
}

export function withLevel(
	permissions: ApiPermissions,
	resource: ApiResource,
	level: AccessLevel
): ApiPermissions {
	const next = { ...permissions };
	if (level === 'none') delete next[resource];
	else next[resource] = actionsFor(level);
	return next;
}

export const everything = (level: Exclude<AccessLevel, 'none'>): ApiPermissions =>
	Object.fromEntries(API_RESOURCES.map((r) => [r, actionsFor(level)]));

/** Keeps known resources only; `write` always implies `read`. */
export function normalizePermissions(permissions: RawPermissions): ApiPermissions {
	let out: ApiPermissions = {};
	for (const r of API_RESOURCES) out = withLevel(out, r, levelOf(permissions, r));
	return out;
}

export function allows(permissions: RawPermissions, resource: string, action: ApiAction) {
	return !!permissions?.[resource as ApiResource]?.includes(action);
}

export function describePermissions(
	permissions: RawPermissions
): 'full' | 'read' | 'none' | 'custom' {
	const levels = API_RESOURCES.map((r) => levelOf(permissions, r));
	if (levels.every((l) => l === 'write')) return 'full';
	if (levels.every((l) => l === 'read')) return 'read';
	if (levels.every((l) => l === 'none')) return 'none';
	return 'custom';
}

export const apiPermissionsSchema = v.pipe(
	v.record(v.string(), v.array(v.picklist(API_ACTIONS))),
	v.transform((p: Record<string, ApiAction[]>) => normalizePermissions(p)),
	v.check((p) => Object.keys(p).length > 0, 'Grant at least one permission')
);
