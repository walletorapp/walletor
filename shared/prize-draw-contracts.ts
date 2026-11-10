import { z } from "zod";

const integerString = z.string().regex(/^\d+$/);
const hexDigest = z.string().regex(/^[a-f0-9]{64}$/);
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const LEGACY_PRIZE_DRAW_ALGORITHM_VERSION =
  "SWITCHBOARD_WEIGHTED_UNIQUE_V1" as const;
export const WEIGHTED_PRIZE_DRAW_ALGORITHM_VERSION =
  "SWITCHBOARD_WEIGHTED_UNIQUE_V2" as const;
export const PRIZE_DRAW_ALGORITHM_VERSION =
  "SWITCHBOARD_HYBRID_FEE_VOLUME_V3" as const;
export const REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION =
  "SWITCHBOARD_HYBRID_REFERRAL_V4" as const;
export function isHybridPrizeDraw(version: string): boolean {
  return (
    version === PRIZE_DRAW_ALGORITHM_VERSION ||
    version === REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION
  );
}

export const PrizeDrawAlgorithmVersionSchema = z.union([
  z.literal(LEGACY_PRIZE_DRAW_ALGORITHM_VERSION),
  z.literal(WEIGHTED_PRIZE_DRAW_ALGORITHM_VERSION),
  z.literal(PRIZE_DRAW_ALGORITHM_VERSION),
  z.literal(REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION),
]);

export const PrizeDrawStatusSchema = z.enum([
  "SNAPSHOT_LOCKED",
  "RANDOMNESS_COMMITTED",
  "RANDOMNESS_REVEALED",
  "WINNERS_SELECTED",
  "ONCHAIN_SETTLED",
  "COMPLETED",
  "FAILED",
]);

export const PrizeDrawMerkleProofNodeSchema = z.object({
  side: z.enum(["LEFT", "RIGHT"]),
  hash: hexDigest,
});

export const PublicPrizeDrawParticipantSchema = z.object({
  referralBoostBps: z.number().int().min(0).max(5000).optional(),
  participantIndex: z.number().int().nonnegative(),
  walletAddress: solanaAddress,
  eligibleSwapCount: z.number().int().positive(),
  eligibleVolumeCents: integerString,
  eligibleFeeContributionMicroUsd: integerString,
  multiplierBps: z.union([
    z.literal(10_000),
    z.literal(11_000),
    z.literal(12_500),
    z.literal(15_000),
  ]),
  weight: integerString,
  rangeStart: integerString,
  rangeEnd: integerString,
  leafHash: hexDigest,
});

export const PublicPrizeDrawSnapshotSchema = z.object({
  roundId: z.string().min(1),
  status: PrizeDrawStatusSchema,
  algorithmVersion: PrizeDrawAlgorithmVersionSchema,
  configuredWinnerCount: z.number().int().min(1).max(100),
  winnerCount: z.number().int().min(0).max(100),
  participantCount: z.number().int().nonnegative(),
  totalWeight: integerString,
  grossPoolCents: integerString,
  participantChecksum: hexDigest,
  participantMerkleRoot: hexDigest,
  claimFeeBps: z.number().int().min(0).max(10_000),
  randomnessAccount: solanaAddress.nullable(),
  commitTransactionSignature: z.string().min(20).max(160).nullable(),
  revealTransactionSignature: z.string().min(20).max(160).nullable(),
  settlementTransactionSignature: z.string().min(20).max(160).nullable(),
  participants: z.array(PublicPrizeDrawParticipantSchema).max(100),
  pagination: z.object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    totalParticipants: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  payoutExecutionStatus: z.literal("LOCKED_BETA"),
  transparencyNote: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  serverTime: z.iso.datetime(),
});

export const PublicPrizeDrawSnapshotResponseSchema = z.object({
  data: PublicPrizeDrawSnapshotSchema,
  meta: z.object({
    source: z.literal("walletor-ledger"),
    fetchedAt: z.iso.datetime(),
    requestId: z.string().min(1),
  }),
});

export type PrizeDrawStatus = z.infer<typeof PrizeDrawStatusSchema>;
export type PrizeDrawAlgorithmVersion = z.infer<
  typeof PrizeDrawAlgorithmVersionSchema
>;
export type PrizeDrawMerkleProofNode = z.infer<
  typeof PrizeDrawMerkleProofNodeSchema
>;
export type PublicPrizeDrawParticipant = z.infer<
  typeof PublicPrizeDrawParticipantSchema
>;
export type PublicPrizeDrawSnapshot = z.infer<
  typeof PublicPrizeDrawSnapshotSchema
>;
