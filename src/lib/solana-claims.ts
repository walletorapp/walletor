import {
  UsdcClaimBuildResponseSchema,
  UsdcClaimConfirmResponseSchema,
  UsdcClaimStateResponseSchema,
  type UsdcClaimBuildResult,
  type UsdcClaimConfirmResult,
  type UsdcClaimState,
} from "../../shared/usdc-claim-contracts";
import { ApiErrorSchema } from "../../shared/contracts";
import { ApiClientError } from "./api";

async function parseResponse(response: Response): Promise<unknown> {
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(raw);
    if (parsed.success) throw new ApiClientError(parsed.data, response.status);
    throw new Error("Walletor received an unreadable claim response.");
  }
  return raw;
}

export async function fetchSolanaClaimState(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<UsdcClaimState> {
  const response = await fetch(
    `/api/wallets/${encodeURIComponent(walletAddress)}/solana-claims`,
    { cache: "no-store", headers: { accept: "application/json" }, signal },
  );
  const parsed = UsdcClaimStateResponseSchema.safeParse(
    await parseResponse(response),
  );
  if (!parsed.success) {
    throw new Error("Walletor returned an invalid Solana claim state.");
  }
  return parsed.data.data;
}

export async function buildSolanaClaim(input: {
  walletAddress: string;
  entitlementId: string;
}): Promise<UsdcClaimBuildResult> {
  const response = await fetch("/api/solana-claims/build", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = UsdcClaimBuildResponseSchema.safeParse(
    await parseResponse(response),
  );
  if (!parsed.success) {
    throw new Error("Walletor returned an invalid claim transaction.");
  }
  return parsed.data.data;
}

export async function submitSolanaClaim(input: {
  walletAddress: string;
  entitlementId: string;
  transactionSignature: string;
}): Promise<UsdcClaimConfirmResult> {
  const response = await fetch("/api/solana-claims/submit", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = UsdcClaimConfirmResponseSchema.safeParse(
    await parseResponse(response),
  );
  if (!parsed.success) {
    throw new Error("Walletor returned an invalid claim confirmation.");
  }
  return parsed.data.data;
}
