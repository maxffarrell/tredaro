import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import CalendarCheck from '@lucide/svelte/icons/calendar-check';
import Users from '@lucide/svelte/icons/users';
import KanbanSquare from '@lucide/svelte/icons/kanban-square';
import Wrench from '@lucide/svelte/icons/wrench';
import FileText from '@lucide/svelte/icons/file-text';
import Wallet from '@lucide/svelte/icons/wallet';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import BookOpen from '@lucide/svelte/icons/book-open';
import Package from '@lucide/svelte/icons/package';
import Settings from '@lucide/svelte/icons/settings';
import ChartColumn from '@lucide/svelte/icons/chart-column';

/** `key` is the second key of the `g <key>` keyboard shortcut. */
export const mainNav = [
	{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, key: 'd' },
	{ href: '/myday', label: 'My Day', icon: CalendarCheck, key: 'm' },
	{ href: '/dispatch', label: 'Dispatch', icon: KanbanSquare, key: 'p' },
	{ href: '/jobs', label: 'Jobs', icon: Wrench, key: 'j' },
	{ href: '/customers', label: 'Customers', icon: Users, key: 'c' },
	{ href: '/estimates', label: 'Estimates', icon: FileText, key: 'e' },
	{ href: '/billing', label: 'Billing', icon: Wallet, key: 'b' },
	{ href: '/agreements', label: 'Agreements', icon: RefreshCw, key: 'a' },
	{ href: '/pricebook', label: 'Pricebook', icon: BookOpen, key: 'k' },
	{ href: '/inventory', label: 'Inventory', icon: Package, key: 'i' },
	{ href: '/reports', label: 'Reports', icon: ChartColumn, key: 'r' }
] as const;

export const secondaryNav = [
	{ href: '/settings', label: 'Settings', icon: Settings, key: 't' }
] as const;

export const allNav = [...mainNav, ...secondaryNav];
