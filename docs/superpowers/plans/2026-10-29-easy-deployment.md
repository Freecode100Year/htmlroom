# Easy deployment implementation plan

**Goal:** Cloudflare full-stack button, Vercel static frontend, and an Ubuntu/Debian Docker + Caddy installer.

**Architecture:** Reuse Worker, Durable Objects, and the existing static build. Keep production Compose separate from local Compose. The installer validates inputs before installing packages, clones into a new directory, and waits for service health and HTTPS.

**Constraints:** No Redis or Vercel relay. Preserve optional JOIN_LIMIT behavior. Exact external frontend Origins must be allowed by the relay. Do not overwrite existing installations. No actual cloud deployment or host package installation during verification.

## Tasks

- [x] Add installer preflight tests for invalid domain, unsafe/existing destination, and check-only behavior; run failing tests first.
- [x] Add production Compose, Caddyfile, installer and Vercel config; run installer tests, Compose validation, static build, and Worker dry-run.
- [x] Add README buttons, install command, Origin setup, operational commands, and explicit cloud verification limits.
- [x] Run project tests and review the diff.

## Review focus

Pipe-to-bash must read prompts from the terminal; domain input cannot inject Caddy configuration; existing files must survive repeated installation; only Caddy exposes public ports; TLS readiness must not be reported before verification.

## Execution

User said “go” after the default scope was described. Execute inline on `feat/easy-deployment` in the existing clean checkout. Leave changes uncommitted for review.

## Verification record

- Installer test: RED (missing script), then GREEN; validates without modifying the host.
- `npm test`: initially 31 passed, 9 Worker tests explicitly skipped; separate `npm run test:worker`: all 9 passed. Final suite after readiness regression: 32 passed, 9 skipped.
- `npm run test:pages`: Chromium static frontend flow passed.
- `npm run build:check`, Worker deploy dry-run, production Compose config and real Caddy configuration validation passed.
- Vercel config keys checked against its official JSON schema.
- Cloudflare button browser navigation reached the dashboard and returned a 403 verification page. No claim of account deployment or Rate Limiting button support.
- No host package installation, public certificate request, or cloud deployment performed.
- Docker image build passed.
- Independent read-only review found a false-success case for stale DNS pointing at another HTTPS site. Regression test demonstrated RED; installer now verifies both local Caddy TLS and public assets against this installation, then GREEN. Package/network/container operations are stubbed in that test; no host packages are installed by tests.
