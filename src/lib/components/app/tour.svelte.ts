export type TourStep = {
	/** `data-tour` attribute value of the element to spotlight; '' renders a centered card. */
	target: string;
	title: string;
	body: string;
};

export const TOUR_STEPS: TourStep[] = [
	{
		target: '',
		title: 'Welcome to Tredaro',
		body: 'A 60-second tour of the workspace. You can replay it anytime from Settings or your account menu.'
	},
	{
		target: 'search',
		title: 'Search',
		body: 'Jump to any customer, job or page. Press ⌘K from anywhere.'
	},
	{
		target: 'nav-dashboard',
		title: 'Dashboard',
		body: "Today's schedule, unbooked work and open balances at a glance."
	},
	{
		target: 'nav-my day',
		title: 'My Day',
		body: "Technician view: today's assigned jobs with one-tap status updates and clock in/out."
	},
	{
		target: 'nav-dispatch',
		title: 'Dispatch',
		body: 'The board: unscheduled jobs on the left, technician columns on the right. Assign times and techs here.'
	},
	{
		target: 'nav-jobs',
		title: 'Jobs',
		body: 'Every piece of work — status timeline, notes, time tracking and equipment.'
	},
	{
		target: 'nav-customers',
		title: 'Customers',
		body: 'Service locations, installed equipment, balances and portal invite links.'
	},
	{
		target: 'nav-estimates',
		title: 'Estimates',
		body: 'Send a public approve/decline link — approval converts the estimate into a job.'
	},
	{
		target: 'nav-billing',
		title: 'Billing',
		body: 'Invoices with a shareable pay link, plus charges and recorded payments.'
	},
	{
		target: 'nav-agreements',
		title: 'Agreements',
		body: 'Recurring service plans — each billing period also books its included visits.'
	},
	{
		target: 'nav-pricebook',
		title: 'Pricebook',
		body: 'Your flat-rate catalog. Estimates, invoices and AI suggestions price from here.'
	},
	{
		target: 'nav-reports',
		title: 'Reports',
		body: 'Revenue, job volume and labor hours by technician.'
	},
	{
		target: 'nav-portal',
		title: 'Member portal',
		body: 'What your customers see: upcoming visits, estimates to approve and invoices to pay.'
	},
	{
		target: 'nav-settings',
		title: 'Settings',
		body: 'Workspace details, offices, team invites, payments, API keys and webhooks.'
	},
	{
		target: '',
		title: "You're set",
		body: 'Load the demo company from Settings → Demo to click through realistic data. Replay this tour anytime from Settings.'
	}
];

const STORAGE_KEY = 'tredaro:tour:v1';

function createTour() {
	let open = $state(false);
	let index = $state(0);
	return {
		get open() {
			return open;
		},
		get index() {
			return index;
		},
		get step() {
			return TOUR_STEPS[index];
		},
		get total() {
			return TOUR_STEPS.length;
		},
		/** Auto-starts the tour unless it has been completed or dismissed. */
		init() {
			if (open) return;
			try {
				if (localStorage.getItem(STORAGE_KEY)) return;
			} catch {
				return;
			}
			open = true;
			index = 0;
		},
		/** Starts the tour regardless of history — used by the replay buttons. */
		start() {
			index = 0;
			open = true;
		},
		next() {
			if (index + 1 >= TOUR_STEPS.length) this.finish();
			else index += 1;
		},
		back() {
			if (index > 0) index -= 1;
		},
		finish() {
			open = false;
			try {
				localStorage.setItem(STORAGE_KEY, 'done');
			} catch {
				// private mode — tour stays ephemeral
			}
		}
	};
}

export const tour = createTour();
