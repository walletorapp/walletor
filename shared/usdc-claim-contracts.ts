import { z } from "zod";

import { PrizeDrawAlgorithmVersionSchema } from "./prize-draw-contracts";
import { MagicBlockEvidenceSchema } from "./magicblock-randomness";

const exactIntegerString = z.string().regex(/^\d+$/);
const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);
const hexDigest = z.string().regex(/^[a-f0-9]{64}$/);
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const solanaSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/);

export const USDC_CLAIM_FEE_BPS = 250 as const;
export const USDC_DECIMALS = 6 as const;
export const SOLANA_FOUNDATION_REWARDS_PROGRAM_ID =
  "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi" as const;
export const SOLANA_MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;
export const SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv" as const;
export const SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS =
  "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w" as const;

export const UsdcClaimEntitlementSchema = z.object({
  entitlementId: z.string().min(1).max(240),
  roundId: z.string().min(1).max(160),
  winnerAddress: solanaAddress,
  rank: z.number().int().min(1).max(100),
  provider: z.literal("SOLANA_FOUNDATION_REWARDS"),
  distributionAddress: solanaAddress,
  distributionVaultAddress: solanaAddress,
  claimAccountAddress: solanaAddress,
  mintAddress: z.literal(SOLANA_MAINNET_USDC_MINT),
  mintSymbol: z.literal("USDC"),
  mintDecimals: z.literal(USDC_DECIMALS),
  grossAmountAtomic: positiveIntegerString,
  claimFeeAmountAtomic: exactIntegerString,
  netAmountAtomic: positiveIntegerString,
  claimedAmountAtomic: exactIntegerString,
  remainingAmountAtomic: exactIntegerString,
  claimFeeBps: z.literal(USDC_CLAIM_FEE_BPS),
  claimDeadline: z.iso.datetime(),
  status: z.enum(["CLAIMABLE", "CLAIMED", "EXPIRED"]),
  transactionSignature: solanaSignature.nullable(),
});

export const UsdcClaimStateSchema = z.object({
  availability: z.enum(["DISABLED", "MAINNET_LIVE"]),
  network: z.literal("MAINNET"),
  walletAddress: solanaAddress,
  programId: z.literal(SOLANA_FOUNDATION_REWARDS_PROGRAM_ID),
  settlementAsset: z.object({
    mintAddress: z.literal(SOLANA_MAINNET_USDC_MINT),
    symbol: z.literal("USDC"),
    decimals: z.literal(USDC_DECIMALS),
  }),
  claimFeeBps: z.literal(USDC_CLAIM_FEE_BPS),
  entitlements: z.array(UsdcClaimEntitlementSchema).max(100),
  serverTime: z.iso.datetime(),
});

