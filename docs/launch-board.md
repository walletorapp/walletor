# Walletor new-token discovery

Route: `/trenches`. Data: `GET /api/tokens/launches`.
Legacy `/new-tokens` links redirect to `/trenches`, retaining query parameters
and browser fragments.

This implements Walletor's own launch screen; GMGN is not a dependency.
The first version covers observed Pump.fun launches on Solana mainnet.

## Sources and lifetime

One named `LaunchFeed` Durable Object owns one outgoing PumpPortal WebSocket,
shared by every visitor. It subscribes only to documented free `subscribeNewToken`
and `subscribeMigration` events. No wallet or metered trade subscription is used.
The socket closes after roughly two idle minutes with no board viewers. Backoff
limits reconnects. The bounded event snapshot is persisted every minute while
active; it is discovery metadata, never financial evidence.

The snapshot retains up to 300 creation and 100 migration observations. It checks
all retained candidates and selects up to 80 rows with reserved
space for New, About to graduate and Graduate. Older nearing-graduation tokens
are checked rather than skipped by a newest-token sample. The retention window
is six hours. A separate Birdeye screener also supplies older candidates beyond
this recent launch stream, as described below. This is not an exhaustive index or
a guarantee to capture activity while no one has the board open.
"Seen" is Walletor's observation time, not a claimed chain creation timestamp.

Cached enrichment is shared for ten seconds in the Durable Object. Batched
read-only Solana `getMultipleAccounts` requests check curves and canonical
PumpSwap pools. Batched public DEX Screener requests provide available market
measurements and images. Missing fields remain null, rendered as a dash.
During an upstream interruption, available market values are retained for at most
60 seconds with their original `marketCheckedAt` time. Hovering metrics shows that
time. Onchain stages are not carried
forward when current chain verification fails.
RPC credentials stay on the Worker. Account reads are batched at 100 addresses
per call, including up to 200 discovered candidates alongside the 400 retained
observations. The canonical PumpSwap pool is still required for the Graduate column;
an empty column is not filled with invented or unverified tokens.

The Trenches shell inherits the same navy background, ambient layers and shared
navigation surfaces as Swap. A compact header bar shares Swap's public prize-pool
query, amount presentation and server-adjusted round countdown. It is centered on
desktop and spans the header on mobile, with a thin round-progress indicator.
It displays existing state only and cannot change fees, rounds or claim balances.
Compact token rows expose holder count, social
links, tax, SOL fees, 24-hour transactions and buy/sell balance, plus badges for
top-10, developer, sniper, insider, bundled holdings and Dex Screener paid status.
Missing values show a dash, never a presumed zero or a safety verdict. Free
sources currently populate price/volume/liquidity, identity/social links and
some holder/trade counts; they do not supply the fee/tax and risk badges above.
Those remain unknown until a verified provider supplies them. No paid security
endpoint is called and no plan is upgraded. Dex Screener transaction counts refer
to the selected highest-liquidity pair; Birdeye counts cover its indexed token
activity. These are distinct provider scopes, not an exhaustive chain-wide count.

Token logos are also resolved independently from the creation event's metadata
URI. A background pass reads up to 20 metadata documents, with five concurrent
requests, 2.5-second deadlines and a 64 KiB response limit. IPFS URIs/gateway URLs
are rewritten to the fixed `ipfs.io` gateway; content-addressed Arweave URLs use
`arweave.net`. Validated static metadata paths on Vortex Deployer, J7 Tracker and
Vercel Blob are also supported. Arbitrary metadata hosts and redirects are not fetched. HTTPS/IPFS
image links are validated before returning them to the browser. Unsupported or
unavailable metadata retains the initials fallback.

Successful logo lookups are cached separately for 24 hours (bounded to 400
entries), including across Durable Object restarts. Failed lookups retry after
five minutes. Market-data expiration does not erase an available logo. A changed
image URL can retry in the browser after a previous URL failed to load. These
lookups consume no Birdeye quota and do not block the board snapshot.

