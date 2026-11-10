import { z } from "zod";

const integerString = z.string().regex(/^\d+$/);
const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/);
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const solanaSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);

export const RoundStatusSchema = z.enum([
  "OPEN",
  "LOCKING",
  "LOCKED",
  "CALCULATING",
  "ALLOCATED",
  "PAYING",
  "PARTIALLY_PAID",
  "COMPLETED",
  "FAILED",
]);

export const PublicRoundSchema = z.object({
  roundId: z.string().min(1),
  status: RoundStatusSchema,
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime(),
  lockedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  totalPoolCents: integerString,
  totalEligibleSwaps: z.number().int().nonnegative(),
  totalEligibleVolumeCents: integerString,
  eligibleWalletCount: z.number().int().nonnegative(),
  allocationChecksum: z.string().length(64).nullable(),
  remainderCents: integerString,
  failedPayoutCount: z.number().int().nonnegative(),
  payoutTransactionHashes: z.array(z.string().min(20).max(160)),
});

export const PrizePoolStateSchema = z.object({
  accountingStatus: z.enum(["DISABLED", "LIVE", "SYNCING", "PAUSED"]),
  valuationStatus: z.literal("ESTIMATED"),
  valuationExplanation: z.string().min(1),
  poolId: z.string().min(1),
  chainId: z.string().min(1),
  chainFamily: z.enum(["SOLANA", "EVM"]),
  networkName: z.string().min(1),
  currentPrizePoolMicroUsd: integerString,
  currentPrizePoolCents: integerString,
  currentRoundSeedCents: integerString.optional(),
  organicContributionsMicroUsd: integerString,
  organicContributionsCents: integerString,
  treasurySeedContributionsCents: integerString,
  totalCollectedMicroUsd: integerString,
  totalCollectedCents: integerString,
  totalDistributedCents: integerString,
  platformRevenueCents: integerString,
  currentParticipants: z.number().int().nonnegative(),
  failedPayoutCount: z.number().int().nonnegative(),
  remainderCarriedForwardCents: integerString,
  activeRound: PublicRoundSchema,
  completedRounds: z.array(PublicRoundSchema).max(25),
  serverTime: z.iso.datetime(),
  claimStatus: z.literal("CLAIM_UNAVAILABLE_BETA"),
  distributionExplanation: z.string().min(1),
  transparency: z.object({
    treasuryAddress: solanaAddress.nullable(),
    referralAccount: solanaAddress.nullable(),
    referralFeeBps: z.number().int().min(0).max(10_000).nullable(),
    walletorPartnerShareBps: z.number().int().min(0).max(10_000).nullable(),
    prizePoolShareBps: z.number().int().min(0).max(10_000),
    feeReserveBps: z.number().int().min(0).max(10_000).optional(),
    feeReserveStartsAt: z.iso.datetime().optional(),
    payoutExecutionStatus: z.literal("LOCKED_BETA"),
    rewardEligibility: z.object({
      everyConfirmedFeeBearingSwapCounts: z.boolean(),
      minimumEligibleSwapUsd: decimalString.optional(),
      repeatedTradeParametersAllowed: z.literal(true),
      transactionSignatureCreditedOnce: z.literal(true),
      weightingFormula: z.literal("CONFIRMED_SWAPS_X_TIER_X_LOG2_VOLUME_SCORE"),
      tiers: z
        .array(
          z.object({
            confirmedSwaps: z.union([
              z.literal(1),
              z.literal(3),
              z.literal(5),
              z.literal(10),
            ]),
            multiplierBps: z.union([
              z.literal(10_000),
              z.literal(11_000),
              z.literal(12_500),
              z.literal(15_000),
            ]),
          }),
        )
        .length(4),
    }),
  }),
});

export const PrizePoolStateResponseSchema = z.object({
  data: PrizePoolStateSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

const WalletActivityWindowSchema = z.object({
  actualSwaps: z.number().int().nonnegative(),
  eligibleSwaps: z.number().int().nonnegative(),
  eligibleVolumeCents: integerString,
  active: z.boolean(),
  multiplierBps: z.number().int().min(10_000),
  achievedTier: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(3),
    z.literal(5),
    z.literal(10),
  ]),
  nextTier: z
    .union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)])
    .nullable(),
  swapsUntilNextTier: z.number().int().nonnegative(),
});

