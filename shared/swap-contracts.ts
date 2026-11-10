import { z } from "zod";

import { VerifiedSwapCreditResultSchema } from "./accounting-contracts";

const numericString = z.string().regex(/^\d+$/);
const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/);

export const SwapMarketSchema = z.enum(["crypto", "rwa"]);

export const SwapPlatformFeeSchema = z.object({
  amount: numericString.nullable(),
  feeBps: z.number().int().nonnegative().nullable(),
  feeMint: z.string().min(32).max(44).nullable(),
});

export const SwapRouteLegSchema = z.object({
  label: z.string().min(1).max(100),
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  inAmount: numericString,
  outAmount: numericString,
  percent: z.number().min(0).max(100).nullable(),
  bps: z.number().int().min(0).max(10_000).nullable(),
});

export const SwapOrderDataSchema = z.object({
  market: SwapMarketSchema.optional(),
  requestId: z.string().min(1).max(200),
  transaction: z.string().min(1).nullable(),
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  inAmount: numericString,
  outAmount: numericString,
  otherAmountThreshold: numericString.nullable(),
  priceImpact: z.number().nullable().optional(),
  priceImpactPct: z.string().nullable(),
  inUsdValue: z.number().nullable(),
  outUsdValue: z.number().nullable(),
  inUsdValueDecimal: decimalString.nullable(),
  outUsdValueDecimal: decimalString.nullable(),
  router: z.string().nullable(),
  mode: z.string().nullable(),
  referralAccount: z
    .string()
    .min(32)
    .max(44)
    .nullable()
    .optional()
    .default(null),
  walletorPartnerShareBps: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .nullable()
    .optional()
    .default(null),
  feeBps: z.number().int().nonnegative().nullable(),
  feeMint: z.string().nullable(),
  platformFee: SwapPlatformFeeSchema.nullable(),
  routePlan: z.array(SwapRouteLegSchema).max(24),
  gasless: z.boolean().nullable(),
  signatureFeePayer: z.string().max(80).nullable(),
  prioritizationFeePayer: z.string().max(80).nullable(),
  rentFeePayer: z.string().max(80).nullable(),
  signatureFeeLamports: numericString.nullable(),
  prioritizationFeeLamports: numericString.nullable(),
  rentFeeLamports: numericString.nullable(),
  slippageBps: z.number().int().nonnegative().nullable(),
  totalTimeMs: z.number().nonnegative().nullable(),
  errorCode: z.number().int().nullable().optional().default(null),
  errorMessage: z.string().max(300).nullable().optional().default(null),
  lastValidBlockHeight: numericString.nullable().optional().default(null),
  quoteId: z.string().max(200).nullable().optional(),
  maker: z.string().max(80).nullable().optional(),
  expireAt: z.string().max(80).nullable().optional(),
});

export const SwapOrderResponseSchema = z.object({
  data: SwapOrderDataSchema,
  meta: z.object({
    source: z.literal("jupiter"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const SwapExecuteRequestSchema = z.object({
  signedTransaction: z
    .string()
    .min(100)
    .max(100_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  requestId: z.string().min(1).max(200),
  market: SwapMarketSchema.optional().default("crypto"),
  taker: z.string().min(32).max(44).optional(),
  lastValidBlockHeight: z.string().regex(/^\d+$/).optional(),
});

export const SwapExecuteDataSchema = z.object({
  status: z.enum(["Success", "Failed"]),
  signature: z.string().nullable(),
  code: z.number().int(),
  error: z.string().nullable(),
  inputAmountResult: numericString.nullable(),
  outputAmountResult: numericString.nullable(),
  totalInputAmount: numericString.nullable(),
  totalOutputAmount: numericString.nullable(),
  walletorAccounting: VerifiedSwapCreditResultSchema.nullable()
    .optional()
    .default(null),
});

export const SwapExecuteResponseSchema = z.object({
  data: SwapExecuteDataSchema,
  meta: z.object({
    source: z.literal("jupiter"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const SwapAccountingStatusDataSchema = z.object({
  status: z.enum(["CREDITED", "SYNCING"]),
  walletorAccounting: VerifiedSwapCreditResultSchema.nullable(),
});

export const SwapAccountingStatusResponseSchema = z.object({
  data: SwapAccountingStatusDataSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export type SwapOrder = z.infer<typeof SwapOrderDataSchema>;
export type SwapExecuteResult = z.infer<typeof SwapExecuteDataSchema>;
export type SwapAccountingStatus = z.infer<
  typeof SwapAccountingStatusDataSchema
>;
