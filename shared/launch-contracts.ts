import { z } from "zod";

export const LaunchEventSchema = z.object({
  mint: z.string().min(32).max(44),
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(24),
  observedAt: z.iso.datetime(),
  eventType: z.enum(["create", "migration"]).default("create"),
  metadataUri: z.string().max(2048).optional(),
});
export const LaunchTokenSchema = LaunchEventSchema.extend({
  stage: z.enum(["new", "almost", "migrated", "unknown"]),
  progressPercent: z.number().min(0).max(100).nullable(),
  poolAddress: z.string().nullable(),
  logoUrl: z.url().nullable(),
  priceUsd: z.number().nonnegative().nullable(),
  marketCapUsd: z.number().nonnegative().nullable(),
  liquidityUsd: z.number().nonnegative().nullable(),
  volume24hUsd: z.number().nonnegative().nullable(),
  marketCheckedAt: z.iso.datetime().nullable().default(null),
  holders: z.number().int().nonnegative().nullish(),
  transactions24h: z.number().int().nonnegative().nullish(),
  buys24h: z.number().int().nonnegative().nullish(),
  sells24h: z.number().int().nonnegative().nullish(),
  feesSol: z.number().nonnegative().nullish(),
  taxPercent: z.number().min(0).max(100).nullish(),
  developerHoldingPercent: z.number().min(0).max(100).nullish(),
  sniperHoldingPercent: z.number().min(0).max(100).nullish(),
  insiderHoldingPercent: z.number().min(0).max(100).nullish(),
  bundledHoldingPercent: z.number().min(0).max(100).nullish(),
  top10HoldingPercent: z.number().min(0).max(100).nullish(),
  dexScreenerPaid: z.boolean().nullish(),
  websiteUrl: z.url().nullish(),
  twitterUrl: z.url().nullish(),
  telegramUrl: z.url().nullish(),
});
export const LaunchBoardResponseSchema = z.object({
  data: z.object({
    tokens: z.array(LaunchTokenSchema).max(80),
    feedConnected: z.boolean(),
    lastEventAt: z.iso.datetime().nullable(),
    checkedAt: z.iso.datetime(),
    chainAvailable: z.boolean(),
    marketAvailable: z.boolean(),
    discoveryAvailable: z.boolean().optional(),
    discoveryCheckedAt: z.iso.datetime().nullable().optional(),
    discoveryStatus: z.string().max(64).optional(),
    discoveryRetryAt: z.iso.datetime().optional(),
  }),
});
export type LaunchEvent = z.infer<typeof LaunchEventSchema>;
export type LaunchToken = z.infer<typeof LaunchTokenSchema>;
export type LaunchBoard = z.infer<typeof LaunchBoardResponseSchema>["data"];
