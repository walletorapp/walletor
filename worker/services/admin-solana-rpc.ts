import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress, isSolanaSignature } from "../lib/solana";

const RPC_TIMEOUT_MS = 12_000;
const MAX_RPC_RESPONSE_BYTES = 1_000_000;
const MAX_SERIALIZED_TRANSACTION_LENGTH = 5_000;

const allowedMethods = new Set([
  "getAccountInfo",
  "getBlockHeight",
  "getFeeForMessage",
  "getGenesisHash",
  "getLatestBlockhash",
  "getMultipleAccounts",
  "getSignatureStatuses",
  "getSlot",
  "sendTransaction",
  "simulateTransaction",
]);

interface AdminSolanaRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: unknown[];
}

type Fetcher = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(): ApiFailure {
  return new ApiFailure(
    400,
    "INVALID_ADMIN_SOLANA_RPC_REQUEST",
    "The admin Solana request is invalid.",
    false,
  );
}

function assertAddress(value: unknown): void {
  if (typeof value !== "string" || !isSolanaAddress(value)) {
    throw invalidRequest();
  }
}

function assertTransaction(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SERIALIZED_TRANSACTION_LENGTH ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw invalidRequest();
  }
}

function validateMethodParams(method: string, params: unknown[]): void {
  if (params.length > 3) throw invalidRequest();

  if (method === "getAccountInfo") {
    assertAddress(params[0]);
    return;
  }
  if (method === "getMultipleAccounts") {
    const addresses = params[0];
    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.length > 100
    ) {
      throw invalidRequest();
    }
    for (const address of addresses) assertAddress(address);
    return;
  }
  if (method === "getSignatureStatuses") {
    const signatures = params[0];
    if (
      !Array.isArray(signatures) ||
      signatures.length === 0 ||
      signatures.length > 64 ||
      signatures.some(
        (signature) =>
          typeof signature !== "string" || !isSolanaSignature(signature),
      )
    ) {
      throw invalidRequest();
    }
    return;
  }
  if (method === "sendTransaction" || method === "simulateTransaction") {
    assertTransaction(params[0]);
  }
}

function parseRequest(raw: unknown): AdminSolanaRpcRequest {
  if (
    !isRecord(raw) ||
    raw.jsonrpc !== "2.0" ||
    (typeof raw.id !== "string" && typeof raw.id !== "number") ||
    typeof raw.method !== "string" ||
    !allowedMethods.has(raw.method) ||
    !Array.isArray(raw.params)
  ) {
    throw invalidRequest();
  }
  validateMethodParams(raw.method, raw.params);
  return {
    jsonrpc: "2.0",
    id: raw.id,
    method: raw.method,
    params: raw.params,
  };
}

export async function relayAdminSolanaRpc(
  env: Partial<Env>,
  raw: unknown,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  const request = parseRequest(raw);
  const rpcUrl = readUsdcClaimConfig(env).rpcUrl;
  let response: Response;
  try {
    response = await fetcher(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    throw new ApiFailure(
      504,
      "ADMIN_SOLANA_RPC_TIMEOUT",
      "Solana did not respond in time. Try the operation again.",
      true,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RPC_RESPONSE_BYTES
  ) {
    throw new ApiFailure(
      502,
      "ADMIN_SOLANA_RPC_RESPONSE_TOO_LARGE",
      "Solana returned an unexpectedly large response.",
      true,
    );
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RPC_RESPONSE_BYTES) {
    throw new ApiFailure(
      502,
      "ADMIN_SOLANA_RPC_RESPONSE_TOO_LARGE",
      "Solana returned an unexpectedly large response.",
      true,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new ApiFailure(
      502,
      "ADMIN_SOLANA_RPC_INVALID_RESPONSE",
      "Solana returned an unreadable response.",
      true,
    );
  }
  if (!response.ok || !isRecord(parsed)) {
    throw new ApiFailure(
      502,
      "ADMIN_SOLANA_RPC_REJECTED",
      "Solana could not process the admin request.",
      true,
    );
  }
  return parsed;
}
