import { z } from "zod";

import type {
  SwapTokenSearchResult,
  TokenDetail,
  TokenPrice,
  TokenSummary,
} from "../../shared/contracts";
import {
  SwapTokenSearchResultSchema,
  TokenDetailSchema,
  TokenPriceSchema,
  TokenSummarySchema,
} from "../../shared/contracts";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";

const JUPITER_BASE_URL = "https://api.jup.ag";
const MAX_RESPONSE_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 6_000;
const unknownArray = z.array(z.unknown());
const rawObject = z.record(z.string(), z.unknown());

type Fetcher = typeof fetch;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalUrl(value: unknown): string | null {
  const candidate = optionalString(value);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nonnegativeInteger(...values: unknown[]): number | null {
  const parsed = finiteNumber(...values);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function organicScoreLabel(value: unknown): "high" | "medium" | "low" | null {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : null;
}

function numericString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function isoTimestamp(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "number" && typeof value !== "string") continue;
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
      : new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = rawObject.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function sumNullable(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function normalizeSummary(
  raw: Record<string, unknown>,
  fallbackRank: number | null,
): TokenSummary | null {
  const address = optionalString(raw.id);
  if (!address || !isSolanaAddress(address)) return null;

  const symbol = optionalString(raw.symbol) ?? "UNKNOWN";
  const stats1h = asRecord(raw.stats1h);
  const stats24h = asRecord(raw.stats24h);
  const firstPool = asRecord(raw.firstPool);
  const buyVolume = finiteNumber(stats24h.buyVolume);
  const sellVolume = finiteNumber(stats24h.sellVolume);

  return TokenSummarySchema.parse({
    address,
    symbol: symbol.slice(0, 24),
    name: (optionalString(raw.name) ?? symbol).slice(0, 120),
    logoUrl: optionalUrl(raw.icon),
    rank: fallbackRank,
    priceUsd: finiteNumber(raw.usdPrice),
    marketCapUsd: finiteNumber(raw.mcap, raw.fdv),
    liquidityUsd: finiteNumber(raw.liquidity),
    volume24hUsd: sumNullable(buyVolume, sellVolume),
    priceChange1hPercent: finiteNumber(stats1h.priceChange),
    priceChange24hPercent: finiteNumber(stats24h.priceChange),
    holders: nonnegativeInteger(raw.holderCount),
    listedAt: isoTimestamp(firstPool.createdAt, raw.createdAt),
  });
}

function normalizeSearchToken(
  raw: Record<string, unknown>,
): SwapTokenSearchResult | null {
  const address = optionalString(raw.id);
  const symbol = optionalString(raw.symbol);
  const name = optionalString(raw.name);
  const decimals = nonnegativeInteger(raw.decimals);
  if (
    !address ||
    !isSolanaAddress(address) ||
    !symbol ||
    !name ||
    decimals === null ||
    decimals > 18
  ) {
    return null;
  }
  const token = SwapTokenSearchResultSchema.safeParse({
    address,
    symbol: symbol.slice(0, 24),
    name: name.slice(0, 120),
    logoUrl: optionalUrl(raw.icon),
    decimals,
    isVerified:
      raw.isVerified === true ||
      (Array.isArray(raw.tags) && raw.tags.includes("verified")),
    organicScore: finiteNumber(raw.organicScore),
    organicScoreLabel: organicScoreLabel(raw.organicScoreLabel),
    priceUsd: finiteNumber(raw.usdPrice),
    marketCapUsd: finiteNumber(raw.mcap, raw.fdv),
    liquidityUsd: finiteNumber(raw.liquidity),
    holders: nonnegativeInteger(raw.holderCount),
    mintAuthorityDisabled: optionalBoolean(
      asRecord(raw.audit).mintAuthorityDisabled,
    ),
    freezeAuthorityDisabled: optionalBoolean(
      asRecord(raw.audit).freezeAuthorityDisabled,
    ),
    topHoldersPercent: finiteNumber(asRecord(raw.audit).topHoldersPercentage),
    source: "jupiter",
    discoveredAt: isoTimestamp(
      asRecord(raw.firstPool).createdAt,
      raw.createdAt,
    ),
  });
  return token.success ? token.data : null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new ApiFailure(
      502,
      "UPSTREAM_RESPONSE_TOO_LARGE",
      "Market data response was unexpectedly large.",
      true,
    );
  }

  try {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new ApiFailure(
        502,
        "UPSTREAM_RESPONSE_TOO_LARGE",
        "Market data response was unexpectedly large.",
        true,
      );
    }
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(
      502,
      "UPSTREAM_INVALID_JSON",
      "Market data returned an invalid response.",
      true,
    );
  }
}

async function jupiterFetch(
  path: string,
  apiKey: string,
  fetcher: Fetcher,
): Promise<unknown> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(`${JUPITER_BASE_URL}${path}`, {
        headers: { accept: "application/json", "x-api-key": apiKey },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      lastStatus = response.status;

      if (response.ok) return await readBoundedJson(response);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      if (attempt === 1) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure(
          504,
          "UPSTREAM_TIMEOUT",
          "Market data did not respond in time.",
          true,
        );
      }
    }
  }

  if (lastStatus === 429) {
    throw new ApiFailure(
      429,
      "UPSTREAM_RATE_LIMITED",
      "Market data is temporarily rate limited.",
      true,
      30,
    );
  }
  if (lastStatus === 401 || lastStatus === 403) {
    throw new ApiFailure(
      503,
      "MARKET_DATA_AUTH_FAILED",
      "Market data credentials were rejected.",
      false,
    );
  }
  throw new ApiFailure(
    502,
    "UPSTREAM_UNAVAILABLE",
    "Market data is temporarily unavailable.",
    true,
  );
}

function requireKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new ApiFailure(
      503,
      "MARKET_DATA_NOT_CONFIGURED",
      "Market data is not configured for this environment.",
      false,
    );
  }
  return apiKey;
}

function parseTokenArray(json: unknown): unknown[] {
  const parsed = unknownArray.safeParse(json);
  if (!parsed.success) {
    throw new ApiFailure(
      502,
      "UPSTREAM_SCHEMA_MISMATCH",
      "Market data returned an unexpected token shape.",
      true,
    );
  }
  return parsed.data;
}

export async function getTrending(
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<TokenSummary[]> {
  const json = await jupiterFetch(
    "/tokens/v2/toptrending/24h?limit=50",
    requireKey(apiKey),
    fetcher,
  );
  return parseTokenArray(json).flatMap((value, index) => {
    const parsed = rawObject.safeParse(value);
    if (!parsed.success) return [];
    const token = normalizeSummary(parsed.data, index + 1);
    return token ? [token] : [];
  });
}

export async function getNewTokens(
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<TokenSummary[]> {
  const json = await jupiterFetch(
    "/tokens/v2/recent",
    requireKey(apiKey),
    fetcher,
  );
  return parseTokenArray(json).flatMap((value) => {
    const parsed = rawObject.safeParse(value);
    if (!parsed.success) return [];
    const token = normalizeSummary(parsed.data, null);
    return token ? [token] : [];
  });
}

export async function getRecentSwapTokens(
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SwapTokenSearchResult[]> {
  const json = await jupiterFetch(
    "/tokens/v2/recent",
    requireKey(apiKey),
    fetcher,
  );
  return parseTokenArray(json).flatMap((value) => {
    const parsed = rawObject.safeParse(value);
    if (!parsed.success) return [];
    const token = normalizeSearchToken(parsed.data);
    return token ? [token] : [];
  });
}

export async function searchTokens(
  query: string,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SwapTokenSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 80) {
    throw new ApiFailure(
      400,
      "INVALID_TOKEN_SEARCH",
      "Enter a token name, symbol, or mint address.",
      false,
    );
  }

  const json = await jupiterFetch(
    `/tokens/v2/search?query=${encodeURIComponent(normalizedQuery)}`,
    requireKey(apiKey),
    fetcher,
  );
  return parseTokenArray(json)
    .slice(0, 20)
    .flatMap((value) => {
      const parsed = rawObject.safeParse(value);
      if (!parsed.success) return [];
      const token = normalizeSearchToken(parsed.data);
      return token ? [token] : [];
    });
}

export async function getTokenPrices(
  addresses: string[],
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<TokenPrice[]> {
  const uniqueAddresses = [...new Set(addresses)];
  if (
    uniqueAddresses.length === 0 ||
    uniqueAddresses.length > 50 ||
    uniqueAddresses.some((address) => !isSolanaAddress(address))
  ) {
    throw new ApiFailure(
      400,
      "INVALID_PRICE_MINTS",
      "Provide between 1 and 50 valid Solana mint addresses.",
      false,
    );
  }

  const json = await jupiterFetch(
    `/price/v3?ids=${encodeURIComponent(uniqueAddresses.join(","))}`,
    requireKey(apiKey),
    fetcher,
  );
  const prices = rawObject.safeParse(json);
  if (!prices.success) {
    throw new ApiFailure(
      502,
      "UPSTREAM_SCHEMA_MISMATCH",
      "Jupiter returned an unexpected price shape.",
      true,
    );
  }

  return uniqueAddresses.flatMap((address) => {
    const raw = rawObject.safeParse(prices.data[address]);
    if (!raw.success) return [];
    const price = TokenPriceSchema.safeParse({
      address,
      priceUsd: finiteNumber(raw.data.usdPrice),
      liquidityUsd: finiteNumber(raw.data.liquidity),
      priceChange24hPercent: finiteNumber(raw.data.priceChange24h),
      blockId: nonnegativeInteger(raw.data.blockId),
      decimals: nonnegativeInteger(raw.data.decimals),
    });
    return price.success ? [price.data] : [];
  });
}

export async function getTokenDetail(
  address: string,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<TokenDetail> {
  const json = await jupiterFetch(
    `/tokens/v2/search?query=${encodeURIComponent(address)}`,
    requireKey(apiKey),
    fetcher,
  );
  const values = parseTokenArray(json);
  const raw = values
    .map((value) => rawObject.safeParse(value))
    .find((result) => result.success && result.data.id === address);
  if (!raw?.success) {
    throw new ApiFailure(
      404,
      "TOKEN_NOT_FOUND",
      "No market data was found for this token.",
      false,
    );
  }

  const summary = normalizeSummary(raw.data, null);
  if (!summary) {
    throw new ApiFailure(
      502,
      "UPSTREAM_SCHEMA_MISMATCH",
      "Market data returned an unexpected token shape.",
      true,
    );
  }

  const stats24h = asRecord(raw.data.stats24h);
  const totalSupply = numericString(raw.data.totalSupply);
  const buys24h = nonnegativeInteger(stats24h.numBuys);
  const sells24h = nonnegativeInteger(stats24h.numSells);

  return TokenDetailSchema.parse({
    ...summary,
    decimals: nonnegativeInteger(raw.data.decimals),
    supply: totalSupply,
    trades24h: sumNullable(buys24h, sells24h),
    buys24h,
    sells24h,
    uniqueWallets24h: nonnegativeInteger(stats24h.numTraders),
  });
}