export const WalletEngineStateSchema = z.object({
  accountingStatus: z.enum(["DISABLED", "LIVE", "SYNCING", "PAUSED"]),
  walletAddress: z.string().min(32).max(44),
  pointsLabel: z.literal("WLT Points"),
  futureAllocationLabel: z.literal("Future WLT Airdrop Allocation"),
  pointsPerEligibleSwap: integerString,
  eligibilityPolicy: z.object({
    everyConfirmedFeeBearingSwapCounts: z.boolean(),
    minimumEligibleSwapUsd: decimalString.optional(),
    transactionSignatureCreditedOnce: z.literal(true),
  }),
  activeRound: z.object({
    roundId: z.string().min(1),
    status: RoundStatusSchema,
    startTime: z.iso.datetime(),
    endTime: z.iso.datetime(),
  }),
  currentRound: WalletActivityWindowSchema,
  currentDay: WalletActivityWindowSchema,
  lifetimeWltPoints: integerString,
  pendingWltPoints: integerString,
  convertedWltPoints: integerString,
  serverTime: z.iso.datetime(),
});

export const WalletEngineStateResponseSchema = z.object({
  data: WalletEngineStateSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const ClaimAllocationStatusSchema = z.enum([
  "CLAIM_UNAVAILABLE_BETA",
  "PENDING_PAYOUT",
  "PROCESSING",
  "PAID",
  "FAILED",
  "MANUAL_REVIEW",
]);

export const ClaimAllocationSchema = z.object({
  allocationId: z.string().min(1),
  roundId: z.string().min(1),
  roundEndTime: z.iso.datetime(),
  rewardCents: integerString,
  status: ClaimAllocationStatusSchema,
  payoutTransactionHash: solanaSignature.nullable(),
  createdAt: z.iso.datetime(),
});

export const PublicDistributionRecipientSchema = z.object({
  allocationId: z.string().min(1),
  walletAddress: solanaAddress,
  eligibleSwapCount: z.number().int().nonnegative(),
  multiplierBps: z.number().int().min(10_000),
  rewardCents: integerString,
  status: ClaimAllocationStatusSchema,
  payoutTransactionHash: solanaSignature.nullable(),
  allocatedAt: z.iso.datetime(),
});

export const PublicDistributionRoundDetailSchema = z.object({
  round: PublicRoundSchema,
  recipients: z.array(PublicDistributionRecipientSchema).max(100),
  pagination: z.object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    totalRecipients: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  payoutExecutionStatus: z.literal("LOCKED_BETA"),
  transparencyNote: z.string().min(1),
  serverTime: z.iso.datetime(),
});

export const PublicDistributionRoundDetailResponseSchema = z.object({
  data: PublicDistributionRoundDetailSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const PublicDistributionCalendarSchema = z.object({
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  availableMonths: z.array(z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)),
  rounds: z.array(PublicRoundSchema).max(62),
  serverTime: z.iso.datetime(),
});

export const PublicDistributionCalendarResponseSchema = z.object({
  data: PublicDistributionCalendarSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const ClaimRewardsStateSchema = z.object({
  walletAddress: solanaAddress,
  claimSystemStatus: z.literal("UNAVAILABLE_BETA"),
  activeRound: z.object({
    roundId: z.string().min(1),
    status: RoundStatusSchema,
    startTime: z.iso.datetime(),
    endTime: z.iso.datetime(),
  }),
  claimableRewardsCents: integerString,
  pendingRewardsCents: integerString,
  lifetimePaidCents: integerString,
  allocations: z.array(ClaimAllocationSchema).max(25),
  feePolicy: z.object({
    networkFeePayer: z.literal("CLAIMANT"),
    networkFeeAsset: z.literal("SOL"),
    estimatedNetworkFeeLamports: integerString.nullable(),
    withdrawalFeeBps: z.literal(250),
    explanation: z.string().min(1),
  }),
  serverTime: z.iso.datetime(),
});

export const ClaimRewardsStateResponseSchema = z.object({
  data: ClaimRewardsStateSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export const VerifiedSwapCreditInputSchema = z.object({
  chainId: z.string().min(1).max(64),
  chainFamily: z.literal("SOLANA"),
  networkName: z.string().min(1).max(64),
  transactionHash: z.string().min(20).max(160),
  walletAddress: z.string().min(32).max(44),
  treasuryAddress: z.string().min(32).max(44),
  inputAssetAddress: z.string().min(32).max(44),
  outputAssetAddress: z.string().min(32).max(44),
  inputAmountAtomic: integerString,
  outputAmountAtomic: integerString,
  verifiedSwapValueCents: integerString,
  walletorFeeAssetAddress: z.string().min(32).max(44),
  walletorFeeAmountAtomic: integerString,
  verifiedWalletorFeeCents: integerString,
  routingFeeAmountAtomic: integerString.nullable(),
  networkFeeAmountAtomic: integerString.nullable(),
  blockNumberOrSlot: integerString,
  blockTime: z.iso.datetime(),
  finalizedAt: z.iso.datetime(),
  verificationVersion: z.string().min(1).max(64),
  walletFirstSeenAt: z.iso.datetime().nullable(),
  swapType: z.enum(["STANDARD_SWAP", "ADVANCED_TRADE"]),
});

export const VerifiedSwapCreditResultSchema = z.object({
  duplicate: z.boolean(),
  swapId: z.string().min(1),
  roundId: z.string().min(1),
  rewardEligible: z.boolean(),
  eligibilityReason: z.string().min(1),
  prizePoolContributionMicroUsd: integerString
    .nullable()
    .optional()
    .default(null),
  prizePoolContributionCents: integerString,
  feeReserveAmountAtomic: integerString.optional(),
  feeReserveMicroUsd: integerString.optional(),
  platformRevenueCents: integerString,
  wltPointsCredited: integerString,
  resultingLifetimeWltPoints: integerString.optional(),
  resultingPrizePoolMicroUsd: integerString.nullable().optional().default(null),
  resultingPrizePoolCents: integerString,
});

export const JupiterSwapOrderEvidenceSchema = z.object({
  requestId: z.string().min(1).max(200),
  questlineQuestId: z.literal(89).optional(),
  walletAddress: solanaAddress,
  inputMint: solanaAddress,
  outputMint: solanaAddress,
  inputAmountAtomic: integerString,
  outputAmountAtomic: integerString,
  feeMint: solanaAddress,
  quotedFeeAmountAtomic: integerString.nullable(),
  referralAccount: solanaAddress,
  referralFeeBps: z.number().int().min(50).max(255),
  partnerShareBps: z.number().int().min(1).max(10_000),
  valuationUsdDecimal: decimalString,
  valuationAmountAtomic: integerString,
  rewardValuationUsdDecimal: decimalString.nullable().optional(),
  registeredAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const JupiterSwapExecutionEvidenceSchema = z.object({
  requestId: z.string().min(1).max(200),
  transactionHash: z.string().min(20).max(160),
  inputAmountResult: integerString.nullable(),
  outputAmountResult: integerString.nullable(),
  totalInputAmount: integerString.nullable(),
  totalOutputAmount: integerString.nullable(),
  verifiedReferralFeeAmountAtomic: integerString
    .nullable()
    .optional()
    .default(null),
  verificationSource: z
    .enum(["JUPITER_EXECUTE", "SOLANA_FINALIZED_TRANSACTION"])
    .optional()
    .default("JUPITER_EXECUTE"),
  confirmedAt: z.iso.datetime(),
});

export type PublicRound = z.infer<typeof PublicRoundSchema>;
export type PrizePoolState = z.infer<typeof PrizePoolStateSchema>;
export type WalletEngineState = z.infer<typeof WalletEngineStateSchema>;
export type ClaimAllocation = z.infer<typeof ClaimAllocationSchema>;
export type ClaimRewardsState = z.infer<typeof ClaimRewardsStateSchema>;
export type PublicDistributionRecipient = z.infer<
  typeof PublicDistributionRecipientSchema
>;
export type PublicDistributionCalendar = z.infer<
  typeof PublicDistributionCalendarSchema
>;
export type PublicDistributionRoundDetail = z.infer<
  typeof PublicDistributionRoundDetailSchema
>;
export type VerifiedSwapCreditInput = z.infer<
  typeof VerifiedSwapCreditInputSchema
>;
export type VerifiedSwapCreditResult = z.infer<
  typeof VerifiedSwapCreditResultSchema
>;
export type JupiterSwapOrderEvidence = z.infer<
  typeof JupiterSwapOrderEvidenceSchema
>;
export type JupiterSwapExecutionEvidence = z.infer<
  typeof JupiterSwapExecutionEvidenceSchema
>;
