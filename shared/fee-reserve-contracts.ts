import { z } from "zod";

export const FEE_RESERVE_BPS = 1100;
export const FEE_RESERVE_POLICY = "walletor-reserve-11-v1";
const atomic = z.string().regex(/^\d+$/);
export const FeeReserveReportSchema = z.object({
  policy: z.literal(FEE_RESERVE_POLICY),
  startsAt: z.iso.datetime(),
  reserveBps: z.literal(FEE_RESERVE_BPS),
  payoutEnabled: z.literal(false),
  generatedAt: z.iso.datetime(),
  balances: z.array(
    z.object({
      feeMint: z.string(),
      reservedAtomic: atomic,
      estimatedMicroUsd: atomic,
      receiptCount: z.number().int().nonnegative(),
    }),
  ),
  receipts: z.array(
    z.object({
      transactionHash: z.string(),
      feeMint: z.string(),
      grossAtomic: atomic,
      reservedAtomic: atomic,
      poolAtomic: atomic,
      confirmedAt: z.iso.datetime(),
    }),
  ),
});
export type FeeReserveReport = z.infer<typeof FeeReserveReportSchema>;
