import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const journal: { entries: { tag: string; when: number }[] } = JSON.parse(
	readFileSync(new URL('../../../../drizzle/meta/_journal.json', import.meta.url), 'utf8')
);

describe('migration journal', () => {
	// Drizzle skips any migration whose timestamp is not newer than the last applied one.
	it('has strictly increasing timestamps', () => {
		const late = journal.entries.filter((e, i) => i > 0 && e.when <= journal.entries[i - 1].when);
		expect(late.map((e) => e.tag)).toEqual([]);
	});
});