export const UsdcClaimStateResponseSchema = z.object({
  data: UsdcClaimStateSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const UsdcClaimBuildInputSchema = z.object({
  walletAddress: solanaAddress,
  entitlementId: z.string().min(1).max(240),
});

export const UsdcClaimBuildResultSchema = z.object({
  network: z.literal("MAINNET"),
  transaction: z.string().min(1).max(12_000),
  blockhash: z.string().min(32).max(64),
  lastValidBlockHeight: positiveIntegerString,
  entitlement: UsdcClaimEntitlementSchema,
});

export const UsdcClaimBuildResponseSchema = z.object({
  data: UsdcClaimBuildResultSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const UsdcClaimConfirmInputSchema = z.object({
  walletAddress: solanaAddress,
  entitlementId: z.string().min(1).max(240),
  transactionSignature: solanaSignature,
});

export const UsdcClaimConfirmResultSchema = z.object({
  network: z.literal("MAINNET"),
  transactionSignature: solanaSignature,
  status: z.enum(["CONFIRMED", "SUBMITTED"]),
});

export const UsdcClaimConfirmResponseSchema = z.object({
  data: UsdcClaimConfirmResultSchema,
  meta: z.object({
    source: z.literal("solana"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const UsdcClaimManifestEntitlementSchema = z.object({
  winnerAddress: solanaAddress,
  rank: z.number().int().min(1).max(100),
  grossAmountAtomic: positiveIntegerString,
  claimFeeAmountAtomic: exactIntegerString,
  netAmountAtomic: positiveIntegerString,
  leafHash: hexDigest,
  proof: z.array(hexDigest).max(32),
});

export const UsdcClaimDistributionManifestSchema = z.object({
  magicblock: MagicBlockEvidenceSchema.optional(),
  version: z.literal(1),
  roundId: z.string().min(1).max(160),
  sourceRevision: z.string().min(7).max(80),
  prizeDrawAlgorithmVersion: PrizeDrawAlgorithmVersionSchema,
  randomnessAccount: solanaAddress,
  randomnessValue: hexDigest,
  randomnessCommitTransactionSignature: solanaSignature,
  randomnessRevealTransactionSignature: solanaSignature,
  network: z.literal("MAINNET"),
  provider: z.literal("SOLANA_FOUNDATION_REWARDS"),
  programId: z.literal(SOLANA_FOUNDATION_REWARDS_PROGRAM_ID),
  mintAddress: z.literal(SOLANA_MAINNET_USDC_MINT),
  mintSymbol: z.literal("USDC"),
  mintDecimals: z.literal(USDC_DECIMALS),
  authorityAddress: solanaAddress,
  seedAddress: solanaAddress,
  distributionAddress: solanaAddress,
  distributionVaultAddress: solanaAddress,
  merkleRoot: hexDigest,
  grossPrizeAmountAtomic: positiveIntegerString,
  claimFeeAmountAtomic: exactIntegerString,
  netDistributionAmountAtomic: positiveIntegerString,
  claimFeeBps: z.literal(USDC_CLAIM_FEE_BPS),
  clawbackUnixTimestamp: positiveIntegerString,
  createTransactionSignature: solanaSignature,
  entitlements: z.array(UsdcClaimManifestEntitlementSchema).min(1).max(100),
});

export const UsdcClaimDistributionManifestDraftSchema =
  UsdcClaimDistributionManifestSchema.omit({
    createTransactionSignature: true,
  });

export const UsdcClaimDistributionPrepareInputSchema = z.object({
  roundId: z.string().regex(/^[a-z0-9:.-]{1,160}$/i),
  randomnessAccount: solanaAddress,
  randomnessCommitTransactionSignature: solanaSignature,
  randomnessRevealTransactionSignature: solanaSignature,
  seedAddress: solanaAddress,
});

export const UsdcClaimDistributionPrepareResultSchema = z.object({
  preparationId: z.uuid(),
  network: z.literal("MAINNET"),
  transaction: z.string().min(1).max(12_000),
  blockhash: z.string().min(32).max(64),
  lastValidBlockHeight: positiveIntegerString,
  manifest: UsdcClaimDistributionManifestDraftSchema,
});

export const UsdcClaimDistributionStageInputSchema = z.object({
  preparationId: z.uuid(),
  manifest: UsdcClaimDistributionManifestSchema,
});

export const UsdcClaimDistributionPrepareResponseSchema = z.object({
  data: UsdcClaimDistributionPrepareResultSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const UsdcClaimDistributionActivationSchema = z.object({
  manifestChecksum: hexDigest,
});

export const SwitchboardRandomnessRevealPrepareInputSchema = z
  .object({
    randomnessAccount: solanaAddress,
  })
  .strict();

export const SwitchboardRandomnessRevealPrepareResultSchema = z.object({
  randomnessAccount: solanaAddress,
  transaction: z.string().min(1).max(12_000),
  blockhash: z.string().min(32).max(64),
  lastValidBlockHeight: positiveIntegerString,
});

export const SwitchboardRandomnessRevealPrepareResponseSchema = z.object({
  data: SwitchboardRandomnessRevealPrepareResultSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const UsdcClaimDistributionAdminResultSchema = z.object({
  roundId: z.string().min(1).max(160),
  status: z.enum(["STAGED", "ACTIVE"]),
  manifestChecksum: hexDigest,
  distributionAddress: solanaAddress,
  netDistributionAmountAtomic: positiveIntegerString,
  entitlementCount: z.number().int().min(1).max(100),
});

export const UsdcClaimDistributionAdminResponseSchema = z.object({
  data: UsdcClaimDistributionAdminResultSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export type UsdcClaimEntitlement = z.infer<typeof UsdcClaimEntitlementSchema>;
export type UsdcClaimState = z.infer<typeof UsdcClaimStateSchema>;
export type UsdcClaimBuildResult = z.infer<typeof UsdcClaimBuildResultSchema>;
export type UsdcClaimConfirmResult = z.infer<
  typeof UsdcClaimConfirmResultSchema
>;
export type UsdcClaimDistributionManifest = z.infer<
  typeof UsdcClaimDistributionManifestSchema
>;
export type UsdcClaimDistributionManifestDraft = z.infer<
  typeof UsdcClaimDistributionManifestDraftSchema
>;
export type UsdcClaimDistributionPrepareInput = z.infer<
  typeof UsdcClaimDistributionPrepareInputSchema
>;
export type UsdcClaimDistributionPrepareResult = z.infer<
  typeof UsdcClaimDistributionPrepareResultSchema
>;
export type UsdcClaimDistributionStageInput = z.infer<
  typeof UsdcClaimDistributionStageInputSchema
>;
export type UsdcClaimDistributionAdminResult = z.infer<
  typeof UsdcClaimDistributionAdminResultSchema
>;
export type SwitchboardRandomnessRevealPrepareResult = z.infer<
  typeof SwitchboardRandomnessRevealPrepareResultSchema
>;
