# Real-time Solana token discovery

Walletor combines three discovery paths without changing swap authority:

1. Jupiter Tokens V2 provides indexed metadata, verification, activity, price,
   and liquidity.
2. Helius DAS resolves on-chain fungible-token metadata for exact mint searches.
3. A confirmed Pump.fun transaction webhook inserts new launches into Walletor's
   compact D1 full-text index immediately.

The browser never receives either provider secret. Finding a mint does not prove
that it can be swapped; the existing Jupiter Swap V2 order request remains the
route authority.

## Token-index storage

Discovery uses the dedicated `walletor-token-index` D1 database through the
`TOKEN_DB` binding. It stores only the stable fields required for immediate
search: mint, name, symbol, decimals, source, creation time, token program,
creation signature, verification state, and retention timestamps.

Prices, market cap, liquidity, holder counts, risk scores, and logos are not
persisted in the compact index. Jupiter supplies current market and route data;
Helius supplies exact-mint metadata and images. The accounting database remains
independent and continues to own fee, reward, and claim records.

Apply only the dedicated token migration to the token database:

```sh
npx wrangler d1 migrations apply TOKEN_DB --remote
```

The former `discovered_tokens` table in `walletor-accounting` is a read-only
compatibility source during the cutover. New webhook and Jupiter sync writes go
only to `TOKEN_DB`, so the accounting database stops growing with token data.

## Configure the Worker ingestion secret

Generate a long random value and store it in the Worker binding. Do not commit
the value.

```sh
npx wrangler secret put TOKEN_INGEST_SECRET
```

For local development, place the same value in the ignored `.dev.vars` file.

## Create the Pump.fun webhook

Create a Helius API key, copy `.env.operator.example` to the ignored
`.env.operator` file, and set `HELIUS_API_KEY`, `TOKEN_INGEST_SECRET`, and
`WALLETOR_PUBLIC_URL`. Then run:

```sh
npm run tokens:webhook:helius
```

The setup watches the official Pump program, requests successful raw mainnet
transactions, and asks Helius to echo the bearer secret in the `Authorization`
header. Walletor validates the instruction discriminator, Solana addresses,
transaction signature, metadata URI, and instruction fields before writing D1.

## Search behavior

- Name and symbol searches merge Walletor's compact D1 index, the read-only
  legacy index, and Jupiter Tokens V2.
- An exact mint lookup is checked against D1 and Jupiter, then enriched or
  resolved from Helius when available.
- `New` shows the combined recent feed.
- `Pump.fun` shows confirmed launches received by the webhook.
- `Verified` hides unverified indexed launches.
- The swap button is enabled only after Jupiter Swap V2 returns an executable
  route.

The minute cron synchronizes Jupiter's recent first-pool feed as a backup. It is
not a replacement for the real-time Pump.fun webhook. A 15-minute maintenance
job deletes unverified tokens older than 72 hours in bounded batches. Tokens
used in an exact-mint lookup or order preparation are retained for 30 days, and
verified tokens are retained.

Searchability does not create a Jupiter referral token account. Walletor creates
fee-mint accounts on demand only when Jupiter selects that mint for a real order;
the corresponding provisioning procedures are maintained in the private operator runbooks.
