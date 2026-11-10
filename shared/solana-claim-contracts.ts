import { z } from "zod";

const integerString = z.string().regex(/^\d+$/);
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const solanaSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/);

export const SolanaClaimNetworkSchema = z.enum(["DEVNET", "MAINNET"]);

export const SolanaClaimEntitlementSchema = z.object({
  winnerAddress: solanaAddress,
  roundAddress: solanaAddress,
  vaultAddress: solanaAddress,
  feeRecipient: solanaAddress,
  rank: z.number().int().min(1).max(100),
  grossLamports: integerString,
  claimFeeLamports: integerString,
  netLamports: integerString,
  claimDeadline: z.iso.datetime().nullable(),
  status: z.enum(["CLAIMABLE", "CLAIMED"]),
});

export const SolanaClaimStateSchema = z.object({
  availability: z.enum(["DISABLED", "DEVNET_LIVE", "MAINNET_LIVE"]),
  network: SolanaClaimNetworkSchema.nullable(),
  walletAddress: solanaAddress,
  programId: solanaAddress,
  entitlements: z.array(SolanaClaimEntitlementSchema).max(100),
  serverTime: z.iso.datetime(),
});

export const SolanaClaimStateResponseSchema = z.object({
  data: SolanaClaimStateSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const SolanaClaimBuildInputSchema = z.object({
  walletAddress: solanaAddress,
  winnerAddress: solanaAddress,
});

export const SolanaClaimBuildResultSchema = z.object({
  network: SolanaClaimNetworkSchema,
  transaction: z.string().min(1).max(8_000),
  blockhash: z.string().min(32).max(64),
  lastValidBlockHeight: integerString,
  entitlement: SolanaClaimEntitlementSchema,
});

export const SolanaClaimBuildResponseSchema = z.object({
  data: SolanaClaimBuildResultSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const SolanaClaimSubmitInputSchema = z.object({
  walletAddress: solanaAddress,
  winnerAddress: solanaAddress,
  signedTransaction: z.string().min(1).max(8_000),
  lastValidBlockHeight: integerString,
});

export const SolanaClaimSubmitResultSchema = z.object({
  network: SolanaClaimNetworkSchema,
  transactionSignature: solanaSignature,
  status: z.enum(["CONFIRMED", "SUBMITTED"]),
});

export const SolanaClaimSubmitResponseSchema = z.object({
  data: SolanaClaimSubmitResultSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export type SolanaClaimEntitlement = z.infer<
  typeof SolanaClaimEntitlementSchema
>;
export type SolanaClaimState = z.infer<typeof SolanaClaimStateSchema>;
export type SolanaClaimBuildResult = z.infer<
  typeof SolanaClaimBuildResultSchema
>;
export type SolanaClaimSubmitResult = z.infer<
  typeof SolanaClaimSubmitResultSchema
>;
