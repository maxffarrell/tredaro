/**
 * Tredaro API client.
 *
 * Create an API key in Settings → API (`td_…`), then:
 *
 * ```ts
 * import { Tredaro } from '@tredaro/sdk';
 * const td = new Tredaro({ apiKey: 'td_…', baseUrl: 'https://dispatch.acme-hvac.com' });
 * const customers = await td.customers.list();
 * ```
 */

export type TredaroOptions = {
	/** API key from Settings → API. */
	apiKey: string;
	/** Defaults to Tredaro Cloud. */
	baseUrl?: string;
	fetch?: typeof fetch;
};

export type Customer = {
	id: string;
	name: string;
	type: 'residential' | 'commercial';
	companyName: string | null;
	email: string | null;
	phone: string | null;
	status: 'active' | 'inactive';
	since: string | null;
};

export type Job = {
	id: string;
	number: number;
	customerId: string;
	jobTypeId: string | null;
	summary: string;
	status: 'unscheduled' | 'scheduled' | 'dispatched' | 'in_progress' | 'done' | 'cancelled';
	priority: 'low' | 'normal' | 'high' | 'urgent';
	startsAt: string | null;
	endsAt: string | null;
	technicianId: string | null;
};

export type Estimate = {
	id: string;
	number: number;
	customerId: string;
	status: 'draft' | 'sent' | 'approved' | 'declined' | 'converted';
	notes: string | null;
	sentAt: string | null;
};

export type Invoice = {
	id: string;
	number: number;
	customerId: string;
	jobId: string | null;
	status: 'open' | 'void';
	issuedAt: string;
	dueDate: string | null;
};

export type ApiErrorShape = { message?: string };

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export class Tredaro {
	#apiKey: string;
	#baseUrl: string;
	#fetch: typeof fetch;

	constructor({ apiKey, baseUrl = 'https://app.tredaro.com', fetch: f = fetch }: TredaroOptions) {
		this.#apiKey = apiKey;
		this.#baseUrl = baseUrl.replace(/\/$/, '');
		this.#fetch = f;
	}

	async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await this.#fetch(`${this.#baseUrl}/api/v1${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.#apiKey}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (!res.ok) {
			let message = `HTTP ${res.status}`;
			try {
				const data = (await res.json()) as ApiErrorShape;
				if (data.message) message = data.message;
			} catch {
				// keep the status line
			}
			throw new ApiError(res.status, message);
		}
		return res.json() as Promise<T>;
	}

	readonly customers = {
		list: (params: { q?: string } = {}) =>
			this.#request<Customer[]>(
				'GET',
				`/customers${params.q ? `?q=${encodeURIComponent(params.q)}` : ''}`
			),
		get: (id: string) => this.#request<Customer>('GET', `/customers/${id}`),
		create: (input: { name: string; email?: string; phone?: string; type?: string }) =>
			this.#request<Customer>('POST', '/customers', input)
	};

	readonly jobs = {
		/** Jobs starting between `from` and `to` (ISO dates); defaults to the next 14 days. */
		list: (params: { from?: string; to?: string; status?: string; technicianId?: string } = {}) =>
			this.#request<Job[]>(
				'GET',
				`/jobs?${new URLSearchParams(
					Object.fromEntries(Object.entries(params).filter(([, v]) => v) as [string, string][])
				)}`
			),
		get: (id: string) => this.#request<Job>('GET', `/jobs/${id}`),
		create: (input: { customerId: string; jobTypeId?: string; startsAt?: string }) =>
			this.#request<Job>('POST', '/jobs', input)
	};

	readonly estimates = {
		list: (params: { status?: string } = {}) =>
			this.#request<Estimate[]>(
				'GET',
				`/estimates${params.status ? `?status=${params.status}` : ''}`
			),
		get: (id: string) => this.#request<Estimate>('GET', `/estimates/${id}`)
	};

	readonly invoices = {
		list: (params: { status?: string } = {}) =>
			this.#request<Invoice[]>(
				'GET',
				`/invoices${params.status ? `?status=${params.status}` : ''}`
			),
		get: (id: string) => this.#request<Invoice>('GET', `/invoices/${id}`)
	};
}
