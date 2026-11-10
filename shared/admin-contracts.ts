import { z } from "zod";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  USDC_CLAIM_FEE_BPS,
  UsdcClaimDistributionAdminResultSchema,
} from "./usdc-claim-contracts";
import { PrizeDrawStatusSchema } from "./prize-draw-contracts";

const exactIntegerString = z.string().regex(/^\d+$/);
const optionalHttpsUrl = z
  .union([
    z.literal(""),
    z.null(),
    z.url().refine((value) => value.startsWith("https://")),
  ])
  .transform((value) => (value === "" ? null : value));
const optionalEmail = z
  .union([z.literal(""), z.null(), z.email()])
  .transform((value) => (value === "" ? null : value));

export const AdminActorSchema = z.object({
  email: z.email(),
});

export const AdminRuntimeSettingsInputSchema = z
  .object({
    announcementEnabled: z.boolean(),
    announcementText: z.string().trim().max(180),
    supportEmail: optionalEmail,
    docsUrl: optionalHttpsUrl,
    xUrl: optionalHttpsUrl,
    telegramUrl: optionalHttpsUrl,
    discordUrl: optionalHttpsUrl,
  })
  .strict();

export const AdminCanaryRoundCloseInputSchema = z
  .object({
    roundId: z.string().regex(/^[a-z0-9:.-]{1,160}$/i),
  })
  .strict();

export const AdminCanaryRoundCloseResultSchema = z.object({
  closedRoundId: z.string().min(1),
  continuationRoundId: z.string().min(1),
  closedAt: z.iso.datetime(),
  continuationEndsAt: z.iso.datetime(),
  participantCount: z.number().int().positive(),
  eligibleSwapCount: z.number().int().positive(),
  grossPoolCents: exactIntegerString.refine((value) => BigInt(value) > 0n),
});

export const AdminCanaryRoundCloseResponseSchema = z.object({
  data: AdminCanaryRoundCloseResultSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const AdminRuntimeSettingsSchema = z.object({
  announcementEnabled: z.boolean(),
  announcementText: z.string().max(180),
  supportEmail: z.email().nullable(),
  docsUrl: z.url().nullable(),
  xUrl: z.url().nullable(),
  telegramUrl: z.url().nullable(),
  discordUrl: z.url().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.email().nullable(),
});

export const AdminTraderSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  firstActiveAt: z.iso.datetime().nullable(),
  lastActiveAt: z.iso.datetime().nullable(),
  confirmedSwaps: z.number().int().nonnegative(),
  eligibleSwaps: z.number().int().nonnegative(),
  eligibleVolumeCents: exactIntegerString,
  lifetimeWltPoints: exactIntegerString,
  pendingWltPoints: exactIntegerString,
});

