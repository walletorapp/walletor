import { z } from "zod";

const nullableNumber = z.number().nullable();
const nullableInteger = z.number().int().nonnegative().nullable();

export const TokenDiscoverySourceSchema = z.enum([
  "jupiter",
  "pumpfun",
  "helius",
]);

export const TokenSummarySchema = z.object({
  address: z.string().min(32).max(44),
  symbol: z.string().min(1).max(24),
  name: z.string().min(1).max(120),
  logoUrl: z.url().nullable(),
  rank: z.number().int().positive().nullable(),
  priceUsd: nullableNumber,
  marketCapUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  volume24hUsd: nullableNumber,
  priceChange1hPercent: nullableNumber,
  priceChange24hPercent: nullableNumber,
  holders: nullableInteger,
  listedAt: z.iso.datetime().nullable(),
});

export const TokenDetailSchema = TokenSummarySchema.extend({
  decimals: z.number().int().min(0).max(18).nullable(),
  supply: z.string().nullable(),
  trades24h: nullableInteger,
  buys24h: nullableInteger,
  sells24h: nullableInteger,
  uniqueWallets24h: nullableInteger,
});

export const SwapTokenSearchResultSchema = z.object({
  address: z.string().min(32).max(44),
  symbol: z.string().min(1).max(24),
  name: z.string().min(1).max(120),
  logoUrl: z.url().nullable(),
  decimals: z.number().int().min(0).max(18),
  isVerified: z.boolean(),
  organicScore: nullableNumber,
  organicScoreLabel: z.enum(["high", "medium", "low"]).nullable(),
  priceUsd: nullableNumber,
  marketCapUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  holders: nullableInteger,
  mintAuthorityDisabled: z.boolean().nullable(),
  freezeAuthorityDisabled: z.boolean().nullable(),
  topHoldersPercent: nullableNumber,
  source: TokenDiscoverySourceSchema.default("jupiter"),
  discoveredAt: z.iso.datetime().nullable().default(null),
});

export const PumpTokenIngestItemSchema = z.object({
  mint: z.string().min(32).max(44),
  symbol: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
  decimals: z.number().int().min(0).max(18),
  logoUrl: z.url().nullable().default(null),
  metadataUri: z.string().trim().min(1).max(500).nullable().default(null),
  creatorAddress: z.string().min(32).max(44).nullable().default(null),
  tokenProgram: z.string().min(32).max(44),
  creationSignature: z.string().min(80).max(88),
  createdAt: z.iso.datetime(),
});

export const PumpTokenIngestRequestSchema = z.object({
  tokens: z.array(PumpTokenIngestItemSchema).min(1).max(100),
});

export const TokenPriceSchema = z.object({
  address: z.string().min(32).max(44),
  priceUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  priceChange24hPercent: nullableNumber,
  blockId: nullableInteger,
  decimals: z.number().int().min(0).max(18).nullable(),
});

export const ResponseMetaSchema = z.object({
  source: z.enum(["jupiter", "walletor-token-index"]),
  fetchedAt: z.iso.datetime(),
  requestId: z.string().min(1),
});

export const TokenListResponseSchema = z.object({
  data: z.array(TokenSummarySchema),
  meta: ResponseMetaSchema,
});

export const TokenDetailResponseSchema = z.object({
  data: TokenDetailSchema,
  meta: ResponseMetaSchema,
});

export const SwapTokenSearchResponseSchema = z.object({
  data: z.array(SwapTokenSearchResultSchema),
  meta: ResponseMetaSchema,
});

export const TokenPriceResponseSchema = z.object({
  data: z.array(TokenPriceSchema),
  meta: ResponseMetaSchema,
});

export const WalletBalanceSchema = z.object({
  owner: z.string().min(32).max(44),
  inputMint: z.string().min(32).max(44),
  inputAmount: z.string().regex(/^\d+$/),
  solAmount: z.string().regex(/^\d+$/),
});

export const WalletBalanceResponseSchema = z.object({
  data: WalletBalanceSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const WalletHoldingSchema = z.object({
  mint: z.string().min(32).max(44),
  symbol: z.string().min(1).max(24),
  name: z.string().min(1).max(120),
  logoUrl: z.url().nullable(),
  decimals: z.number().int().min(0).max(18),
  amount: z.string().regex(/^\d+$/),
  priceUsd: nullableNumber,
});

export const WalletHoldingsSchema = z.object({
  owner: z.string().min(32).max(44),
  holdings: z.array(WalletHoldingSchema).max(1_001),
});

export const WalletHoldingsResponseSchema = z.object({
  data: WalletHoldingsSchema,
  meta: z.object({
    source: z.literal("solana-helius"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const HealthResponseSchema = z.object({
  data: z.object({
    status: z.literal("ok"),
    service: z.literal("walletor-api"),
  }),
  meta: z.object({ requestId: z.string().min(1) }),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  meta: z.object({ requestId: z.string().min(1) }),
});

export type TokenSummary = z.infer<typeof TokenSummarySchema>;
export type TokenDetail = z.infer<typeof TokenDetailSchema>;
export type SwapTokenSearchResult = z.infer<typeof SwapTokenSearchResultSchema>;
export type PumpTokenIngestItem = z.infer<typeof PumpTokenIngestItemSchema>;
export type TokenPrice = z.infer<typeof TokenPriceSchema>;
export type WalletBalance = z.infer<typeof WalletBalanceSchema>;
export type WalletHolding = z.infer<typeof WalletHoldingSchema>;
export type WalletHoldings = z.infer<typeof WalletHoldingsSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
