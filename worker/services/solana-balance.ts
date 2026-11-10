import { z } from "zod";

import type { WalletBalance } from "../../shared/contracts";
import { WalletBalanceSchema } from "../../shared/contracts";
import { ApiFailure } from "../lib/http";

const PUBLIC_SOLANA_RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
] as const;
const HELIUS_MAINNET_RPC_URL = "https://mainnet.helius-rpc.com/";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const RPC_TIMEOUT_MS = 5_000;

const rpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
});

const solBalanceResultSchema = z.object({
  value: z.number().int().nonnegative(),
});

const tokenAccountsResultSchema = z.object({
  value: z.array(
    z.object({
      account: z.object({
        data: z.tuple([z.string().min(1), z.literal("base64")]),
      }),
    }),
  ),
});

type Fetcher = typeof fetch;

interface WalletBalanceOptions {
  fetcher?: Fetcher;
  heliusApiKey?: string;
}

function rpcUrls(heliusApiKey: string | undefined): string[] {
  const normalizedKey = heliusApiKey?.trim();
  return normalizedKey
    ? [
        `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(normalizedKey)}`,
        ...PUBLIC_SOLANA_RPC_URLS,
      ]
    : [...PUBLIC_SOLANA_RPC_URLS];
}

function amountFromBase64DataSlice(encoded: string): bigint {
  const binary = atob(encoded);
  if (binary.length !== 8) {
    throw new Error("Token amount data slice must be eight bytes.");
  }
  let amount = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    amount = (amount << 8n) + BigInt(binary.charCodeAt(index));
  }
  return amount;
}

async function rpcRequest(
  method: string,
  params: unknown[],
  urls: string[],
  fetcher: Fetcher,
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let rateLimited = false;

  for (const rpcUrl of urls) {
    try {
      const response = await fetcher(rpcUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (response.status === 429) rateLimited = true;
        continue;
      }
      const envelope = rpcEnvelopeSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (
        envelope.success &&
        !envelope.data.error &&
        envelope.data.result !== undefined
      ) {
        return envelope.data.result;
      }
    } catch {
      // Try the next configured RPC without exposing provider details.
    }
  }

  throw new ApiFailure(
    rateLimited ? 429 : 502,
    rateLimited ? "SOLANA_RPC_RATE_LIMITED" : "SOLANA_RPC_UNAVAILABLE",
    "The Solana network could not return the wallet balance.",
    true,
    rateLimited ? 5 : undefined,
  );
}

export async function getWalletBalance(
  owner: string,
  inputMint: string,
  options: WalletBalanceOptions = {},
): Promise<WalletBalance> {
  const fetcher = options.fetcher ?? fetch;
  const urls = rpcUrls(options.heliusApiKey);
  const solAmount = await rpcRequest(
    "getBalance",
    [owner, { commitment: "confirmed" }],
    urls,
    fetcher,
  ).then((result) => {
    const parsed = solBalanceResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new ApiFailure(
        502,
        "SOLANA_RPC_SCHEMA_MISMATCH",
        "The Solana network returned an unreadable SOL balance.",
        true,
      );
    }
    return String(parsed.data.value);
  });

  const inputAmount = await (inputMint === WRAPPED_SOL_MINT
    ? solAmount
    : rpcRequest(
        "getTokenAccountsByOwner",
        [
          owner,
          { mint: inputMint },
          {
            encoding: "base64",
            dataSlice: { offset: 64, length: 8 },
            commitment: "confirmed",
          },
        ],
        urls,
        fetcher,
      ).then((result) => {
        const parsed = tokenAccountsResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new ApiFailure(
            502,
            "SOLANA_RPC_SCHEMA_MISMATCH",
            "The Solana network returned an unreadable token balance.",
            true,
          );
        }
        return parsed.data.value
          .reduce(
            (total, item) =>
              total + amountFromBase64DataSlice(item.account.data[0]),
            0n,
          )
          .toString();
      }));

  return WalletBalanceSchema.parse({
    owner,
    inputMint,
    inputAmount,
    solAmount,
  });
}