export const AdminSwapSchema = z.object({
  requestId: z.string().min(1),
  transactionHash: z.string().min(1).nullable(),
  status: z.enum(["PENDING", "CREDITED"]),
  walletAddress: z.string().min(32).max(44),
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  inputAmountAtomic: exactIntegerString,
  outputAmountAtomic: exactIntegerString,
  feeMint: z.string().min(32).max(44),
  walletorFeeAtomic: exactIntegerString.nullable(),
  prizePoolContributionMicroUsd: exactIntegerString.nullable(),
  wltPointsCredited: exactIntegerString.nullable(),
  accountingError: z.string().nullable(),
  accountingAttempts: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const AdminLedgerSnapshotSchema = z.object({
  accountingStatus: z.enum(["DISABLED", "PAUSED", "LIVE"]),
  poolId: z.string().min(1),
  activeRoundId: z.string().min(1),
  activeRoundEndsAt: z.iso.datetime(),
  currentPrizePoolMicroUsd: exactIntegerString,
  totalCollectedMicroUsd: exactIntegerString,
  totalDistributedCents: exactIntegerString,
  platformRevenueCents: exactIntegerString,
  traderCount: z.number().int().nonnegative(),
  confirmedSwapCount: z.number().int().nonnegative(),
  pendingAccountingCount: z.number().int().nonnegative(),
  accountingFailureCount: z.number().int().nonnegative(),
  currentEligibleWallets: z.number().int().nonnegative(),
  lifetimeWltPoints: exactIntegerString,
  traders: z.array(AdminTraderSchema),
  recentSwaps: z.array(AdminSwapSchema),
});

export const AdminD1SummarySchema = z.object({
  databaseName: z.enum(["walletor-accounting", "walletor-token-index"]),
  discoveredTokenCount: z.number().int().nonnegative(),
  pumpfunTokenCount: z.number().int().nonnegative(),
  referralFeeMintCount: z.number().int().nonnegative(),
  pendingReferralFeeMintCount: z.number().int().nonnegative(),
  lastTokenIndexedAt: z.iso.datetime().nullable(),
});

export const AdminClosedPrizeDrawSchema = z.object({
  roundId: z.string().min(1).max(160),
  status: PrizeDrawStatusSchema,
  participantCount: z.number().int().nonnegative(),
  winnerCount: z.number().int().nonnegative().max(100),
  grossPoolCents: exactIntegerString,
  createdAt: z.iso.datetime(),
  distribution: UsdcClaimDistributionAdminResultSchema.nullable(),
});

export const AdminAuditEventSchema = z.object({
  id: z.string().min(1),
  actorEmail: z.email(),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const AdminBootstrapSchema = z.object({
  actor: AdminActorSchema,
  ledger: AdminLedgerSnapshotSchema,
  database: AdminD1SummarySchema,
  settings: AdminRuntimeSettingsSchema,
  auditEvents: z.array(AdminAuditEventSchema),
  claimOperations: z.object({
    payoutsEnabled: z.boolean(),
    fundingEnabled: z.boolean().default(false),
    magicblockEnabled: z.boolean().default(false),
    magicblockFirstRoundAt: z.iso.datetime().nullable().default(null),
    automaticSettlementEnabled: z.boolean(),
    network: z.literal("MAINNET"),
    authorityAddress: z.string().min(32).max(44),
    programId: z.literal(SOLANA_FOUNDATION_REWARDS_PROGRAM_ID),
    mintAddress: z.literal(SOLANA_MAINNET_USDC_MINT),
    claimFeeBps: z.literal(USDC_CLAIM_FEE_BPS),
    latestClosedRounds: z.array(AdminClosedPrizeDrawSchema).max(100),
  }),
  capabilities: z.object({
    financialRecordsReadOnly: z.literal(true),
    claimsReadOnly: z.boolean(),
    runtimeSettingsEditable: z.literal(true),
  }),
  generatedAt: z.iso.datetime(),
});

export const AdminBootstrapResponseSchema = z.object({
  data: AdminBootstrapSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const AdminSettingsResponseSchema = z.object({
  data: AdminRuntimeSettingsSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export type AdminActor = z.infer<typeof AdminActorSchema>;
export type AdminCanaryRoundCloseResult = z.infer<
  typeof AdminCanaryRoundCloseResultSchema
>;
export type AdminRuntimeSettingsInput = z.input<
  typeof AdminRuntimeSettingsInputSchema
>;
export type AdminRuntimeSettings = z.infer<typeof AdminRuntimeSettingsSchema>;
export type AdminTrader = z.infer<typeof AdminTraderSchema>;
export type AdminSwap = z.infer<typeof AdminSwapSchema>;
export type AdminLedgerSnapshot = z.infer<typeof AdminLedgerSnapshotSchema>;
export type AdminD1Summary = z.infer<typeof AdminD1SummarySchema>;
export type AdminClosedPrizeDraw = z.infer<typeof AdminClosedPrizeDrawSchema>;
export type AdminAuditEvent = z.infer<typeof AdminAuditEventSchema>;
export type AdminBootstrap = z.infer<typeof AdminBootstrapSchema>;
