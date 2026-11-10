import type { HeliusTokenMetadata } from "./helius-assets";
import type {
  PumpTokenIngestItem,
  SwapTokenSearchResult,
} from "../../shared/contracts";
import { SwapTokenSearchResultSchema } from "../../shared/contracts";

const SEARCH_LIMIT = 20;
const RECENT_LIMIT = 50;
const DEFAULT_PRUNE_LIMIT = 500;
const UNTOUCHED_RETENTION_MS = 72 * 60 * 60 * 1_000;
const USED_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const ACCESS_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

interface MinimalTokenRow {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  source: "jupiter" | "pumpfun" | "helius";
  created_at: string;
  is_verified: number;
}

interface LegacyTokenRow extends MinimalTokenRow {
  source: "jupiter" | "pumpfun";
  logo_url: string | null;
  organic_score: number | null;
  organic_score_label: "high" | "medium" | "low" | null;
  price_usd: number | null;
  market_cap_usd: number | null;
  liquidity_usd: number | null;
  holders: number | null;
  mint_authority_disabled: number | null;
  freeze_authority_disabled: number | null;
  top_holders_percent: number | null;
}

function nullableBoolean(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}

function minimalRowToSearchResult(row: MinimalTokenRow): SwapTokenSearchResult {
  return SwapTokenSearchResultSchema.parse({
    address: row.mint,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    logoUrl: null,
    isVerified: row.is_verified === 1,
    organicScore: null,
    organicScoreLabel: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    holders: null,
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    topHoldersPercent: null,
    source: row.source,
    discoveredAt: row.created_at,
  });
}

function legacyRowToSearchResult(row: LegacyTokenRow): SwapTokenSearchResult {
  return SwapTokenSearchResultSchema.parse({
    address: row.mint,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    logoUrl: row.logo_url,
    isVerified: row.is_verified === 1,
    organicScore: row.organic_score,
    organicScoreLabel: row.organic_score_label,
    priceUsd: row.price_usd,
    marketCapUsd: row.market_cap_usd,
    liquidityUsd: row.liquidity_usd,
    holders: row.holders,
    mintAuthorityDisabled: nullableBoolean(row.mint_authority_disabled),
    freezeAuthorityDisabled: nullableBoolean(row.freeze_authority_disabled),
    topHoldersPercent: row.top_holders_percent,
    source: row.source,
    discoveredAt: row.created_at,
  });
}

function ftsPrefixQuery(value: string): string | null {
  const terms = value
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 8);
  if (!terms?.length) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
}

export async function searchIndexedTokens(
  db: D1Database,
  query: string,
): Promise<SwapTokenSearchResult[]> {
  const normalized = query.trim();
  const exact = await db
    .prepare(
      `SELECT mint, symbol, name, decimals, source, created_at, is_verified
       FROM token_search_index
       WHERE mint = ?
       LIMIT 1`,
    )
    .bind(normalized)
    .first<MinimalTokenRow>();
  if (exact) return [minimalRowToSearchResult(exact)];

  const ftsQuery = ftsPrefixQuery(normalized);
  if (!ftsQuery) return [];
  const result = await db
    .prepare(
      `SELECT d.mint, d.symbol, d.name, d.decimals, d.source,
              d.created_at, d.is_verified
       FROM token_search_fts
       JOIN token_search_index AS d ON d.row_id = token_search_fts.rowid
       WHERE token_search_fts MATCH ?
       ORDER BY bm25(token_search_fts), d.created_at DESC
       LIMIT ?`,
    )
    .bind(ftsQuery, SEARCH_LIMIT)
    .all<MinimalTokenRow>();
  return result.results.map(minimalRowToSearchResult);
}

export async function searchLegacyIndexedTokens(
  db: D1Database,
  query: string,
): Promise<SwapTokenSearchResult[]> {
  const normalized = query.trim();
  const exact = await db
    .prepare(
      `SELECT mint, symbol, name, decimals, logo_url, source, created_at,
              is_verified, organic_score, organic_score_label, price_usd,
              market_cap_usd, liquidity_usd, holders,
              mint_authority_disabled, freeze_authority_disabled,
              top_holders_percent
       FROM discovered_tokens
       WHERE mint = ?
       LIMIT 1`,
    )
    .bind(normalized)
    .first<LegacyTokenRow>();
  if (exact) return [legacyRowToSearchResult(exact)];

  const ftsQuery = ftsPrefixQuery(normalized);
  if (!ftsQuery) return [];
  const result = await db
    .prepare(
      `SELECT d.mint, d.symbol, d.name, d.decimals, d.logo_url, d.source,
              d.created_at, d.is_verified, d.organic_score,
              d.organic_score_label, d.price_usd, d.market_cap_usd,
              d.liquidity_usd, d.holders, d.mint_authority_disabled,
              d.freeze_authority_disabled, d.top_holders_percent
       FROM discovered_tokens_fts
       JOIN discovered_tokens AS d ON d.row_id = discovered_tokens_fts.rowid
       WHERE discovered_tokens_fts MATCH ?
       ORDER BY bm25(discovered_tokens_fts), d.created_at DESC
       LIMIT ?`,
    )
    .bind(ftsQuery, SEARCH_LIMIT)
    .all<LegacyTokenRow>();
  return result.results.map(legacyRowToSearchResult);
}

