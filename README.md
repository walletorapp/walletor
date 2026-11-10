# Walletor

<img src="public/assets/walletor-logo.jpg" alt="Walletor" width="96" />

Walletor is a Solana trading application with wallet-signed swaps, live token
discovery and activity-based rewards. Visit [walletor.com](https://walletor.com)
for the live application.

This repository is a public source snapshot prepared for developer review and community
transparency. It has fresh Git history and example infrastructure configuration.
Production operations and deployment credentials are maintained separately.

## What is included

- React and TypeScript frontend with Wallet Standard connections and Jupiter swaps.
- Trenches: New, About to graduate and Graduate token discovery, plus token charts.
- Prize-pool presentation, round countdowns, WLT points and USDC claim interfaces.
- Cloudflare Worker API, normalized data contracts and accounting implementation.
- MagicBlock randomness consumer, claim adapters and an archived Solana prototype.
- Automated tests and public developer documentation.

The example configuration disables accounting, payouts, automated funding, referral
fee collection, quest reporting and scheduled jobs. It uses placeholder database
identifiers and a separate demo Worker name. Configure your own resources before
running integrations; publishing this source does not provide production access.

## Local setup

Requirements: Node.js 22.12 or newer and npm 11.17.0, the version used for the
lockfile and CI. With an older npm installation, run `npm install --global npm@11.17.0`
first. Solana/Rust tools are needed only to build the on-chain programs.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run cf-typegen
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply TOKEN_DB --local
npm run dev
```

For market data and quotes, add your own `JUPITER_API_KEY` and `HELIUS_API_KEY` to
the ignored `.dev.vars` file. Birdeye and campaign integrations are optional.
WalletConnect uses a public project ID supplied through `.env`; start from
`.env.example`. Never place server keys or wallet private keys in frontend variables.

The local UI can render loading and unavailable states without live API keys.
The optional Workers AI binding requires your own Cloudflare account when used.
Financial features and production deployments require separate resource setup
and operator authorization. Local database schemas are in `migrations/` and
`token-migrations/`; this repository contains schemas, not production database data.

## Main routes

| Route              | Purpose                          |
| ------------------ | -------------------------------- |
| `/`                | Swap                             |
| `/trenches`        | Token launch discovery           |
| `/tokens/:address` | Token chart, details and trading |
| `/prize-pool`      | Round information                |
| `/claim-rewards`   | USDC claims                      |
| `/rewards`         | Wallet activity and WLT points   |
| `/influencers`     | Influencer program               |

Swaps require the user's wallet signature and execution confirmation. WLT points
are off-chain reward points. A displayed pool amount or countdown is not proof
that a payout is funded; claims depend on funded, activated entitlements.

## Verification

```sh
npm run cf-typegen
npm run typecheck
npm ci --prefix apps/docs
npm run docs:check
npm run lint
npm test
npm run build
npm run launch:safety
```

Browser checks use Playwright: `npx playwright install chromium`, then
`npm run test:e2e`. The lint check also reads the documentation app's TypeScript
configuration, so install its dependencies and generate its types as shown above.
Run `npm run docs:build` to build the documentation site.

## Documentation

- [Architecture](docs/architecture.md)
- [Token discovery and Trenches](docs/launch-board.md)
- [Financial data model](docs/data-model.md)
- [Security model](docs/security-model.md)
- [Source provenance and publication review](SOURCE.md)
- [Security reporting](SECURITY.md)
- [Dependency review and known advisories](DEPENDENCIES.md)

## Licensing

This publication does not add a project-wide open-source license. Existing
component notices and license declarations are preserved. Dependencies retain
their respective licenses; contact Walletor before reusing its code or branding.
