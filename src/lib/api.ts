import type { z } from "zod";
import {
  TokenChartMarketResponseSchema,
  type TokenChartMarket,
} from "../../shared/token-market-contracts";
import {
  LaunchBoardResponseSchema,
  type LaunchBoard,
} from "../../shared/launch-contracts";

import {
  ApiErrorSchema,
  SwapTokenSearchResponseSchema,
  TokenDetailResponseSchema,
  TokenPriceResponseSchema,
  WalletBalanceResponseSchema,
  WalletHoldingsResponseSchema,
  type ApiError as ApiErrorPayload,
  type SwapTokenSearchResult,
  type TokenDetail,
  type TokenPrice,
  type WalletBalance,
  type WalletHoldings,
} from "../../shared/contracts";
import {
  ClaimRewardsStateResponseSchema,
  PrizePoolStateResponseSchema,
  PublicDistributionCalendarResponseSchema,
  PublicDistributionRoundDetailResponseSchema,
  WalletEngineStateResponseSchema,
  type ClaimRewardsState,
  type PrizePoolState,
  type PublicDistributionCalendar,
  type PublicDistributionRoundDetail,
  type WalletEngineState,
} from "../../shared/accounting-contracts";
import {
  RwaAssetListResponseSchema,
  type RwaAssetList,
} from "../../shared/rwa-contracts";

export class ApiClientError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  readonly requestId: string | null;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.error.message);
    this.name = "ApiClientError";
    this.code = payload.error.code;
    this.retryable = payload.error.retryable;
    this.requestId = payload.meta.requestId;
    Object.defineProperty(this, "status", { value: status });
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    signal,
  });
  const raw: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(raw);
    if (parsed.success) throw new ApiClientError(parsed.data, response.status);
    throw new Error("Walletor received an unreadable API error.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error("Walletor received market data in an unexpected format.");
  return parsed.data;
}

export async function fetchToken(
  address: string,
  signal?: AbortSignal,
): Promise<TokenDetail> {
  return (
    await request(
      `/api/tokens/${encodeURIComponent(address)}`,
      TokenDetailResponseSchema,
      signal,
    )
  ).data;
}

export async function searchSwapTokens(
  query: string,
  signal?: AbortSignal,
): Promise<SwapTokenSearchResult[]> {
  return (
    await request(
      `/api/tokens/search?q=${encodeURIComponent(query)}`,
      SwapTokenSearchResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchDiscoveryTokens(
  source: "all" | "pumpfun" = "all",
  signal?: AbortSignal,
): Promise<SwapTokenSearchResult[]> {
  return (
    await request(
      `/api/tokens/discovery?source=${source}`,
      SwapTokenSearchResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchLaunchBoard(
  signal?: AbortSignal,
): Promise<LaunchBoard> {
  return (
    await request("/api/tokens/launches", LaunchBoardResponseSchema, signal)
  ).data;
}

export async function fetchTokenChartMarket(
  address: string,
  signal?: AbortSignal,
): Promise<TokenChartMarket> {
  return (
    await request(
      `/api/tokens/${encodeURIComponent(address)}/chart-market`,
      TokenChartMarketResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchTokenPrices(
  addresses: string[],
  signal?: AbortSignal,
): Promise<TokenPrice[]> {
  const params = new URLSearchParams({ ids: addresses.join(",") });
  return (
    await request(
      `/api/prices?${params.toString()}`,
      TokenPriceResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchWalletBalance(
  owner: string,
  inputMint: string,
  signal?: AbortSignal,
): Promise<WalletBalance> {
  const params = new URLSearchParams({ owner, inputMint });
  return (
    await request(
      `/api/wallet/balance?${params.toString()}`,
      WalletBalanceResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchWalletHoldings(
  owner: string,
  signal?: AbortSignal,
): Promise<WalletHoldings> {
  const params = new URLSearchParams({ owner });
  return (
    await request(
      `/api/wallet/holdings?${params.toString()}`,
      WalletHoldingsResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchRwaAssets(
  signal?: AbortSignal,
): Promise<RwaAssetList> {
  return (await request("/api/rwa/assets", RwaAssetListResponseSchema, signal))
    .data;
}

export async function fetchPrizePoolState(
  signal?: AbortSignal,
): Promise<PrizePoolState> {
  return (
    await request("/api/prize-pool", PrizePoolStateResponseSchema, signal)
  ).data;
}

export async function fetchPublicDistributionRound(
  roundId: string,
  offset = 0,
  limit = 50,
  signal?: AbortSignal,
): Promise<PublicDistributionRoundDetail> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  return (
    await request(
      `/api/prize-pool/distributions/${encodeURIComponent(roundId)}?${params.toString()}`,
      PublicDistributionRoundDetailResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchPublicDistributionCalendar(
  month: string | null,
  signal?: AbortSignal,
): Promise<PublicDistributionCalendar> {
  const params = new URLSearchParams();
  if (month !== null) params.set("month", month);
  const suffix = params.size ? `?${params.toString()}` : "";
  return (
    await request(
      `/api/prize-pool/distributions${suffix}`,
      PublicDistributionCalendarResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchWalletEngineState(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<WalletEngineState> {
  return (
    await request(
      `/api/wallets/${encodeURIComponent(walletAddress)}/engine`,
      WalletEngineStateResponseSchema,
      signal,
    )
  ).data;
}

export async function fetchClaimRewardsState(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<ClaimRewardsState> {
  return (
    await request(
      `/api/wallets/${encodeURIComponent(walletAddress)}/claims`,
      ClaimRewardsStateResponseSchema,
      signal,
    )
  ).data;
}
