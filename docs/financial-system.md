# Walletor financial system

## Current implementation status

Walletor configures its verified Ultra referral account at 50 bps on every supported Jupiter Swap V2 order: a 0.50% total referral fee, split into a 0.40% Walletor fee and a 0.10% Jupiter share. All of Walletor's confirmed partner share is allocated to the Prize Pool. `JUPITER_REFERRAL_FEE_ENABLED=true` and `ACCOUNTING_ENABLED=true` activate fee-bearing order registration and confirmed-execution accounting. `PAYOUTS_ENABLED=true` currently exposes the mainnet-USDC claim APIs for Walletor's access-restricted launch. A claim is available only after a real round is locked, reconciled, funded, staged, and activated on-chain. The configured WLT rate is exactly two off-chain points per eligible Jupiter-confirmed fee-bearing Walletor swap valued at $5.00 or more.

For a $100 fee basis, the referral fee is $0.50: $0.40 Walletor / Prize Pool and $0.10 Jupiter. This is an example, not a guaranteed output quote. Token prices, slippage, network costs, and any additional Jupiter execution costs may change the actual amounts. The UI displays the total fee separately from Walletor's net share and uses the normalized order's actual rates. Previously registered orders and ledger receipts are not repriced when the configuration changes.

The Worker adds `referralAccount` and `referralFee` to every Jupiter Swap V2 order. It rejects the order unless Jupiter returns the configured account, the exact referral rate in `platformFee.feeBps`, at least that rate in total `feeBps`, and matching valid top-level/platform fee mints. This response proof replaces the former static four-mint allowlist and prevents unsupported pairs from silently producing an uncharged Walletor swap.

When Jupiter selects a fee mint whose referral token account is missing, the Worker records it in an authenticated D1 operations queue and returns a non-executable activation-pending error. A separate least-privilege process uses Jupiter's official Referral SDK to create only the needed account and records the account plus Solscan-verifiable initialization signature. The next order must still pass the complete Jupiter proof before it is accepted.

The browser cannot credit swaps, Prize Pool funds, WLT Points, allocations, claims, or payouts. Before signing, the Worker persists the executable order's wallet, assets, fee mint, referral terms, and valuation basis. Jupiter execution status `Success` with code `0` confirms the transaction. The Worker derives the exact total fee from the documented atomic execution-amount differences, applies Walletor's 80% share, and credits the signature once.

## Implemented architecture

- `PrizePoolCoordinator`, a SQLite-backed Durable Object keyed by pool and chain, is the serialized accounting writer.
- D1 migration `0001_financial_foundation.sql` defines the indexed mirror and audit schema without deleting legacy data.
- Exact atomic-unit strings, integer micro-USD estimates, basis points, and integer WLT Points are used throughout accounting. No JavaScript floating-point arithmetic updates financial state.
- Prize Pool rounds use one-hour UTC windows aligned to the top of each hour.
- A due round is locked once, the next OPEN round is created immediately, and the immutable draw snapshot records each wallet's confirmed activity, eligible volume, and verified fee contribution.
- Allocation cents are floored; the remainder is recorded and carried into the next round.
- `(chain_id, transaction_hash)` is unique and returns the stored result on retry.
- Ledger and WLT ledger tables are append-only. Corrections require new reversing entries.
- `/api/prize-pool` is ledger-derived, supplies server time, and separates organic fees, treasury seeds, distributions, platform revenue, and remainder.
- `/api/prize-pool/distributions?month=YYYY-MM` exposes every finalized round in the requested UTC month plus the complete list of months that contain public records.
- `/api/prize-pool/distributions/:roundId` publishes paginated recipient allocations, activity weights, statuses, checksums, and validated payout signatures for finalized rounds.
- The UI derives countdown, progress, and percentage from the same backend timestamps and server-clock offset.

## Confirmed swap gate

The coordinator rejects credits unless accounting is enabled and the execution matches a previously registered, fee-enabled Jupiter order. Input-fee swaps use `totalInputAmount - inputAmountResult`; output-fee swaps use `outputAmountResult - totalOutputAmount`. A missing or zero fee is not credited. `(chain_id, transaction_hash)` and the Jupiter request ID make retries idempotent.

No public endpoint accepts caller-authored accounting evidence. Only Walletor's own `/api/swap/execute` path can pass the validated Jupiter result to the coordinator. USD figures are quote-time estimates; exact atomic balances remain the reconciliation source of truth.

Fees from every valid confirmed Walletor order enter the pool. A swap earns two WLT Points and adds its volume and fee contribution to the draw snapshot only when its exact quote-time valuation is at least 500 integer cents. Smaller swaps remain executable but do not advance rewards. There is no daily count cap or cooldown: repeated pairs and amounts are allowed when each is a distinct eligible confirmed transaction. Signature idempotency remains an accounting invariant, not a trading restriction.

