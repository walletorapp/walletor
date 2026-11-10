import { z } from "zod";

import {
  SwapExecuteDataSchema,
  SwapExecuteRequestSchema,
  SwapOrderDataSchema,
  type SwapExecuteResult,
  type SwapOrder,
} from "../../shared/swap-contracts";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";
import type { JupiterReferralConfig } from "./jupiter-referral";

const JUPITER_SWAP_URL = "https://api.jup.ag/swap/v2";
const MAX_RESPONSE_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const rawObject = z.record(z.string(), z.unknown());
const unknownArray = z.array(z.unknown());

type Fetcher = typeof fetch;

interface SwapOrderParams {
  market?: "crypto" | "rwa";
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  referral?: JupiterReferralConfig;
}

export interface SwapOrderResolution {
  order: SwapOrder;
  usedSubMinimumFallback: boolean;
  unavailableReferralFeeMint: string | null;
}

export class ReferralFeeUnavailableFailure extends ApiFailure {
  constructor(readonly feeMint: string | null) {
    super(
      409,
      "JUPITER_REFERRAL_FEE_UNAVAILABLE",
      "This token pair is waiting for Prize Pool fee activation. Try again shortly.",
      false,
    );
  }
}

function requireKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new ApiFailure(
      503,
      "SWAP_NOT_CONFIGURED",
      "Jupiter swaps are not configured for this environment.",
      false,
    );
  }
  return apiKey;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nullableNumericString(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}

function nullableDecimalString(value: unknown): string | null {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }
  return null;
}

function normalizePlatformFee(value: unknown) {
  const fee = rawObject.safeParse(value);
  if (!fee.success) return null;
  return {
    amount: nullableNumericString(fee.data.amount),
    feeBps: nullableInteger(fee.data.feeBps),
    feeMint: nullableString(fee.data.feeMint),
  };
}

function normalizeRoutePlan(value: unknown) {
  const route = unknownArray.safeParse(value);
  if (!route.success) return [];
  return route.data.flatMap((leg) => {
    const routeLeg = rawObject.safeParse(leg);
    if (!routeLeg.success) return [];
    const swapInfo = rawObject.safeParse(routeLeg.data.swapInfo);
    if (!swapInfo.success) return [];
    const label = nullableString(swapInfo.data.label);
    const inputMint = nullableString(swapInfo.data.inputMint);
    const outputMint = nullableString(swapInfo.data.outputMint);
    const inAmount = nullableNumericString(swapInfo.data.inAmount);
    const outAmount = nullableNumericString(swapInfo.data.outAmount);
    if (!label || !inputMint || !outputMint || !inAmount || !outAmount) {
      return [];
    }
    return [
      {
        label,
        inputMint,
        outputMint,
        inAmount,
        outAmount,
        percent: nullableNumber(routeLeg.data.percent),
        bps: nullableInteger(routeLeg.data.bps),
      },
    ];
  });
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new ApiFailure(
      502,
      "UPSTREAM_RESPONSE_TOO_LARGE",
      "Jupiter returned an unexpectedly large response.",
      true,
    );
  }

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new ApiFailure(
      502,
      "UPSTREAM_RESPONSE_TOO_LARGE",
      "Jupiter returned an unexpectedly large response.",
      true,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiFailure(
      502,
      "UPSTREAM_INVALID_JSON",
      "Jupiter returned an invalid response.",
      true,
    );
  }
}

