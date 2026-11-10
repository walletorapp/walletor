# Public source snapshot

Prepared on 10 November 2026 from Walletor source commit
`8781e80342ff7e786ae76daadd504b553d92a3f7`.

The public repository starts with a new commit. It does not carry the production
repository's Git history, Actions logs, issues or pull-request discussions.

## Publication changes

- Cloudflare database identifiers are placeholders, and resource names use a demo
  namespace. The owner-email example is generic.
- Accounting, payouts, automatic funding, fee collection, quest reporting and
  scheduled jobs are disabled in the example configuration.
- Live operator scripts, deployment workflows, production runbooks and historical
  readiness/incident reports remain in the private production repository.
- Public browser identifiers and on-chain program addresses remain where needed
  for the source. They do not grant access to production secrets or signing keys.
- Two narrowly annotated scanner false positives cover a public Segmento SDK
  identifier and a table-column definition.
- Compatible dependency updates were applied to the public copy, including a
  Zod 4 patch update. See [dependency review](DEPENDENCIES.md) for remaining
  advisories. These changes were not deployed to the live application.
- Four D1 test doubles retain the deprecated `dump` member required by the
  current interface, with narrow lint annotations; the member is never called.

## Review scope

All fetched production Git refs and the exported snapshot were scanned locally for
credentials using checksum-verified Gitleaks 8.30.1. Example configuration and the
selected file set were reviewed before publication. Additional checks cover live
Questline key patterns, keypair-shaped files, private-key blocks and data dumps.

Review results and validation commands describe this snapshot only. They do not
represent an independent protocol audit or certification of the live service.

## Validation

- Type generation, TypeScript/app build, lint and formatting checks passed.
- Unit tests: 92 files, 588 tests passed.
- Documentation type checks and a 221-page documentation build passed.
- Launch safety checks found no browser API secret and confirmed RWA trading is closed.
- Local database migrations and direct preview navigation to `/`, `/trenches`,
  `/tokens/:address` and `/claim-rewards` passed.
- Targeted Trenches browser checks passed: 14 tests across desktop and mobile Chromium.

The full historical browser suite is not a passing release gate for this snapshot.
An exploratory run had failures and was stopped; some assertions refer to retired
UI text or production-specific configuration. The targeted command above does not
validate payouts, signing with real wallets, or production integration credentials.
On-chain programs were not rebuilt or independently audited for this publication.
