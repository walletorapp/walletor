# Walletor fee reserve — October 12, 2026

The owner replaced the proposed Segmento-only allocation with a general reserve:
**11% of all new confirmed Walletor swap fees is withheld; the remainder funds
the Prize Pool.** No reserve recipient, payment schedule or automatic transfer is
configured. Segmento SDK analytics continue independently. No influencer code
import or additional Segmento API credential is needed for this reserve.

The base is Walletor's confirmed share after Jupiter's share, not swap volume,
network fees, the whole Jupiter referral fee, claim fees, seed deposits or the
advertised daily prize. For a $100 swap at the current 50 bps total referral fee,
Jupiter's share is $0.10 and Walletor's share is $0.40. Of the latter, $0.044 is
reserved and $0.356 funds the pool, subject to token-unit rounding.

## Activation and evidence

The Durable Object records its activation timestamp once when this version first
initializes. That timestamp is immutable and appears in the public fee terms and
private reserve report. Only executions confirmed at or after it are split.
Already credited transactions return their saved results, and recovered earlier
executions retain their original allocation. This does not backdate a deduction
against previous rounds or change already funded distributions.

Each fee uses BigInt atomic token units. The reserve rounds down; dust remains in
the pool. Gross = reserve + pool for every receipt. USD valuations are estimates,
split consistently with the actual token quantities. Gross receipt history and
gross collected totals remain intact; current pool and organic contribution
balances contain only the pool share. Reward eligibility, WLT points, and leader
ranking by gross fees are unchanged.

Reserve receipts, aggregate balances, gross fee receipts and pool credit are
written in the same storage transaction. A unique chain/signature key prevents
double deduction; receipt edits and deletes are rejected. Recovery uses the same
credit path. Backups include policy, receipts, balances and immutability triggers.

Closed-round funding sources now use each receipt's net pool amount. The existing
USDC funding/conversion flow therefore cannot allocate the reserved token portion
to a new prize distribution. Previously recorded sources retain their original
amounts. Manual operator transfers and the standalone conversion CLI can still
spend treasury funds; consult the reserve report before manually spending them.

## Reviewing the reserve

Walletor Admin → **Walletor fee reserve** → **Load reserve balance**.
The Cloudflare Access protected, read-only `/admin/api/fee-reserve` endpoint shows
all-time totals per mint and the latest 100 receipts. Downloading the report does
not move funds. Complete receipt history is included in the ledger backup.

The reserve is an accounting separation of fee receivables held back from prize
funding, not a new custody wallet or proof the fees have been withdrawn from
Jupiter. Different token amounts cannot be added together. No payment endpoint
or cron has been introduced; any later use needs a separate owner instruction.

## Verification

Tests cover the real coordinator credit and retry paths with SQLite storage:
gross/net/reserve conservation, duplicate execution, a failure after reserve
insertion with full rollback, recovery, activation cutoff, unchanged seed funds,
and closed-round funding amounts. Additional tests cover dust, large integers,
separate mints, immutable receipts and restoration from the ledger backup.

The complete 500-test suite passed, followed by both new Admin reserve tests and
the focused accounting tests. Typecheck, lint, changed-file formatting, production
build, launch-safety checks, docs validation/build and three relevant browser tests
passed. Direct local navigation showed 89% to pool and the 11% reserve explanation.

Deployed October 12, 2026:

- Main Worker: `a8f70f58-579c-4f92-815b-cb5b85fdd4cc`.
- Docs Worker: `e4de3869-9657-44a9-a81b-1c32b1214c28`.

Production site verification was blocked by the existing region restrictions
(the browser showed “Not available in your region”). No restrictions were changed
and no production swap or payment was submitted for testing.
