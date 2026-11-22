# tredaro

## 0.3.2

### Patch Changes

- 6a0d0ba: Restore the full-width sticky demo banner so it stays visible while scrolling.

## 0.3.1

### Patch Changes

- 52b33b9: Preserve all Anthropic text blocks and system instructions, and report the resolved default model in generated-content metadata.

## 0.3.0

### Minor Changes

- fe3bdc1: Add `TREDARO_AI_PROVIDER` / `TREDARO_AI_DECISION_PROVIDER` (`openai` or `anthropic`) so AI features and decision calls work against any OpenAI-compatible `/chat/completions` endpoint or the Anthropic Messages API.

### Patch Changes

- fe3bdc1: Fix deploy tooling (known_hosts resolution) and lint on print pages.

## 0.2.1

### Patch Changes

- 199e9d3: Fix deploy tooling (known_hosts resolution) and lint on print pages.

## 0.2.0

### Minor Changes

- e63f623: Vendor the new shadcn-svelte chat/AI components (trace, code-block, message-scroller, highlighter, use-highlighted-code) for parity with the suite's shared component set.
- 3e5667b: Reorganize the customer portal into tabs (Visits, Billing, Messages & documents, Account) with full-width cards instead of a crowded two-column grid.
- 3ddea03: Float the demo banner as an absolute-positioned pill, add it to the customer portal, and convert dialogs to the responsive Modal (dialog on desktop, drawer on mobile).

### Patch Changes

- 2167b50: Require patched Node.js runtimes for CVE-2026-111497 and rebuild containers with Node.js 26.12.1.

## 0.1.5

### Patch Changes

- 05e9a95: Apply the suite profile migration on databases upgraded from 0.1.2.

## 0.1.4

### Patch Changes

- 8c6b2c9: Fix demo deployment for releases merged by a GitHub App account.

## 0.1.3

### Patch Changes

- 1925efe: Expire public estimate, invoice, service-report and booking-change links; require fresh links after upgrading. Limit public responses to recipient-facing details and protect report photos with completed-visit checks. Clarify safe self-hosted credentials and test fixtures.

## 0.1.2

### Patch Changes

- da264df: Link every public demo account to a sample portal profile in its own workspace so the admin sidebar portal opens successfully. Match the shared error page layout to Freeweight.

## 0.1.1

### Patch Changes

- 3dc6edd: Close resource permission, tenant reference, and public data exposure gaps found in the release audit.

## 0.1.0

### Minor Changes

- 32d3efa: Include basic SAML/OIDC SSO, passkeys and BYOK AI in the AGPL self-hosted core without an enterprise license. Preserve paid administrative feature gates and public demo restrictions.

### Patch Changes

- 8838f7b: Harden tenant authorization, public responses and webhook delivery; add security regressions and self-hosting readiness guidance. Basic SSO, passkeys and BYOK AI remain in the free core.

## 0.0.3

### Patch Changes

- 1f9a31b: Release current main updates to the public demo.

## 0.0.2

### Patch Changes

- 77efbf8: Add Changesets-driven demo releases with fixed eight-minute sessions and countdown banners.
