# Walletor architecture

## Current shape

```text
React SPA (Vite, React Router, TanStack Query)
  -> Wallet Standard discovery and wallet signature
  -> same-origin /api client
  -> Hono Worker
       -> request/address validation
       -> Jupiter Tokens V2 + Price V3 adapter (timeout, one safe retry, response validation)
       -> Helius DAS exact-mint metadata + confirmed Pump.fun webhook ingestion
       -> compact TOKEN_DB full-text search index
       -> Jupiter Swap V2 order/execute adapter (no-store, response validation)
       -> normalized shared contracts + cache/error headers
  -> Cloudflare Workers Static Assets (SPA fallback)
```

The browser and API are one deployable Worker project. `assets.run_worker_first` scopes execution to `/api/*`; missing client routes fall back to `index.html`. A SQLite-backed Durable Object serializes Prize Pool rounds, verified swap credits, participants, allocations, and WLT Points. The `DB` D1 binding contains the indexed production accounting mirror; the separate `TOKEN_DB` binding contains only a compact search index for token identities. Browser code cannot author either database.

## Current-source decisions (checked 2026-08-07)

- Cloudflare recommends Workers Static Assets for new full-stack/SPAs and its Vite plugin for local `workerd` parity. SPA routing uses `assets.not_found_handling: "single-page-application"`. Sources: [React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/), [Vite plugin static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
- Jupiter stays behind the Worker and shares one developer-platform key with swap APIs. Trending uses `/tokens/v2/toptrending/24h`, new listings use `/tokens/v2/recent`, token detail and risk context use exact-mint `/tokens/v2/search`, and validated price batches use `/price/v3`. Sources: [Jupiter Tokens V2](https://developers.jup.ag/docs/tokens/token-information), [Jupiter Price V3](https://dev.jup.ag/docs/price/v3).
- Helius DAS supplies exact-mint metadata and Helius webhooks supply validated Pump.fun creation events. D1 stores the minimum identity fields needed for name/symbol search; current price, liquidity, market cap, holder data, and images stay provider-owned and transient.
- The DEX uses Jupiter Swap V2 `/order` and `/execute`. The browser receives an unsigned order transaction, displays normalized route legs, fee and gasless details, asks the connected wallet to sign it, and returns the signed transaction plus Jupiter request ID for managed execution. Source: [Jupiter Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute).
- Token-detail input is a decoded 32-byte Solana mint before interpolation.
- Wallet discovery uses Wallet Standard through Solana’s React adapter without the legacy wallet bundle. Source: [Solana wallet connection](https://solana.com/developers/cookbook/wallets/connect-wallet-react).
- Walletor configures the verified Ultra referral account and a 50-bps fee on supported Jupiter orders (0.50% total: 0.40% Walletor / Prize Pool and 0.10% Jupiter). Executable orders are registered server-side; a Jupiter-confirmed execution is matched by request ID, its exact atomic fee is derived from the documented execution amount differences, and the signature is credited once by the serialized coordinator. Every confirmed fee-bearing swap contributes its Walletor share to the pool; only swaps valued at $5.00 or more earn two off-chain WLT Points and count toward the wallet's daily tier. The Prize Pool locks an immutable draw snapshot every UTC hour, while daily WLT and airdrop progress is aggregated independently across the UTC day. Eligible confirmed volume contributes separately to allocation weight. Mainnet-USDC claims are enabled for reviewed, funded, and activated distributions during the access-restricted launch.
- Stocks/RWA discovery uses an exact-mint Walletor registry. Trading is server-disabled and `/stocks-rwa` is a Coming Soon page until issuer eligibility and jurisdiction enforcement are approved.

## Caching and resilience

Public successful responses advertise short shared-cache lifetimes with stale-while-revalidate. Worker upstream calls set bounded timeouts and at most one retry for safe GET requests on retryable statuses. API errors use stable codes, HTTP status, `Retry-After` where known, and request IDs; logs contain no secret or response body.

## Environments

Local uses ignored `.dev.vars`. The source repository has a GitHub remote, while preview/staging and production bindings remain separate and must be configured only when deployment is authorized.
