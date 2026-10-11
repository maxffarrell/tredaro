# Self-hosted SSO and BYOK AI

Basic SAML/OIDC SSO, passkeys and BYOK AI are part of the AGPLv3 core. They do
not require `TREDARO_ENTERPRISE_KEY` or a Cloud subscription.

## Sign-in

Serve the app over HTTPS, set `ORIGIN` to its public URL, and open Settings → Security.
Passkeys are per user. Workspace administrators can connect their own identity
provider; SSO preserves the existing organization membership and authorization checks.
Configure the provider's callback URL to match the app's public origin and provider ID.
The public demo blocks SSO and passkey configuration.

## AI provider

Set these private environment variables on the server and restart the app.
No provider key or model usage is included; you pay your provider directly.
AI requests send the relevant input to the configured endpoint.

```dotenv
TREDARO_AI_API_KEY=your-provider-key
TREDARO_AI_BASE_URL=https://api.openai.com/v1
TREDARO_AI_MODEL=your-model
```

For a keyless local OpenAI-compatible endpoint, set an explicit
`TREDARO_AI_BASE_URL` such as `http://localhost:11434/v1` and a model;
leave `TREDARO_AI_API_KEY` unset. The client appends `/chat/completions`.

Optional `TREDARO_AI_DECISION_API_KEY`, `TREDARO_AI_DECISION_BASE_URL` and
`TREDARO_AI_DECISION_MODEL` overrides route structured calls separately;
unset overrides inherit the feature settings. With no provider configured,
AI remains unavailable and calls report a configuration error.