For older events without a metadata URI, or public gateways that reject requests,
the existing server-side Helius key can resolve up to 80 missing logos in one
`getAssetBatch` call. The singleton reserves at most one such call per minute in
durable storage before sending. All visitors share that cap (at most 446,400
Helius credits per 31 days at the documented 10 credits per DAS call, within the
existing account allowance, shared with other Helius uses). No plan or automatic
credit purchase is changed. Returned asset IDs must match requested mints; CDN
images are preferred and validated. This fallback does not fetch arbitrary URLs
with RPC credentials and does not supply prices or authoritative chain stages.

### Birdeye Standard-plan supplement

`BIRDEYE_API_KEY` is a server-only Cloudflare secret. The singleton feed coordinator
uses `GET /defi/token_overview` to supplement missing market fields and images;
discovery and 10-second board refreshes continue through the existing sources.
No Birdeye WebSocket or paid batch endpoint is used. This limited free integration
does not provide a continuously refreshed Birdeye market feed for every row.

The overview supplement now makes at most one request every three hours while
viewers and incomplete tokens exist. It reserves 18 CU per attempt before sending,
capped at 4,986 CU (277 attempts) in any rolling 31 days. Broader discovery has a
separate 19,000 CU cap; together they stay below 24,000 CU, leaving room in the 30k
free allowance. The allowance applies to this integration only; other uses of the same
Birdeye account also consume its quota. Failed requests count conservatively.
The budget survives Durable Object restarts/deployments. Corrupt budget state or
storage failure disables requests rather than resetting the cap. Auth/access/rate
errors pause requests for 24 hours. No plan upgrade or overage is enabled here.

Response schemas and mint identity are validated. Only missing display fields
are supplemented; chain stage and financial accounting are never derived from
Birdeye. Cached market fields expire after 60 seconds; identity metadata may be
reused for 24 hours. Empty or unavailable fields remain dashes. All visitors share
one budget and cache. Provider errors log fixed status codes, never credentials
or upstream response bodies.

Current references:

- https://data.birdeye.so/docs/data-api/stats/get-defi-token-overview
- https://data.birdeye.so/docs/guides/what-is-compute-unit-cost
- https://data.birdeye.so/docs/guides/data-accessibility-by-packages

### Older near-graduation discovery

The creation stream alone cannot find coins created before Walletor observed
them. `LaunchDiscovery` uses Birdeye's free-access `GET /defi/v3/token/list` with
`platform_name=pump.fun`, a $10k–$150k market-cap discovery window, recent-trade
sorting and up to 100 candidates. Market cap is a search filter, not proof of
graduation progress. Every candidate passes the existing on-chain curve/pool
verification before assignment to any column.

Discovery refreshes at most every two hours while the board has viewers. It
retains up to 200 candidates across refreshes for at most 24 hours; their first
Walletor observation time is preserved. These cached addresses are rechecked
with the usual board snapshots, so a discovered coin can move between stages
without another screener request. This is broader discovery, not a complete,
continuously indexed view of every Pump.fun coin. The free plan limits discovery
frequency and coverage; nothing bypasses provider access rules.

Each discovery attempt reserves 50 CU before sending, including failures. The
rolling 31-day cap is 19,000 CU (380 attempts). Before reserving, discovery also
reads the existing overview budget, so historical usage from the previous higher
overview cap is not reset or ignored. Combined usage may not exceed 24,000 CU.
Auth/access/rate errors back off for 24 hours; malformed state disables requests.
No plan upgrade, paid WebSocket, or paid meme-list endpoint is used.

Discovery cache persists independently of the recent event stream and survives
deployments. Public responses expose discovery availability and last success time.
If discovery is unavailable and the middle column has no verified rows, its
empty state reports that outage instead of implying that the market has no
near-graduation tokens. Cached price/count fields still expire after 60 seconds;
identity/social data can last 24 hours. The screener never grants fees, rewards,
quest completions, or trading authority.

