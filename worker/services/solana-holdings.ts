import { z } from "zod";

import type { WalletHolding, WalletHoldings } from "../../shared/contracts";
import { WalletHoldingsSchema } from "../../shared/contracts";
import { ApiFailure } from "../lib/http";

const PUBLIC_SOLANA_RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
] as const;
const HELIUS_MAINNET_RPC_URL = "https://mainnet.helius-rpc.com/";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RPC_TIMEOUT_MS = 7_000;
const MAX_VISIBLE_HOLDINGS = 250;

const rpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
});

const solBalanceResultSchema = z.object({
  value: z.number().int().nonnegative(),
});

const parsedTokenAccountsResultSchema = z.object({
  value: z.array(
    z.object({
      account: z.object({
        data: z.object({
          parsed: z.object({
            info: z.object({
              mint: z.string().min(32).max(44),
              tokenAmount: z.object({
                amount: z.string().regex(/^\d+$/),
                decimals: z.number().int().min(0).max(18),
              }),
            }),
          }),
        }),
      }),
    }),
  ),
});

const heliusAssetSchema = z.object({
  interface: z.string().optional(),
  id: z.string().min(32).max(44),
  content: z
    .object({
      metadata: z
        .object({
          name: z.string().optional(),
          symbol: z.string().optional(),
        })
        .optional(),
      links: z.record(z.string(), z.unknown()).optional(),
      files: z
        .array(
          z.object({
            uri: z.string().optional(),
            cdn_uri: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  token_info: z
    .object({
      symbol: z.string().optional(),
      decimals: z.number().int().min(0).max(18).optional(),
      price_info: z
        .object({
          price_per_token: z.number().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
});

const heliusAssetsResultSchema = z.object({
  items: z.array(heliusAssetSchema),
  nativeBalance: z
    .object({
      lamports: z
        .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
        .optional(),
      price_per_sol: z.number().nonnegative().optional(),
    })
    .optional(),
});

type Fetcher = typeof fetch;

interface WalletHoldingsOptions {
  fetcher?: Fetcher;
  heliusApiKey?: string;
}

interface ExactTokenBalance {
  amount: bigint;
  decimals: number;
}

function rpcUrls(heliusApiKey: string): string[] {
  return [
    `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(heliusApiKey)}`,
    ...PUBLIC_SOLANA_RPC_URLS,
  ];
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
      // Fail over without leaking upstream or secret details to the browser.
    }
  }

  throw new ApiFailure(
    rateLimited ? 429 : 502,
    rateLimited ? "SOLANA_RPC_RATE_LIMITED" : "SOLANA_RPC_UNAVAILABLE",
    "The Solana network could not return wallet holdings.",
    true,
    rateLimited ? 5 : undefined,
  );
}

async function getHeliusAssets(
  owner: string,
  heliusApiKey: string,
  fetcher: Fetcher,
): Promise<z.infer<typeof heliusAssetsResultSchema>> {
  const response = await fetcher(
    `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(heliusApiKey)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAssetsByOwner",
        params: {
          ownerAddress: owner,
          page: 1,
          limit: 1_000,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
          },
        },
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    },
  ).catch(() => null);

  if (!response?.ok) {
    throw new ApiFailure(
      response?.status === 429 ? 429 : 502,
      response?.status === 429
        ? "HELIUS_RATE_LIMITED"
        : "WALLET_HOLDINGS_UNAVAILABLE",
      "Wallet holdings are temporarily unavailable.",
      true,
      response?.status === 429 ? 5 : undefined,
    );
  }

  const envelope = rpcEnvelopeSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!envelope.success || envelope.data.error) {
    throw new ApiFailure(
      502,
      "WALLET_HOLDINGS_SCHEMA_MISMATCH",
      "Wallet holdings are temporarily unavailable.",
      true,
    );
  }
  const parsed = heliusAssetsResultSchema.safeParse(envelope.data.result);
  if (!parsed.success) {
    throw new ApiFailure(
      502,
      "WALLET_HOLDINGS_SCHEMA_MISMATCH",
      "Wallet holdings are temporarily unavailable.",
      true,
    );
  }
  return parsed.data;
}

function mergeExactTokenBalances(
  results: unknown[],
): Map<string, ExactTokenBalance> {
  const balances = new Map<string, ExactTokenBalance>();
  for (const result of results) {
    const parsed = parsedTokenAccountsResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new ApiFailure(
        502,
        "SOLANA_RPC_SCHEMA_MISMATCH",
        "The Solana network returned unreadable token balances.",
        true,
      );
    }
    for (const item of parsed.data.value) {
      const tokenAmount = item.account.data.parsed.info.tokenAmount;
      const mint = item.account.data.parsed.info.mint;
      const previous = balances.get(mint);
      if (previous && previous.decimals !== tokenAmount.decimals) continue;
      balances.set(mint, {
        amount: (previous?.amount ?? 0n) + BigInt(tokenAmount.amount),
        decimals: tokenAmount.decimals,
      });
    }
  }
  return balances;
}

function normalizedText(
  value: string | undefined,
  fallback: string,
  max: number,
) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return (normalized && normalized.length > 0 ? normalized : fallback).slice(
    0,
    max,
  );
}

function normalizedImageUrl(
  asset: z.infer<typeof heliusAssetSchema>,
): string | null {
  const linkedImage = asset.content?.links?.image;
  const candidates = [
    asset.content?.files?.[0]?.cdn_uri,
    asset.content?.files?.[0]?.uri,
    typeof linkedImage === "string" ? linkedImage : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.startsWith("ipfs://")) {
      return `https://ipfs.io/ipfs/${candidate.slice("ipfs://".length)}`;
    }
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // Ignore malformed metadata URLs and use the token fallback icon.
    }
  }
  return null;
}

function estimatedUsdForSort(holding: WalletHolding): number {
  if (holding.priceUsd === null) return -1;
  const units = Number(holding.amount) / 10 ** holding.decimals;
  const estimate = units * holding.priceUsd;
  return Number.isFinite(estimate) ? estimate : -1;
}

export async function getWalletHoldings(
  owner: string,
  options: WalletHoldingsOptions = {},
): Promise<WalletHoldings> {
  const heliusApiKey = options.heliusApiKey?.trim();
  if (!heliusApiKey) {
    throw new ApiFailure(
      503,
      "WALLET_HOLDINGS_NOT_CONFIGURED",
      "Connected-wallet holdings are not configured.",
      false,
    );
  }

  const fetcher = options.fetcher ?? fetch;
  const urls = rpcUrls(heliusApiKey);
  const [solResult, tokenResult, token2022Result, assets] = await Promise.all([
    rpcRequest(
      "getBalance",
      [owner, { commitment: "confirmed" }],
      urls,
      fetcher,
    ),
    rpcRequest(
      "getTokenAccountsByOwner",
      [
        owner,
        { programId: TOKEN_PROGRAM_ID },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
      urls,
      fetcher,
    ),
    rpcRequest(
      "getTokenAccountsByOwner",
      [
        owner,
        { programId: TOKEN_2022_PROGRAM_ID },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
      urls,
      fetcher,
    ),
    getHeliusAssets(owner, heliusApiKey, fetcher),
  ]);

  const solBalance = solBalanceResultSchema.safeParse(solResult);
  if (!solBalance.success) {
    throw new ApiFailure(
      502,
      "SOLANA_RPC_SCHEMA_MISMATCH",
      "The Solana network returned an unreadable SOL balance.",
      true,
    );
  }

  const exactBalances = mergeExactTokenBalances([tokenResult, token2022Result]);
  const assetsByMint = new Map(assets.items.map((asset) => [asset.id, asset]));
  const holdings: WalletHolding[] = [];

  if (solBalance.data.value > 0) {
    holdings.push({
      mint: WRAPPED_SOL_MINT,
      symbol: "SOL",
      name: "Solana",
      logoUrl:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
      decimals: 9,
      amount: String(solBalance.data.value),
      priceUsd: assets.nativeBalance?.price_per_sol ?? null,
    });
  }

  for (const [mint, balance] of exactBalances) {
    if (balance.amount === 0n) continue;
    const asset = assetsByMint.get(mint);
    const symbol = normalizedText(
      asset?.token_info?.symbol ?? asset?.content?.metadata?.symbol,
      `${mint.slice(0, 4)}…`,
      24,
    );
    const name = normalizedText(
      asset?.content?.metadata?.name,
      "Unknown token",
      120,
    );
    holdings.push({
      mint,
      symbol,
      name,
      logoUrl: asset ? normalizedImageUrl(asset) : null,
      decimals: balance.decimals,
      amount: balance.amount.toString(),
      priceUsd: asset?.token_info?.price_info?.price_per_token ?? null,
    });
  }

  // This order is presentation-only. Exact balances remain atomic strings.
  holdings.sort((left, right) => {
    const estimatedDifference =
      estimatedUsdForSort(right) - estimatedUsdForSort(left);
    if (estimatedDifference !== 0) return estimatedDifference;
    return left.symbol.localeCompare(right.symbol);
  });

  return WalletHoldingsSchema.parse({
    owner,
    holdings: holdings.slice(0, MAX_VISIBLE_HOLDINGS),
  });
}
