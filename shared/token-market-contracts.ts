import { z } from "zod";

export const TokenChartMarketResponseSchema = z.object({
  data: z.object({
    mint: z.string().min(32).max(44),
    pairAddress: z.string().min(32).max(44).nullable(),
  }),
  meta: z.object({
    source: z.literal("dexscreener"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string(),
  }),
});

export type TokenChartMarket = z.infer<
  typeof TokenChartMarketResponseSchema
>["data"];
