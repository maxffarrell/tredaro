import { requested } from '$app/server';
import type { RemoteQueryFunction } from '$app/server';

/**
 * Inside a remote command, marks `fn` for refresh on every arg variant the
 * client requested via `command(...).updates(fn)`, plus each explicit arg
 * passed here (e.g. `refreshQuery(getJob, id)`). Use instead of
 * `fn(arg).refresh()` whenever callers use `.updates(fn)` — arg-scoped
 * variants requested but never refreshed would otherwise fail the query
 * with "Requested update was not handled by the remote function".
 * `fn()` refreshes the no-arg variant: pass `undefined` to always refresh it.
 */
export function refreshQuery<Input, Output>(
	fn: RemoteQueryFunction<Input, Output>,
	...args: Input[]
): void {
	for (const { query } of requested(fn, 20)) void query.refresh();
	for (const arg of args) void fn(arg).refresh();
}
