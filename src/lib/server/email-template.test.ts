import { describe, expect, it } from 'vitest';
import { renderEmail } from './email-template.ts';

describe('email HTML boundary', () => {
	it('escapes untrusted text and quoted URL attributes without altering the plain text version', () => {
		const content = '<img src=x onerror="alert(1)"> & \'text\'';
		const url = 'https://example.invalid/?x=" onmouseover="alert(1)&y=<tag>';
		const rendered = renderEmail({
			orgName: content,
			heading: content,
			lines: [content],
			action: { label: content, url },
			secondary: { label: content, url }
		});
		expect(rendered.html).not.toContain('<img');
		expect(rendered.html).not.toContain('href="https://example.invalid/?x="');
		expect(rendered.html).toContain(
			'&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;text&#39;'
		);
		expect(rendered.html).toContain('x=&quot; onmouseover=&quot;alert(1)&amp;y=&lt;tag&gt;');
		expect(rendered.text).toContain(content);
		expect(rendered.text).toContain(url);
		expect(rendered.text).not.toContain('&lt;img');
	});
});