Reference: https://data.birdeye.so/docs/data-api/tokenmarket-list/get-defi-v3-token-list

## Classification

- New: a correctly owned/discriminated Pump curve with `complete=false`.
- Almost bonded: estimated progress >=80%, using current Pump global initial
  real reserves and the curve's remaining real reserves with exact integer math.
  Only standard-supply, non-mayhem, SOL-paired curves use this estimate. Global
  parameter changes can change estimates; these are not financial quotes.
- Migrated: `complete=true` plus the canonical index-0 SOL PumpSwap pool, checked
  for expected program owner, discriminator, base mint and quote mint.
- Unknown: missing/unconfirmed/unsupported state. A completed curve alone does
  not establish that a pool has migrated. Unknown entries are excluded from the
  three displayed columns.

The curve/global/pool layouts and derivation seeds follow Pump's public IDL and
documentation. Unsupported custom quote assets do not get an invented percentage.

## Swapping

Token names and thumbnails open `/tokens/<mint>`, a full-width Walletor trading
page. It combines a Dexscreener chart/recent-trades embed with normalized Jupiter
market activity and token controls, plus the existing Walletor swap form. On
mobile a Trade link jumps to the form. Chart/trades display can be toggled without
changing the selected mint. `GET /api/tokens/:address/chart-market` resolves the
highest-liquidity Solana pool whose base token exactly matches the mint; quote-only
matches cannot substitute another token's chart. The read-only lookup uses the
public Dexscreener API with a 30-second edge cache. The browser checks once per
minute while open and shows a missing-chart state when no matching pool exists.
New launches can fall back to available public
Trenches metadata when Jupiter has not indexed their market details yet.
Unavailable controls remain unknown. No new Birdeye calls, subscriptions or paid
plans are introduced. The chart/trade feed is third-party content; it is not a
Walletor trade ledger or execution confirmation.

Row swap actions open `/?outputMint=<mint>`. The action shows **Swap** when a wallet is
connected and preserves that wallet through client-side navigation. Otherwise it
shows **Connect wallet**, opens the shared wallet chooser, and clears any stale
disconnected adapter selection while keeping the requested mint in the URL.
Walletor resolves the exact mint via its existing metadata search, blocks trading
while resolution is pending/failed, and selects the token only after a matching
response. Browsing or opening Swap never signs a transaction. An actual Jupiter
executable quote and wallet approval are still required.

**This release does not add a direct pre-Jupiter bonding-curve execution adapter.**
Discovery, migration and market data cannot award fees, WLT, referrals or quests.
Existing verified Jupiter execution/accounting remains authoritative. Direct
launchpad execution requires a separate transaction-validation and fee-accounting
implementation before activation; do not advertise every listed token as tradable.

## Validation and operations

Tests cover event validation, stage thresholds, false migration claims, missing
measurements, upstream failure, responsive tabs, filtering and exact swap-mint
handoff. Actual live data must also be checked in the Cloudflare runtime: Node's
fetch accepts `redirect:error`, but Workers requires `redirect:manual`. All requests
here use manual redirects and reject non-success statuses; credentials are never
forwarded to a redirect destination. The same compatibility correction is applied
to Questline reporting, with a redirect-rejection regression test.

Workers-native `fetch` is invoked as a standalone function, never as a method of
the discovery/overview/logo classes. Binding it to a class instance raises an
illegal-invocation TypeError in production despite succeeding in Node. Regression
tests use receiver-sensitive fetch functions for all three clients. A request
version permits a single retry after this compatibility correction while retaining
every previously reserved CU; deployments do not reset budgets or spend limits.
Discovery status and next retry time are available in the public read-only
response, without upstream error bodies or credentials.

The public response includes feed connection state, last observed event time,
enrichment time and chain/market availability. It exposes no generic RPC proxy,
upstream URL credentials, or transaction-execution endpoint.

References:

- https://pumpportal.fun/data-api/real-time/
- https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md
- https://docs.dexscreener.com/api/reference
