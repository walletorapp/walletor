import { z } from "zod";

export const DAILY_SEED_CENTS = 10_000;
export const SEED_CAMPAIGN_DAYS = 7;
export const SEED_DEPOSIT_ATOMIC = "700000000";
export const SeedDepositInputSchema = z.object({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
});
export const PrizeSeedStateSchema = z.object({
  authorityAddress: z.string(),
  depositAccount: z.string(),
  requestedAt: z.iso.datetime().nullable(),
  fundedAt: z.iso.datetime().nullable(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  depositSignature: z.string().nullable(),
  seededRounds: z.number().int().min(0).max(7),
  remainingCents: z.number().int().min(0).max(70_000),
});
export type PrizeSeedState = z.infer<typeof PrizeSeedStateSchema>;
