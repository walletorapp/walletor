import { z } from "zod";

export const RwaAssetTypeSchema = z.enum(["tokenized_stock", "rwa"]);
export const RwaTradingAvailabilitySchema = z.enum([
  "discovery_only",
  "tradable",
]);

export const RwaAssetSchema = z.object({
  mint: z.string().min(32).max(44),
  ticker: z.string().min(1).max(16),
  tokenSymbol: z.string().min(1).max(24),
  companyName: z.string().min(1).max(120),
  issuer: z.string().min(1).max(120),
  assetType: RwaAssetTypeSchema,
  productLabel: z.string().min(1).max(60),
  decimals: z.number().int().min(0).max(18),
  logoUrl: z.url(),
  priceUsd: z.number().nonnegative().nullable(),
  priceChange24hPercent: z.number().nullable(),
  verified: z.literal(true),
  verificationStatus: z.literal("walletor_verified_mint"),
  tradingAvailability: RwaTradingAvailabilitySchema,
  requiresEligibilityCheck: z.literal(true),
  issuerUrl: z.url(),
  restrictionsSummary: z.string().min(1).max(300),
});

export const RwaAssetListResponseSchema = z.object({
  data: z.object({
    stocksEnabled: z.boolean(),
    tradingEnabled: z.boolean(),
    jupiterzRouteBadgeEnabled: z.boolean(),
    assets: z.array(RwaAssetSchema),
  }),
  meta: z.object({
    source: z.literal("walletor-rwa-registry"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export type RwaAsset = z.infer<typeof RwaAssetSchema>;
export type RwaAssetList = z.infer<typeof RwaAssetListResponseSchema>["data"];
