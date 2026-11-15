export const KIND_LABELS: Record<string, string> = {
	booking_staff_alert: 'Booking request',
	estimate_viewed: 'Estimate viewed',
	estimate_hot: 'Hot lead',
	estimate_decision: 'Estimate answered',
	low_stock: 'Low stock',
	parts_delay: 'Parts delay',
	tech_assigned: 'Tech assigned',
	daily_digest: 'Daily digest',
	weekly_digest: 'Weekly digest',
	agreement_renewal: 'Agreement renewal',
	job_completed: 'Job completed',
	payment_receipt: 'Payment received',
	inbound_sms_staff: 'Text from customer',
	estimate_changes: 'Change request',
	quote_request: 'Quote request',
	auto_charge_failed: 'auto-charge failed',
	follow_up_due: 'Follow-up due',
	time_approved: 'Time approved',
	time_auto_ended: 'Timer auto-ended',
	time_flagged: 'Time entry flagged',
	charge_dispute: 'Charge dispute',
	visit_cancel_request: 'Cancel request',
	portal_message: 'Portal message'
};

export function notificationLabel(kind: string) {
	return KIND_LABELS[kind] ?? kind.replaceAll('_', ' ');
}

/** Where each kind's entity usually lives. */
export function notificationHref(kind: string, entityId: string) {
	if (kind === 'booking_staff_alert' || kind === 'daily_digest') return '/dispatch';
	if (kind === 'weekly_digest') return '/dashboard';
	if (kind === 'time_approved') return '/myday';
	if (kind === 'time_auto_ended' || kind === 'time_flagged')
		return `/jobs/${entityId.split(':')[0]}`;
	if (kind === 'low_stock') return '/inventory';
	if (
		kind === 'estimate_viewed' ||
		kind === 'estimate_decision' ||
		kind === 'estimate_changes' ||
		kind === 'estimate_hot' ||
		kind === 'quote_request'
	)
		return `/estimates/${entityId}`;
	if (
		kind === 'parts_delay' ||
		kind === 'tech_assigned' ||
		kind === 'job_unblocked' ||
		kind === 'visit_rated'
	)
		return `/jobs/${entityId}`;
	if (kind === 'agreement_renewal') return '/agreements';
	if (kind === 'payment_receipt' || kind === 'job_completed') return `/jobs/${entityId}`;
	if (
		kind === 'inbound_sms_staff' ||
		kind === 'auto_charge_failed' ||
		kind === 'charge_dispute' ||
		kind === 'portal_message'
	)
		return `/customers/${entityId.split(':')[0]}`;
	if (kind === 'visit_cancel_request') return `/jobs/${entityId}`;
	if (kind === 'follow_up_due') return entityId.split(':')[1] || '/dashboard';
	return null;
}
