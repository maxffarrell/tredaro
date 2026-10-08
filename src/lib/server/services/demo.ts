import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	charge,
	companySettings,
	customer,
	equipment,
	inventoryItem,
	purchaseOrder,
	purchaseOrderItem,
	estimate,
	estimateItem,
	invoice,
	invoiceItem,
	job,
	jobTimeEntry,
	jobType,
	member,
	office,
	payment,
	pricebookItem,
	serviceAgreement,
	serviceLocation
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { zonedToUtc } from '#lib/tz.ts';
import { and, eq } from 'drizzle-orm';

/** Fills a fresh workspace with a believable field-service company: customers, jobs, estimates, billing. */
export async function loadDemoData(ctx: OrgContext) {
	const tz = 'America/Chicago';
	const now = new Date();
	const today = now.toISOString().slice(0, 10);

	await db
		.insert(companySettings)
		.values({
			organizationId: ctx.orgId,
			timezone: tz,
			currency: 'usd',
			publicPage: true,
			tagline: 'Heating, cooling and plumbing — done right the first time.',
			address: '4412 Burnet Rd, Austin, TX',
			phone: '(512) 555-0147',
			website: 'https://hillcountryhvac.example.com'
		})
		.onConflictDoNothing();

	const [hq] = await db
		.insert(office)
		.values({ organizationId: ctx.orgId, name: 'Austin HQ', address: '4412 Burnet Rd' })
		.returning();

	// First staff member doubles as the demo technician.
	const [me] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)))
		.limit(1);

	const [maintenance, repair, install, plumbing] = await db
		.insert(jobType)
		.values([
			{
				organizationId: ctx.orgId,
				officeId: hq!.id,
				technicianId: me?.id ?? null,
				name: 'AC Tune-Up',
				description: 'Seasonal cooling maintenance visit.',
				color: '#3b82f6',
				durationMin: 90,
				defaultAmount: 12900
			},
			{
				organizationId: ctx.orgId,
				officeId: hq!.id,
				technicianId: me?.id ?? null,
				name: 'Repair Call',
				description: 'Diagnose and repair HVAC equipment.',
				color: '#ef4444',
				durationMin: 120,
				defaultAmount: 18900
			},
			{
				organizationId: ctx.orgId,
				officeId: hq!.id,
				name: 'System Install',
				description: 'Full HVAC system replacement.',
				color: '#8b5cf6',
				durationMin: 480,
				defaultAmount: 650000
			},
			{
				organizationId: ctx.orgId,
				officeId: hq!.id,
				name: 'Plumbing Service',
				description: 'Water heaters, leaks and fixtures.',
				color: '#22c55e',
				durationMin: 120,
				defaultAmount: 15900
			}
		])
		.returning();

	await db.insert(pricebookItem).values([
		{
			organizationId: ctx.orgId,
			kind: 'service',
			category: 'Cooling',
			name: 'AC diagnostic',
			price: 8900,
			durationMin: 60
		},
		{
			organizationId: ctx.orgId,
			kind: 'service',
			category: 'Cooling',
			name: 'Refrigerant recharge (per lb)',
			price: 12500
		},
		{
			organizationId: ctx.orgId,
			kind: 'material',
			category: 'Parts',
			name: 'Capacitor 45/5 µF',
			price: 4500
		},
		{
			organizationId: ctx.orgId,
			kind: 'material',
			category: 'Parts',
			name: 'Condenser fan motor',
			price: 24000
		},
		{
			organizationId: ctx.orgId,
			kind: 'service',
			category: 'Plumbing',
			name: 'Water heater flush',
			price: 14900,
			durationMin: 90
		}
	]);

	const [comfortClub, commercial] = await db
		.insert(agreementPlan)
		.values([
			{
				organizationId: ctx.orgId,
				name: 'Comfort Club',
				description: 'Two tune-ups a year, priority scheduling, 10% off repairs.',
				amount: 1900,
				interval: 'month',
				initialFee: 4900,
				includedVisits: 2,
				jobTypeId: maintenance!.id,
				listed: true
			},
			{
				organizationId: ctx.orgId,
				name: 'Commercial Care',
				description: 'Quarterly PM for rooftop units, dedicated account manager.',
				amount: 34900,
				interval: 'month',
				initialFee: 0,
				includedVisits: 4,
				jobTypeId: maintenance!.id,
				listed: true
			}
		])
		.returning();

	const customerNames = [
		['Marta Delgado', 'residential'],
		['The Whitley Family', 'residential'],
		['Sunrise Bakery', 'commercial'],
		['Dr. Priya Raman', 'residential'],
		['Westlake Dental', 'commercial'],
		['Tom & Ellie Vasquez', 'residential'],
		['Greenline Crossfit', 'commercial'],
		['Holly Nguyen', 'residential']
	] as const;
	const customers = await db
		.insert(customer)
		.values(
			customerNames.map(([name, type], i) => ({
				organizationId: ctx.orgId,
				name,
				type,
				email: `${name
					.split(' ')[0]!
					.replace(/[^a-z]/gi, '')
					.toLowerCase()}@example.com`,
				phone: `(512) 555-01${String(10 + i)}`,
				since: today.slice(0, 8) + String((i % 20) + 1).padStart(2, '0')
			}))
		)
		.returning();

	const addresses = [
		['1804 Alta Vista Ave', 'Austin', 'TX', '78704'],
		['2309 Enfield Rd', 'Austin', 'TX', '78703'],
		['4520 Burnet Rd', 'Austin', 'TX', '78756'],
		['702 Robert E Lee Rd', 'Austin', 'TX', '78704'],
		['3300 Bee Caves Rd', 'West Lake Hills', 'TX', '78746'],
		['1106 W 38th St', 'Austin', 'TX', '78705'],
		['5520 Burnet Rd', 'Austin', 'TX', '78756'],
		['2401 S Congress Ave', 'Austin', 'TX', '78704']
	];
	const locations = await db
		.insert(serviceLocation)
		.values(
			customers.map((c, i) => ({
				organizationId: ctx.orgId,
				customerId: c.id,
				address1: addresses[i]![0]!,
				city: addresses[i]![1]!,
				state: addresses[i]![2]!,
				zip: addresses[i]![3]!,
				isPrimary: true
			}))
		)
		.returning();

	// Installed equipment on a few customers' sites.
	const year = now.getUTCFullYear();
	const equipmentRows = await db
		.insert(equipment)
		.values(
			[
				[
					0,
					'Upstairs AC condenser',
					'HVAC',
					'Carrier',
					'24ACC636',
					'CAR-29117',
					year - 4,
					year + 1
				],
				[0, 'Furnace', 'HVAC', 'Carrier', '59SC5', 'CAR-88331', year - 4, null],
				[2, 'Walk-in cooler', 'Refrigeration', 'True', 'T-49-HC', 'TRU-55402', year - 2, year + 3],
				[
					3,
					'Tankless water heater',
					'Plumbing',
					'Rheem',
					'RTGH-95',
					'RHM-77120',
					year - 1,
					year + 9
				],
				[4, 'Rooftop unit — zone A', 'HVAC', 'Lennox', 'LGH120', 'LNX-30817', year - 6, year - 1],
				[
					6,
					'Compressor — gym floor',
					'Refrigeration',
					'Copeland',
					'ZP54K5E',
					'CPL-19380',
					year - 3,
					year + 2
				]
			].map(([i, name, category, brand, model, serial, inst, war]) => {
				const c = customers[i as number]!;
				const loc = locations.find((l) => l.customerId === c.id)!;
				return {
					organizationId: ctx.orgId,
					customerId: c.id,
					serviceLocationId: loc.id,
					name: name as string,
					category: category as string,
					brand: brand as string,
					model: model as string,
					serial: serial as string,
					installedOn: `${inst}-03-15`,
					warrantyUntil: war ? `${war}-03-15` : null
				};
			})
		)
		.returning();
	const equipByCustomer = new Map(equipmentRows.map((e) => [e.customerId, e]));

	// Truck/warehouse stock — the capacitor and contactor sit at/below reorder so the
	// dashboard attention card has a low-stock row to show.
	await db.insert(inventoryItem).values([
		{
			organizationId: ctx.orgId,
			name: 'Capacitor 45/5 µF',
			sku: 'CAP-45-5',
			unit: 'each',
			qtyOnHand: 3,
			reorderPoint: 5,
			unitCost: 1800
		},
		{
			organizationId: ctx.orgId,
			name: 'Condenser fan motor',
			sku: 'MTR-CFM',
			unit: 'each',
			qtyOnHand: 7,
			reorderPoint: 3,
			unitCost: 14000
		},
		{
			organizationId: ctx.orgId,
			name: 'Refrigerant R-410A',
			sku: 'REF-R410A',
			unit: 'lb',
			qtyOnHand: 22,
			reorderPoint: 8,
			unitCost: 900
		},
		{
			organizationId: ctx.orgId,
			name: 'Contactor 2-pole 40A',
			sku: 'CON-2P40',
			unit: 'each',
			qtyOnHand: 0,
			reorderPoint: 2,
			unitCost: 1200,
			notes: 'On backorder with supplier'
		},
		{
			organizationId: ctx.orgId,
			name: 'Smart thermostat',
			sku: 'THM-SMT',
			unit: 'each',
			qtyOnHand: 6,
			reorderPoint: null,
			unitCost: 9500
		}
	]);

	// One open PO so the purchase-orders card has content; restocking the contactor
	// clears its low-stock attention row.
	const invRows = await db
		.select({ id: inventoryItem.id, name: inventoryItem.name, unit: inventoryItem.unit })
		.from(inventoryItem)
		.where(eq(inventoryItem.organizationId, ctx.orgId));
	const contactor = invRows.find((i) => i.name === 'Contactor 2-pole 40A');
	const capacitor = invRows.find((i) => i.name === 'Capacitor 45/5 µF');
	const [po] = await db
		.insert(purchaseOrder)
		.values({
			organizationId: ctx.orgId,
			number: 1,
			supplier: 'Johnstone Supply',
			status: 'ordered',
			expectedOn: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(28, now.getUTCDate() + 7)).padStart(2, '0')}`,
			orderedAt: now
		})
		.returning();
	await db.insert(purchaseOrderItem).values(
		[
			{ item: capacitor, qty: 10, unitCost: 1800 },
			{ item: contactor, qty: 12, unitCost: 1200 }
		]
			.filter((l) => l.item)
			.map((l) => ({
				organizationId: ctx.orgId,
				purchaseOrderId: po!.id,
				inventoryItemId: l.item!.id,
				name: l.item!.name,
				unit: l.item!.unit,
				qty: l.qty,
				unitCost: l.unitCost
			}))
	);

	// Agreements + first charges + payments.
	for (const [i, c] of customers.entries()) {
		const p = i % 4 === 0 ? commercial! : comfortClub!;
		if (i % 3 === 2) continue; // not everyone has a plan
		const [ms] = await db
			.insert(serviceAgreement)
			.values({
				organizationId: ctx.orgId,
				customerId: c.id,
				planId: p.id,
				startsAt: new Date(`${today.slice(0, 8)}01T00:00:00Z`),
				nextChargeAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
			})
			.returning();
		const [ch] = await db
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				customerId: c.id,
				agreementId: ms!.id,
				kind: 'agreement',
				description: `${p.name} — period starting ${today.slice(0, 8)}01`,
				periodStart: `${today.slice(0, 8)}01`,
				dueDate: `${today.slice(0, 8)}01`,
				amount: p.amount
			})
			.returning();
		if (i % 4 !== 0) {
			await db.insert(payment).values({
				organizationId: ctx.orgId,
				customerId: c.id,
				chargeId: ch!.id,
				amount: p.amount,
				method: 'card',
				paidAt: new Date(now.getTime() - (i + 1) * 86400_000)
			});
			await db.update(charge).set({ status: 'paid' }).where(eq(charge.id, ch!.id));
		}
	}

	// Today's route + a few unscheduled requests.
	const times = ['08:00', '10:30', '13:00', '15:30'];
	const types = [maintenance!, repair!, install!, plumbing!];
	const jobs: (typeof job.$inferInsert)[] = [];
	let n = 0;
	for (let day = 0; day < 5; day++) {
		for (const [ti, t] of times.entries()) {
			if ((day + ti) % 3 === 2) continue;
			const jt = types[(day + ti) % types.length]!;
			const c = customers[(day * 2 + ti) % customers.length]!;
			const loc = locations.find((l) => l.customerId === c.id)!;
			const d = new Date(now.getTime() + day * 86400_000);
			const dateStr = d.toISOString().slice(0, 10);
			const start = zonedToUtc(`${dateStr}T${t}`, tz);
			const done = day === 0 && ti < 2;
			n++;
			jobs.push({
				organizationId: ctx.orgId,
				number: n,
				jobTypeId: jt.id,
				customerId: c.id,
				serviceLocationId: loc.id,
				equipmentId: equipByCustomer.get(c.id)?.id ?? null,
				officeId: hq!.id,
				technicianId: me?.id ?? null,
				summary: jt.name,
				status: done ? 'done' : 'scheduled',
				source: 'manual' as const,
				startsAt: start,
				endsAt: new Date(start.getTime() + jt.durationMin * 60_000),
				completedAt: done ? new Date(start.getTime() + jt.durationMin * 60_000) : null
			});
		}
	}
	// Two unscheduled requests — one from the booking page, one from an estimate.
	n++;
	jobs.push({
		organizationId: ctx.orgId,
		number: n,
		customerId: customers[5]!.id,
		serviceLocationId: locations[5]!.id,
		summary: 'Website booking request',
		description: 'AC blowing warm air since yesterday.',
		status: 'unscheduled',
		source: 'booking' as const
	});
	n++;
	jobs.push({
		organizationId: ctx.orgId,
		number: n,
		customerId: customers[2]!.id,
		serviceLocationId: locations[2]!.id,
		equipmentId: equipByCustomer.get(customers[2]!.id)?.id ?? null,
		jobTypeId: repair!.id,
		summary: 'Walk-in cooler running hot',
		description: 'Bakery reports cooler at 52°F.',
		priority: 'urgent' as const,
		status: 'unscheduled',
		source: 'manual' as const
	});
	const insertedJobs = await db.insert(job).values(jobs).returning();
	await db
		.update(companySettings)
		.set({ nextJobNumber: n + 1 })
		.where(eq(companySettings.organizationId, ctx.orgId));

	// Time entries: completed work on today's finished jobs, plus one open timer.
	const doneJobs = insertedJobs.filter((j) => j.status === 'done');
	const liveJob = insertedJobs.find((j) => j.status === 'scheduled');
	if (me?.id) {
		if (doneJobs[0]?.startsAt && doneJobs[0].endsAt)
			await db.insert(jobTimeEntry).values({
				organizationId: ctx.orgId,
				jobId: doneJobs[0].id,
				memberId: me.id,
				startedAt: doneJobs[0].startsAt,
				endedAt: doneJobs[0].endsAt,
				note: 'Checked refrigerant levels'
			});
		if (doneJobs[1]?.startsAt)
			await db.insert(jobTimeEntry).values({
				organizationId: ctx.orgId,
				jobId: doneJobs[1].id,
				memberId: me.id,
				startedAt: doneJobs[1].startsAt,
				endedAt: new Date(doneJobs[1].startsAt.getTime() + 45 * 60_000)
			});
		if (liveJob?.startsAt)
			await db.insert(jobTimeEntry).values({
				organizationId: ctx.orgId,
				jobId: liveJob.id,
				memberId: me.id,
				startedAt: new Date(Math.min(liveJob.startsAt.getTime(), now.getTime())),
				endedAt: null
			});
	}

	// One sent estimate + one paid invoice.
	const [est] = await db
		.insert(estimate)
		.values({
			organizationId: ctx.orgId,
			number: 1,
			customerId: customers[0]!.id,
			serviceLocationId: locations[0]!.id,
			status: 'sent',
			notes: 'Includes haul-away of old condenser.',
			sentAt: new Date(now.getTime() - 86400_000)
		})
		.returning();
	await db.insert(estimateItem).values([
		{
			estimateId: est!.id,
			name: 'Condenser fan motor',
			qty: 1,
			unitPrice: 24000,
			position: 0
		},
		{ estimateId: est!.id, name: 'Labor (2 hrs)', qty: 2, unitPrice: 9500, position: 1 }
	]);

	const [inv] = await db
		.insert(invoice)
		.values({
			organizationId: ctx.orgId,
			number: 1,
			customerId: customers[3]!.id,
			dueDate: today,
			notes: 'Thank you for your business!'
		})
		.returning();
	await db.insert(invoiceItem).values({
		invoiceId: inv!.id,
		name: 'Water heater flush',
		qty: 1,
		unitPrice: 14900,
		position: 0
	});
	const [invCharge] = await db
		.insert(charge)
		.values({
			organizationId: ctx.orgId,
			customerId: customers[3]!.id,
			invoiceId: inv!.id,
			kind: 'job',
			description: 'Invoice #1',
			dueDate: today,
			amount: 14900
		})
		.returning();
	await db.insert(payment).values({
		organizationId: ctx.orgId,
		customerId: customers[3]!.id,
		chargeId: invCharge!.id,
		amount: 14900,
		method: 'card',
		paidAt: new Date(now.getTime() - 2 * 86400_000)
	});
	await db.update(charge).set({ status: 'paid' }).where(eq(charge.id, invCharge!.id));
	await db
		.update(companySettings)
		.set({ nextEstimateNumber: 2, nextInvoiceNumber: 2 })
		.where(eq(companySettings.organizationId, ctx.orgId));

	return { customers: customers.length, jobs: jobs.length };
}