async function jupiterRequest(
  path: string,
  apiKey: string | undefined,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<unknown> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-api-key", requireKey(apiKey));
    response = await fetcher(`${JUPITER_SWAP_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiFailure(
      504,
      "JUPITER_TIMEOUT",
      "Jupiter did not respond in time.",
      true,
    );
  }

  const json = await boundedJson(response);
  if (response.ok) return json;
  if (response.status === 401 || response.status === 403) {
    throw new ApiFailure(
      503,
      "JUPITER_AUTH_FAILED",
      "Jupiter credentials were rejected.",
      false,
    );
  }
  if (response.status === 429) {
    throw new ApiFailure(
      429,
      "JUPITER_RATE_LIMITED",
      "Jupiter is temporarily rate limited.",
      true,
      30,
    );
  }
  throw new ApiFailure(
    response.status >= 500 ? 502 : 400,
    "JUPITER_SWAP_REJECTED",
    "Jupiter could not prepare this swap.",
    response.status >= 500,
  );
}

async function requestOrder(
  query: URLSearchParams,
  apiKey: string | undefined,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  const json = await jupiterRequest(
    `/order?${query.toString()}`,
    apiKey,
    { method: "GET" },
    fetcher,
  );
  const raw = rawObject.safeParse(json);
  if (!raw.success) {
    throw new ApiFailure(
      502,
      "JUPITER_SCHEMA_MISMATCH",
      "Jupiter returned an unexpected order.",
      true,
    );
  }
  return raw.data;
}

export async function getSwapOrder(
  params: SwapOrderParams,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SwapOrder> {
  if (
    !isSolanaAddress(params.inputMint) ||
    !isSolanaAddress(params.outputMint) ||
    params.inputMint === params.outputMint
  ) {
    throw new ApiFailure(
      400,
      "INVALID_SWAP_PAIR",
      "Choose two different valid Solana tokens.",
      false,
    );
  }
  if (!/^\d+$/.test(params.amount) || params.amount === "0") {
    throw new ApiFailure(
      400,
      "INVALID_SWAP_AMOUNT",
      "Enter a valid positive swap amount.",
      false,
    );
  }
  if (params.taker && !isSolanaAddress(params.taker)) {
    throw new ApiFailure(
      400,
      "INVALID_TAKER",
      "Connect a valid Solana wallet.",
      false,
    );
  }

  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
  });
  if (params.taker) query.set("taker", params.taker);
  if (params.referral) {
    query.set("referralAccount", params.referral.account);
    query.set("referralFee", String(params.referral.feeBps));
  }

  let raw = await requestOrder(query, apiKey, fetcher);

  const transaction = nullableString(raw.transaction);
  const router = nullableString(raw.router);
  const errorCode = nullableInteger(raw.errorCode);
  const shouldTryAnotherRouter =
    Boolean(params.taker) &&
    transaction === null &&
    router === "jupiterz" &&
    (errorCode === 3 || errorCode === null);

  if (shouldTryAnotherRouter) {
    const fallbackQuery = new URLSearchParams(query);
    fallbackQuery.set("excludeRouters", "jupiterz");
    raw = await requestOrder(fallbackQuery, apiKey, fetcher);
  }

  const order = SwapOrderDataSchema.safeParse({
    market: params.market ?? "crypto",
    requestId: raw.requestId,
    transaction: nullableString(raw.transaction),
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    inAmount: raw.inAmount,
    outAmount: raw.outAmount,
    otherAmountThreshold: nullableString(raw.otherAmountThreshold),
    priceImpact: nullableNumber(raw.priceImpact),
    priceImpactPct:
      nullableNumber(raw.priceImpact) === null
        ? nullableString(raw.priceImpactPct)
        : String(nullableNumber(raw.priceImpact)),
    inUsdValue: nullableNumber(raw.inUsdValue),
    outUsdValue: nullableNumber(raw.outUsdValue),
    inUsdValueDecimal: nullableDecimalString(raw.inUsdValue),
    outUsdValueDecimal: nullableDecimalString(raw.outUsdValue),
    router: nullableString(raw.router),
    mode: nullableString(raw.mode),
    referralAccount: nullableString(raw.referralAccount),
    walletorPartnerShareBps: params.referral?.partnerShareBps ?? null,
    feeBps: nullableNumber(raw.feeBps),
    feeMint: nullableString(raw.feeMint),
    platformFee: normalizePlatformFee(raw.platformFee),
    routePlan: normalizeRoutePlan(raw.routePlan),
    gasless: nullableBoolean(raw.gasless),
    signatureFeePayer: nullableString(raw.signatureFeePayer),
    prioritizationFeePayer: nullableString(raw.prioritizationFeePayer),
    rentFeePayer: nullableString(raw.rentFeePayer),
    signatureFeeLamports: nullableNumericString(raw.signatureFeeLamports),
    prioritizationFeeLamports: nullableNumericString(
      raw.prioritizationFeeLamports,
    ),
    rentFeeLamports: nullableNumericString(raw.rentFeeLamports),
    slippageBps: nullableInteger(raw.slippageBps),
    totalTimeMs: nullableNumber(raw.totalTime),
    errorCode: nullableInteger(raw.errorCode),
    errorMessage: nullableString(raw.errorMessage),
    lastValidBlockHeight: nullableNumericString(raw.lastValidBlockHeight),
    quoteId: nullableString(raw.quoteId),
    maker: nullableString(raw.maker),
    expireAt: nullableString(raw.expireAt),
  });
  if (!order.success) {
    throw new ApiFailure(
      502,
      "JUPITER_SCHEMA_MISMATCH",
      "Jupiter returned an unexpected order.",
      true,
    );
  }

  if (params.referral) {
    const referralWasApplied =
      order.data.referralAccount === params.referral.account &&
      order.data.platformFee?.feeBps === params.referral.feeBps &&
      order.data.feeBps !== null &&
      order.data.feeBps >= params.referral.feeBps &&
      order.data.feeMint !== null &&
      isSolanaAddress(order.data.feeMint) &&
      order.data.platformFee.feeMint === order.data.feeMint;

    if (!referralWasApplied) {
      throw new ReferralFeeUnavailableFailure(
        order.data.feeMint !== null && isSolanaAddress(order.data.feeMint)
          ? order.data.feeMint
          : null,
      );
    }
  }

  return order.data;
}

function isBelowMinimumUsd(
  usdDecimal: string | null,
  minimumUsdCents: bigint,
): boolean {
  if (usdDecimal === null) return false;
  const [whole = "0", fraction = ""] = usdDecimal.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  return numerator * 100n < minimumUsdCents * denominator;
}

function supportsSubMinimumFallback(error: unknown): boolean {
  return (
    error instanceof ReferralFeeUnavailableFailure ||
    (error instanceof ApiFailure && error.code === "JUPITER_SWAP_REJECTED")
  );
}

/**
 * Keep Walletor's verified referral route authoritative for reward-eligible
 * swaps. For a sub-minimum trade only, allow Jupiter's standard route when
 * adding referral parameters prevents it from assembling a transaction.
 */
export async function getSwapOrderWithSubMinimumFallback(
  params: SwapOrderParams,
  minimumRewardUsdCents: bigint,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SwapOrderResolution> {
  try {
    return {
      order: await getSwapOrder(params, apiKey, fetcher),
      usedSubMinimumFallback: false,
      unavailableReferralFeeMint: null,
    };
  } catch (error) {
    if (
      !params.taker ||
      !params.referral ||
      !supportsSubMinimumFallback(error)
    ) {
      throw error;
    }

    let fallback: SwapOrder;
    try {
      fallback = await getSwapOrder(
        { ...params, referral: undefined },
        apiKey,
        fetcher,
      );
    } catch {
      throw error;
    }
    if (
      fallback.transaction === null ||
      !isBelowMinimumUsd(fallback.inUsdValueDecimal, minimumRewardUsdCents)
    ) {
      throw error;
    }
    return {
      order: fallback,
      usedSubMinimumFallback: true,
      unavailableReferralFeeMint:
        error instanceof ReferralFeeUnavailableFailure ? error.feeMint : null,
    };
  }
}

export async function executeSwap(
  input: unknown,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SwapExecuteResult> {
  const request = SwapExecuteRequestSchema.safeParse(input);
  if (!request.success) {
    throw new ApiFailure(
      400,
      "INVALID_SIGNED_TRANSACTION",
      "The signed Jupiter transaction is invalid.",
      false,
    );
  }
  const json = await jupiterRequest(
    "/execute",
    apiKey,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signedTransaction: request.data.signedTransaction,
        requestId: request.data.requestId,
        ...(request.data.lastValidBlockHeight
          ? { lastValidBlockHeight: request.data.lastValidBlockHeight }
          : {}),
      }),
    },
    fetcher,
  );
  const raw = rawObject.safeParse(json);
  if (!raw.success) {
    throw new ApiFailure(
      502,
      "JUPITER_SCHEMA_MISMATCH",
      "Jupiter returned an unexpected execution result.",
      true,
    );
  }
  const result = SwapExecuteDataSchema.safeParse({
    status: raw.data.status,
    signature: nullableString(raw.data.signature),
    code: raw.data.code,
    error: nullableString(raw.data.error),
    inputAmountResult: nullableString(raw.data.inputAmountResult),
    outputAmountResult: nullableString(raw.data.outputAmountResult),
    totalInputAmount: nullableString(raw.data.totalInputAmount),
    totalOutputAmount: nullableString(raw.data.totalOutputAmount),
    walletorAccounting: null,
  });
  if (!result.success) {
    throw new ApiFailure(
      502,
      "JUPITER_SCHEMA_MISMATCH",
      "Jupiter returned an unexpected execution result.",
      true,
    );
  }
  return result.data;
}
