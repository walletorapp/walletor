# Walletor product specification

## Goal

Walletor is a responsive Solana DEX and token-intelligence dashboard. It gives traders a Jupiter-powered swap surface with fast, honest token search and research tools.

## Users and jobs

- A researcher opens `/tokens/:address`, reads current metrics, views a Dexscreener chart, copies the mint, and opens Dexscreener or Solscan.
- A trader connects a Wallet Standard wallet, receives a live Jupiter quote, reviews the wallet transaction, signs it, and sees success only after Jupiter reports confirmed execution.
- A trader searches Jupiter Tokens V2 by name, symbol, or mint, checks verification, organic activity and authority context, sees wallet balances and minimum received, and reviews the final wallet-specific order before signing.

## Current behavior

- Routes: `/swap`, `/rewards`, `/revenue-pool`, `/claim-rewards`, and `/tokens/:address`; `/` redirects to `/swap`.
- The swap surface provides token search, balance-aware amount controls, quote freshness, route legs, separate platform/total fee context, gasless/network-cost details, price-impact warnings, final-order review, and device-local confirmed history.
- Data refreshes in the background on a conservative cadence and always shows source/freshness metadata.
- Initial loading, refresh, empty, malformed-address, missing-secret, upstream-rate-limit, upstream-failure, and stale/degraded states are explicit.
- Third-party images may fail without breaking identity; initials are the fallback.
- The shell uses the established dark navy, mint (`#00ffa3`), and cyan identity, with responsive navigation and accessible contrast/focus.

## Walletor AI Engine beta

`/rewards` presents a connected wallet's authoritative current-round confirmed activity, volume, deterministic tier, and lifetime WLT Points from the serialized Walletor ledger. Every Jupiter-confirmed fee-bearing Walletor swap valued at $5.00 or more earns two WLT Points and adds its verified Walletor fee contribution to the participant snapshot; smaller swaps can execute but do not qualify. Tiers unlock at 1, 3, 5, and 10 eligible swaps and track activity without promising an odds multiplier. At round close, the two highest verified fee contributors receive ranks one and two; up to 20 additional unique wallets are selected with capped contribution-weighted Switchboard randomness. There is no trading cooldown, and repeated pair/amount combinations are allowed as distinct confirmed transactions.

The page reads confirmed swaps, cumulative volume, and WLT Points from the serialized server ledger. It does not derive rewards from device-local history and does not imply that WLT Points are transferable tokens.

Prize Pool recipients are not hand-picked by the Walletor team or selected by a
hidden AI prompt. The backend applies the published deterministic formula to a
locked round snapshot, then exposes the allocation checksum, recipients,
statuses, and available on-chain payout evidence in the public ledger.

## Explicitly absent

Smart-wallet rankings, transferable WLT tokens, and payout execution remain absent. `/claim-rewards` is a read-only connected-wallet claim center: it displays ledger-derived allocations, round timing, fee policy, and history while clearly marking the audited claim vault as pending. Fictional pool, payout, countdown, trader, and distribution figures are not displayed. The browser records device-local history only after Jupiter confirmation and never presents it as authoritative global accounting.

## Success criteria

Swap and token-detail routes operate through `/api`, direct navigation works under Cloudflare SPA fallback, secrets remain server-only, contract boundaries are runtime-validated, and automated checks cover UI and Worker success/failure paths.