## Deterministic rewards

The existing beta ledger continues to preserve its historical non-payable
proportional USD estimates. Every newly locked V3 round stages a separate
production Prize Draw snapshot with a default maximum of 22 unique winners,
the frozen 250 bps claim fee, exact fee-contribution and volume totals,
canonical wallet ordering, capped lucky-draw weights, cumulative ranges, a
participant checksum, and Merkle proofs. The snapshot is stored before
Switchboard randomness is committed.

```text
leader order = fee contribution DESC, volume DESC, swaps DESC, wallet ASC
lucky weight = min(max(fee contribution micro-USD, 1), 5 × lower median)
```

The two leaders receive 20% and 10% of the gross pool and cannot also win a lucky place. Up to 20 other wallets are selected through Switchboard and share the remaining 70% equally. The cap rewards more fee contribution while limiting domination by a single wallet. If fewer than three wallets qualify, one wallet receives 100%, or two wallets receive two-thirds and one-third. Historical V2 rounds retain their equal-share rules and immutable records.

Walletor therefore does not ask ChatGPT, an administrator, or another hidden
operator to pick winners. The two leaders and lucky recipient allocations are
produced by the published formula from the locked round snapshot. After finalization, the
allocation checksum, recipient wallets, amounts, statuses, and real payout
signatures are exposed through the public distribution ledger. A team member
cannot replace a recipient without creating evidence that conflicts with the
published checksum and append-only records.

WLT Points do not use the tier multiplier. Every newly credited eligible confirmed fee-bearing swap valued at $5.00 or more earns exactly two lifetime off-chain points once. The append-only source-transaction idempotency key prevents a signature retry from creating another credit. Existing balances and stored successful credits remain immutable; historical credits are not repriced when the current threshold changes.

## Payout decision

Model B (user claim) is implemented behind `PAYOUTS_ENABLED`. Walletor deducts a 250 bps (2.50%) fee from each gross allocation before the authority funds an official-USDC Merkle distribution through the Solana Foundation Rewards Program. The winner signs and sends the exact claim transaction and pays its Solana network/rent cost. The Worker does not custody funds, hold a signer, relay a signed transaction, or infer success: it validates the confirmed transaction and on-chain claim PDA before updating its mirror. A locked payout gate still returns the legacy allocation view as unavailable rather than pretending a claim is live.

## API contracts

`GET /api/prize-pool` returns integer-cent USD estimates, one active round, up to 25 recent completed rounds, public treasury/referral terms, valuation disclosure, server time, accounting status, and claim status. `GET /api/prize-pool/distributions?month=YYYY-MM` powers the UTC history calendar without limiting discovery to those 25 recent rounds. `GET /api/prize-pool/distributions/:roundId` returns up to 100 recipient allocations per page for a finalized round. `GET /api/wallets/:address/engine` returns current-round activity, tier, and lifetime WLT Points. `GET /api/wallets/:address/solana-claims` reads active USDC entitlements from immutable D1 terms plus current Rewards claim PDAs. `POST /api/solana-claims/build` builds an exact short-lived claim transaction and `POST /api/solana-claims/submit` confirms a wallet-submitted signature.

Cloudflare Access protects distribution preparation, staging, and activation under `/admin/api/claim-distributions/*`. The backend, not the browser, derives winners, fee splits, net amounts, Merkle proofs, and the distribution transaction.

## Known blockers

1. A continuously supervised operations host is still required to process newly observed fee mints; the first order for a new fee mint remains blocked until its referral token account confirms.
2. Jupiter retains 20% of the integrator fee. The official Referral SDK claim and guarded manual conversion commands are implemented, but every conversion still requires an explicit treasury signature and exact on-chain USDC reconciliation.
3. The production migration, private RPC, and payout gate are active. Exact USDC reconciliation, legal approval, and a small recorded canary remain required before the first distribution is exposed beyond the controlled launch.
4. USD values are quote-time estimates and must be revalued and reconciled to exact official-USDC atomic units before a distribution is funded.

Production treasury procedures and live conversion commands are maintained in private operator runbooks. The public example configuration disables financial execution.

These are product, custody, and security decisions. The application fails closed rather than inferring them.

## Rollback

1. Set `PAYOUTS_ENABLED=false`, then `ACCOUNTING_ENABLED=false`.
2. Deploy the previous Worker version. Do not delete D1 or Durable Object storage.
3. Preserve Queue messages and pause consumers if payout processing exists.
4. Export D1 and record the Worker version and incident time.
5. Reconcile immutable ledger entries against chain history before re-enabling.
6. Corrections use reversing entries; never edit or delete historical ledger rows.
