import { requested } from '$app/server';
import type { RemoteQueryFunction } from '$app/server';

/**
 * Inside a remote command, marks `fn` for refresh on every arg variant the
 * client requested via `command(...).updates(fn)`, plus each explicit arg
 * passed here (e.g. `await refreshQuery(getJob, id)`). Use instead of
 * `fn(arg).refresh()` whenever callers use `.updates(fn)` — arg-scoped
 * variants requested but never refreshed would otherwise fail the query
 * with "Requested update was not handled by the remote function".
 * Must be awaited: standard-schema validators are async, so requested()
 * needs its async path, and registration must finish before the command
 * resolves or the response drains early. Pass `undefined` to refresh the
 * no-arg variant.
 */
export async function refreshQuery<Input, Output>(
	fn: RemoteQueryFunction<Input, Output>,
	...args: Input[]
): Promise<void> {
	await requested(fn, 20).refreshAll();
	for (const arg of args) void fn(arg).refresh();
}
