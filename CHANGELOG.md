# tredaro

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
