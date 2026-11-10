import { z } from "zod";

const integerString = z.string().regex(/^\d+$/);
const solanaAddress = z.string().min(32).max(44);

export const WalletSwapQuoteRiskInputSchema = z.object({
  requestId: z.string().min(1).max(200),
  walletAddress: solanaAddress,
  quotedNotionalMicroUsd: integerString,
  registeredAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const WalletSwapLimitDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum([
    "ALLOWED",
    "ROLLING_LIMIT_EXCEEDED",
    "QUOTE_NOT_REGISTERED",
    "QUOTE_WALLET_MISMATCH",
    "QUOTE_EXPIRED",
    "EXECUTION_IN_PROGRESS",
    "EXECUTION_ALREADY_CONFIRMED",
    "EXECUTION_PREVIOUSLY_FAILED",
  ]),
  limitMicroUsd: integerString,
  usedMicroUsd: integerString,
  requestedMicroUsd: integerString,
  remainingMicroUsd: integerString,
  windowHours: z.literal(24),
});

export type WalletSwapQuoteRiskInput = z.infer<
  typeof WalletSwapQuoteRiskInputSchema
>;
export type WalletSwapLimitDecision = z.infer<
  typeof WalletSwapLimitDecisionSchema
>;
