# Walletor direct influencer program

This is Walletor's own influencer program, independent of Segmento. The previous
Segmento-mapping proposal was not activated: its registry was empty and its
production status reported no activation date. No Segmento CSV, API key, creator
ID or administrator approval is needed to enroll in the direct program.

## Influencer onboarding

1. Open https://walletor.com/influencers and connect a Solana wallet.
2. Choose **Create my influencer link** and sign the free enrollment message.
   The signature binds the domain, wallet, generated code, direct policy version,
   purpose, nonce and expiry. It never authorizes a transaction or transfer.
3. Copy the generated Walletor link. Codes have the form `wlr-<public-wallet>`;
   the display name is derived from the public wallet address. Both are immutable.
4. Return with the same wallet and sign a report request to view exact period
   and lifetime earnings. Reports for another creator cannot be substituted.

All creators can enroll themselves. Signature verification proves control of the
registered wallet; it does not verify social followers, legal identity or audience
quality. A person cannot claim a different wallet's code. Replay, expired, wrong
purpose and forged signatures fail. Existing trading wallets may enroll as
creators; the new-wallet restriction applies to their referred users.

## Referred user registration

The direct link is remembered on this browser for up to 30 days. A new user
connects a wallet and chooses **Register creator referral**, before requesting
their first Walletor swap quote. The free signature creates the permanent server
relation. First signed registration wins; it cannot be replaced by another URL.

The relation survives browser changes, cookies, rounds and later visits when the
same wallet is used. Another wallet needs its own registration. Prior orders,
existing traders, self-referrals and conflicting native WLT referrals cannot join.
Native WLT ownership is preserved in both directions. Connecting a wallet or
loading a link alone does not register it or generate commissions.

Direct links are excluded from the Segmento SDK, even if Segmento UTM/redirect
markers are present. The direct registration component does not depend on the
Segmento tracking preference or project token. Existing Segmento campaigns keep
their separate SDK analytics and short-link routing. They do not automatically
become direct-program commission relationships.

## Exact economics

- Policy: `walletor-direct-influencer-v1`, persisted at first deployment startup.
- The creator earns **10% of Walletor's actual confirmed fee share** from future
  swaps of their registered referred wallets, for the lifetime of that relation.
- **No Segmento or other third-party platform commission** applies to this policy.
- Commissions are earmarked inside the existing 11% reserve. The pool retains its
  89% contribution. The remaining reserve portion stays unassigned; no additional
  deduction, extra customer charge or payment is introduced.
- The base excludes Jupiter's share, network fees, seeds, unfunded pledges,
  unrelated wallets and historical/pre-registration orders.
- Amounts use exact atomic integers in the token received, rounding commission
  down. Earnings in different mints are not added as a single USD amount.
- Terms, activation, ownership, attribution and commission receipts are immutable.
  There is no end date on linked wallets under this version. Future policy
  versions must preserve existing relationships' agreed terms.
- The legacy SQL column named `segmento_atomic` is retained for schema compatibility
  but is always zero under this policy. Public direct reports call it
  `platformAtomic` and enforce the literal value `"0"`.

At the current referral fee, a $100 swap may generate $0.40 in Walletor fees.
The direct influencer accrues $0.04; actual recorded fee tokens determine the
exact commission, not the illustrative USD quote.

## Manual payment every 30 days

Owner opens Walletor Admin → **Lifetime influencer commissions**, chooses a
closed UTC reporting window up to 31 days, and exports the statement. Period
totals cover the whole window, even when raw receipts have multiple pages.
The historical fee-only preview ignores attribution and is never a payable report.

Reconcile the statement with reserved fee receipts and available treasury assets.
Agree the payment asset/conversion treatment with each creator, then pay manually
and retain the statement and transfer proof. The enrollment wallet is the creator
identity; no automated transfer or destination change is authorized by enrollment.

Reports display **accrued fees**, not proof of available treasury funds, completed
payments or a net unpaid balance. A verified payment journal is still needed
before showing paid/unpaid balances. Until then, maintain a settlement register
with closed windows and transaction proofs outside this dashboard, and never
pay the same statement twice. No payout API or email sender is enabled.

## Verification and operations

Commission writes occur inside the same coordinator transaction as fee receipts,
reserve entries and net pool contributions. The matching verified reserve receipt
must exist, liability cannot exceed the reserved amount, and
`(chain_id,transaction_hash)` is unique. Failures roll all writes back; recovery
and reconciliation use the same path. SDK events cannot author financial data.

SQL backups include policy, registry, challenges, wallet links, raw commission
receipts and exact lifetime/day aggregates. Private reports require a signed,
single-use five-minute challenge and are restricted to the signing creator.
Admin reports still require Cloudflare Access. Public POST requests have a
4 KiB body limit, origin checks and a separate 30-per-minute IP rate limit.
Expired challenges are cleaned up. Enrollment never grants administrator access.

Validation covers enrollment and code ownership, signature forgery/expiry/replay,
Segmento/direct routing separation, native referral conflicts, historical orders,
exact/dust/large amounts, distinct mints, retries and atomic rollback, pagination,
UTC statement boundaries, backup restore, private reports and the real coordinator.
The broader browser suite has existing swap/token-search assertion failures;
do not describe the entire browser suite as passed.
