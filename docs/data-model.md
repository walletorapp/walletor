# Walletor data model

## Current release

Market-data responses remain transient validated contracts. Device-local Jupiter history is not an accounting record. Executable fee-enabled orders and confirmed executions are persisted in a SQLite-backed Durable Object, which serializes exact per-mint referral fees, signature idempotency, Prize Pool valuation, participant counts, and WLT Points. D1 migrations define the indexed mirror, audit, recovery, claims, payouts, and reconciliation structures. Mainnet-USDC claims are enabled only for funded and activated distributions in the access-restricted launch.

Token discovery is isolated in the `walletor-token-index` D1 database. Its
`token_search_index` table stores stable searchable identity and provenance only:
mint, name, symbol, decimals, source, token program, creation signature,
creation/seen/update times, optional last-used time, and Jupiter verification
state. It does not store live market or portfolio values. Unverified untouched
records expire after 72 hours; exact-mint searched or order-used records are
retained for 30 days; verified records are retained.

The Durable Object allocation record reserves a unique nullable `payout_transaction_hash`. Public distribution reads expose finalized round dates, pool totals, eligible counts, allocation checksum, recipient wallet, multiplier, reward cents, status, and that payout signature. A missing signature is displayed as missing evidence; it is never replaced with a fabricated explorer link.

## Implemented financial schema foundation

Migration `0001_financial_foundation.sql` implements the following production structures without enabling financial writes:

- `wallet_nonces`: nonce hash, public key, expiry, used-at; unique and single-use.
- `wallet_sessions`: hashed token, wallet id, issued/expiry/revoked timestamps.
- `wallets`: canonical public key and timestamps.
- `swaps` and `fee_events`: finalized transaction evidence, fee evidence, exact atomic amounts, and `(chain_id, transaction_hash)` uniqueness.
- `prize_pools`, `rounds`, and `round_participants`: serialized UTC-round state and deterministic eligibility snapshots.
- `pool_ledger`: append-only exact-cent events; corrections are reversing entries.
- `wlt_points_ledger`: append-only exact integer credits with source transaction and resulting lifetime balance.
- `reward_allocations`: epoch + wallet uniqueness, atomic allocation, formula version, snapshot provenance.
- `claims` and `payout_jobs`: the original idempotent payout-orchestration foundation. The active mainnet-USDC flow uses the immutable distribution, entitlement, and preparation tables added by migrations `0006` through `0009`.
- `audit_logs`, `reconciliation_alerts`, `flagged_wallets`, and `system_settings`: provenance and operational controls.

The migration includes foreign keys, checks, query indexes, immutable-ledger guards, and integer/string exact-value boundaries. Activation still waits for fee asset, custody, payout, finality, compliance, and provider decisions.

Migration `0004_prize_draws.sql` adds the production draw mirror: the policy
frozen for each round, participant ranges and Merkle leaves, Switchboard and
vault evidence, up to 100 unique winner records, exact lamport claim amounts,
and claim status. The SQLite-backed Durable Object independently stages the
same canonical participant snapshot when a round locks. The initial configured
winner count is 20. A payout requires exact-USDC reconciliation plus a funded,
staged, and activated Solana Foundation Rewards Program distribution.