export async function listRecentIndexedTokens(
  db: D1Database,
  source: "all" | "pumpfun" = "all",
): Promise<SwapTokenSearchResult[]> {
  const sourceClause = source === "pumpfun" ? "WHERE source = 'pumpfun'" : "";
  const result = await db
    .prepare(
      `SELECT mint, symbol, name, decimals, source, created_at, is_verified
       FROM token_search_index
       ${sourceClause}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(RECENT_LIMIT)
    .all<MinimalTokenRow>();
  return result.results.map(minimalRowToSearchResult);
}

export async function listRecentLegacyIndexedTokens(
  db: D1Database,
  source: "all" | "pumpfun" = "all",
): Promise<SwapTokenSearchResult[]> {
  const sourceClause = source === "pumpfun" ? "WHERE source = 'pumpfun'" : "";
  const result = await db
    .prepare(
      `SELECT mint, symbol, name, decimals, logo_url, source, created_at,
              is_verified, organic_score, organic_score_label, price_usd,
              market_cap_usd, liquidity_usd, holders,
              mint_authority_disabled, freeze_authority_disabled,
              top_holders_percent
       FROM discovered_tokens
       ${sourceClause}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(RECENT_LIMIT)
    .all<LegacyTokenRow>();
  return result.results.map(legacyRowToSearchResult);
}

export async function upsertPumpTokens(
  db: D1Database,
  tokens: PumpTokenIngestItem[],
): Promise<number> {
  if (!tokens.length) return 0;
  const now = new Date().toISOString();
  const statement = db.prepare(
    `INSERT INTO token_search_index (
       mint, symbol, name, decimals, source, token_program,
       creation_signature, created_at, first_seen_at, updated_at, is_verified
     ) VALUES (?, ?, ?, ?, 'pumpfun', ?, ?, ?, ?, ?, 0)
     ON CONFLICT(mint) DO UPDATE SET
       symbol = excluded.symbol,
       name = excluded.name,
       decimals = excluded.decimals,
       token_program = excluded.token_program,
       source = 'pumpfun',
       creation_signature = COALESCE(
         excluded.creation_signature,
         token_search_index.creation_signature
       ),
       created_at = MIN(excluded.created_at, token_search_index.created_at),
       updated_at = excluded.updated_at`,
  );
  await db.batch(
    tokens.map((token) =>
      statement.bind(
        token.mint,
        token.symbol,
        token.name,
        token.decimals,
        token.tokenProgram,
        token.creationSignature,
        token.createdAt,
        now,
        now,
      ),
    ),
  );
  return tokens.length;
}

export async function upsertJupiterTokens(
  db: D1Database,
  tokens: SwapTokenSearchResult[],
): Promise<number> {
  if (!tokens.length) return 0;
  const now = new Date().toISOString();
  const statement = db.prepare(
    `INSERT INTO token_search_index (
       mint, symbol, name, decimals, source, created_at, first_seen_at,
       updated_at, is_verified
     ) VALUES (?, ?, ?, ?, 'jupiter', ?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET
       symbol = excluded.symbol,
       name = excluded.name,
       decimals = excluded.decimals,
       created_at = MIN(excluded.created_at, token_search_index.created_at),
       updated_at = excluded.updated_at,
       is_verified = excluded.is_verified`,
  );
  await db.batch(
    tokens.map((token) =>
      statement.bind(
        token.address,
        token.symbol,
        token.name,
        token.decimals,
        token.discoveredAt ?? now,
        now,
        now,
        token.isVerified ? 1 : 0,
      ),
    ),
  );
  return tokens.length;
}

export async function upsertHeliusTokenMetadata(
  db: D1Database,
  metadata: HeliusTokenMetadata,
  now = new Date(),
): Promise<boolean> {
  if (
    metadata.name === null ||
    metadata.symbol === null ||
    metadata.decimals === null ||
    metadata.decimals < 0 ||
    metadata.decimals > 18
  ) {
    return false;
  }
  const timestamp = now.toISOString();
  await db
    .prepare(
      `INSERT INTO token_search_index (
         mint, symbol, name, decimals, source, created_at, first_seen_at,
         updated_at, last_used_at, is_verified
       ) VALUES (?, ?, ?, ?, 'helius', ?, ?, ?, ?, 0)
       ON CONFLICT(mint) DO UPDATE SET
         symbol = excluded.symbol,
         name = excluded.name,
         decimals = excluded.decimals,
         updated_at = excluded.updated_at,
         last_used_at = excluded.last_used_at`,
    )
    .bind(
      metadata.mint,
      metadata.symbol.slice(0, 24),
      metadata.name.slice(0, 120),
      metadata.decimals,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  return true;
}

export async function markIndexedTokensUsed(
  db: D1Database,
  mints: string[],
  now = new Date(),
): Promise<number> {
  const uniqueMints = [...new Set(mints)].slice(0, 2);
  if (!uniqueMints.length) return 0;
  const timestamp = now.toISOString();
  const touchCutoff = new Date(
    now.getTime() - ACCESS_TOUCH_INTERVAL_MS,
  ).toISOString();
  const statement = db.prepare(
    `UPDATE token_search_index
     SET last_used_at = ?
     WHERE mint = ?
       AND (last_used_at IS NULL OR last_used_at < ?)`,
  );
  const results = await db.batch(
    uniqueMints.map((mint) => statement.bind(timestamp, mint, touchCutoff)),
  );
  return results.reduce((count, result) => count + result.meta.changes, 0);
}

export async function pruneTokenIndex(
  db: D1Database,
  now = new Date(),
  limit = DEFAULT_PRUNE_LIMIT,
): Promise<number> {
  const untouchedCutoff = new Date(
    now.getTime() - UNTOUCHED_RETENTION_MS,
  ).toISOString();
  const usedCutoff = new Date(now.getTime() - USED_RETENTION_MS).toISOString();
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 2_000));
  const result = await db
    .prepare(
      `DELETE FROM token_search_index
       WHERE row_id IN (
         SELECT row_id
         FROM token_search_index
         WHERE is_verified = 0
           AND created_at < ?
           AND (last_used_at IS NULL OR last_used_at < ?)
         ORDER BY created_at ASC
         LIMIT ?
       )`,
    )
    .bind(untouchedCutoff, usedCutoff, boundedLimit)
    .run();
  return result.meta.changes;
}

function preferNonNull<T>(preferred: T | null, fallback: T | null): T | null {
  return preferred ?? fallback;
}

function overlayToken(
  existing: SwapTokenSearchResult,
  preferred: SwapTokenSearchResult,
  preserveSource: boolean,
): SwapTokenSearchResult {
  return {
    ...existing,
    ...preferred,
    isVerified: preserveSource
      ? preferred.isVerified
      : existing.isVerified || preferred.isVerified,
    logoUrl: preferNonNull(preferred.logoUrl, existing.logoUrl),
    organicScore: preferNonNull(preferred.organicScore, existing.organicScore),
    organicScoreLabel: preferNonNull(
      preferred.organicScoreLabel,
      existing.organicScoreLabel,
    ),
    priceUsd: preferNonNull(preferred.priceUsd, existing.priceUsd),
    marketCapUsd: preferNonNull(preferred.marketCapUsd, existing.marketCapUsd),
    liquidityUsd: preferNonNull(preferred.liquidityUsd, existing.liquidityUsd),
    holders: preferNonNull(preferred.holders, existing.holders),
    mintAuthorityDisabled: preferNonNull(
      preferred.mintAuthorityDisabled,
      existing.mintAuthorityDisabled,
    ),
    freezeAuthorityDisabled: preferNonNull(
      preferred.freezeAuthorityDisabled,
      existing.freezeAuthorityDisabled,
    ),
    topHoldersPercent: preferNonNull(
      preferred.topHoldersPercent,
      existing.topHoldersPercent,
    ),
    source:
      preserveSource || existing.source === "pumpfun"
        ? existing.source
        : preferred.source,
    discoveredAt: preferNonNull(existing.discoveredAt, preferred.discoveredAt),
  };
}

export function mergeTokenResults(
  jupiter: SwapTokenSearchResult[],
  indexed: SwapTokenSearchResult[],
  limit = SEARCH_LIMIT,
): SwapTokenSearchResult[] {
  const merged = new Map<string, SwapTokenSearchResult>();
  for (const token of indexed) {
    const existing = merged.get(token.address);
    merged.set(
      token.address,
      existing ? overlayToken(existing, token, false) : token,
    );
  }
  for (const token of jupiter) {
    const existing = merged.get(token.address);
    merged.set(
      token.address,
      existing ? overlayToken(existing, token, true) : token,
    );
  }
  return [...merged.values()].slice(0, limit);
}
