import type {
  ClaimRewardsState,
  JupiterSwapExecutionEvidence,
  PrizePoolState,
  PublicDistributionCalendar,
  PublicDistributionRoundDetail,
  VerifiedSwapCreditResult,
  WalletEngineState,
} from "../../shared/accounting-contracts";
import type { ZealyVerification } from "./zealy";
import type { AffiliateReportQuery } from "../../shared/affiliate-report-contracts";
import { readQuestlineConfig } from "../services/questline";

export async function getFeeReserveReport(env: Partial<Env>) {
  return coordinator(env).getFeeReserveReport(new Date().toISOString());
}

export async function flushQuestlineCompletions(env: Partial<Env>) {
  if (!readQuestlineConfig(env))
    return { enabled: false, attempted: 0, accepted: 0 };
  return coordinator(env).flushQuestlineCompletions();
}

export async function getQuestlineStatus(env: Partial<Env>) {
  return coordinator(env).getQuestlineStatus();
}

export async function getAffiliateReport(
  env: Partial<Env>,
  query: AffiliateReportQuery,
  now = new Date(),
) {
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    now.toISOString(),
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getAffiliateReport(query, now.toISOString());
}

export async function verifyZealyTask(
  env: Partial<Env>,
  input: ZealyVerification,
  now: string,
) {
  if (!env.ZEALY_CAMPAIGN_START_AT)
    throw new Error("Zealy campaign start is missing");
  return coordinator(env).verifyZealyDailyTask(
    input,
    env.ZEALY_CAMPAIGN_START_AT,
    now,
  );
}
import {
  RankingsSchema,
  type LeaderboardQuery,
} from "../../shared/leaderboard-contracts";

export async function getPublicRankings(
  env: Partial<Env>,
  query: LeaderboardQuery,
) {
  const pool = await getPrizePoolState(env);
  const rankings = RankingsSchema.parse(
    await coordinator(env).getPublicRankings(query),
  );
  return {
    ...rankings,
    roundId: pool.activeRound.roundId,
    roundEndsAt: pool.activeRound.endTime,
    serverTime: pool.serverTime,
  };
}
import {
  AdminCanaryRoundCloseResultSchema,
  type AdminCanaryRoundCloseResult,
  type AdminLedgerSnapshot,
} from "../../shared/admin-contracts";
import {
  isHybridPrizeDraw,
  WEIGHTED_PRIZE_DRAW_ALGORITHM_VERSION,
  type PrizeDrawAlgorithmVersion,
  type PublicPrizeDrawSnapshot,
} from "../../shared/prize-draw-contracts";
import type { SwapExecuteResult, SwapOrder } from "../../shared/swap-contracts";
import { ApiFailure } from "../lib/http";
import { readAccountingEpoch } from "../lib/launch-config";
import { isSolanaAddress, isSolanaSignature } from "../lib/solana";
import { readSwapRiskConfig } from "../risk/config";
import { quotedSwapNotionalMicroUsd } from "../risk/swap-limit";
import type { WalletSwapRiskGate } from "../risk/wallet-swap-risk-gate";
import { getJupiterReferralConfig } from "../services/jupiter-referral";
import type {
  CoordinatorIdentity,
  CoordinatorRules,
  PrizePoolCoordinator,
  PrizeDrawOperationalSummary,
} from "./coordinator";
import { selectPrizeDrawWinners } from "./draw";
import { readAccountingConfig } from "./config";
import {
  buildStablecoinRecoveryOrder,
  getFinalizedSolanaTransactionEvidence,
  verifiedReferralFeeFromTransaction,
  type FinalizedSolanaTransactionEvidence,
} from "./solana-referral-verification";

export const SOLANA_POOL_IDENTITY: CoordinatorIdentity = {
  poolId: "solana:mainnet:prize-pool",
  chainId: "solana-mainnet",
  chainFamily: "SOLANA",
  networkName: "Solana Mainnet",
};

export function coordinatorRules(env: Partial<Env>): CoordinatorRules {
  const config = readAccountingConfig(env);
  const referral = getJupiterReferralConfig(env);
  if (config.enabled && referral === null) {
    throw new ApiFailure(
      503,
      "ACCOUNTING_NOT_CONFIGURED",
      "Walletor fee accounting is not configured for this environment.",
      false,
    );
  }
  return {
    accountingEnabled: config.enabled,
    prizePoolWinnerCount: config.prizePoolWinnerCount,
    prizePoolClaimFeeBps: config.prizePoolClaimFeeBps,
    chainId: SOLANA_POOL_IDENTITY.chainId,
    treasuryAddress: config.treasuryAddress,
    feeAssetMint: config.feeAssetMint,
    standardSwapFeeAtomic: config.standardSwapFeeAtomic?.toString() ?? null,
    standardSwapFeeCents: config.standardSwapFeeCents.toString(),
    advancedTradeFeeCents: config.advancedTradeFeeCents.toString(),
    prizePoolPercentageBps: config.prizePoolPercentageBps.toString(),
    platformRevenuePercentageBps:
      config.platformRevenuePercentageBps.toString(),
    roundDurationHours: config.roundDurationHours,
    minimumRewardEligibleSwapCents:
      config.minimumRewardEligibleSwapCents.toString(),
    newWalletReviewDays: config.newWalletReviewDays,
    wltBasePointsPerEligibleSwap:
      config.wltBasePointsPerEligibleSwap.toString(),
    referralAccount: referral?.account ?? null,
    referralFeeBps: referral?.feeBps ?? null,
    partnerShareBps: referral?.partnerShareBps ?? null,
  };
}

function formatMicroUsd(value: string): string {
  const microUsd = BigInt(value);
  const whole = microUsd / 1_000_000n;
  const cents = ((microUsd % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${cents}`;
}

function rollingLimitFailure(
  limitMicroUsd: string,
  remainingMicroUsd: string,
): ApiFailure {
  return new ApiFailure(
    429,
    "WALLET_SWAP_ROLLING_LIMIT_EXCEEDED",
    `This swap would exceed Walletor's ${formatMicroUsd(limitMicroUsd)} rolling 24-hour limit for this wallet. ${formatMicroUsd(remainingMicroUsd)} remains available through Walletor right now.`,
    false,
  );
}

function coordinator(
  env: Partial<Env>,
): DurableObjectStub<PrizePoolCoordinator> {
  if (!env.PRIZE_POOL_COORDINATOR) {
    throw new ApiFailure(
      503,
      "PRIZE_POOL_NOT_CONFIGURED",
      "Prize Pool accounting is temporarily unavailable.",
      true,
    );
  }
  return env.PRIZE_POOL_COORDINATOR.getByName(
    `${readAccountingEpoch(env)}:${SOLANA_POOL_IDENTITY.chainId}:${SOLANA_POOL_IDENTITY.poolId}`,
  );
}

export async function getRoundFeeSources(env: Partial<Env>, roundId: string) {
  return coordinator(env).roundFeeSources(roundId);
}

export async function referralCoordinator(env: Partial<Env>) {
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    new Date().toISOString(),
    readAccountingConfig(env).roundDurationHours,
  );
  return stub;
}

function swapRiskGate(
  env: Partial<Env>,
  walletAddress: string,
): DurableObjectStub<WalletSwapRiskGate> {
  if (!env.WALLET_SWAP_RISK_GATE) {
    throw new ApiFailure(
      503,
      "SWAP_LIMIT_NOT_CONFIGURED",
      "Walletor's rolling wallet limit is temporarily unavailable.",
      true,
    );
  }
  return env.WALLET_SWAP_RISK_GATE.getByName(
    `${readAccountingEpoch(env)}:${SOLANA_POOL_IDENTITY.chainId}:${walletAddress}`,
  );
}

export async function getPrizePoolState(
  env: Partial<Env>,
  now = new Date(),
): Promise<PrizePoolState> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getPublicState(serverTime, coordinatorRules(env));
}

export async function getPublicDistributionRound(
  env: Partial<Env>,
  roundId: string,
  offset: number,
  limit: number,
  now = new Date(),
): Promise<PublicDistributionRoundDetail> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  const distribution = await stub.getPublicDistributionRound(
    roundId,
    offset,
    limit,
    serverTime,
    coordinatorRules(env),
  );
  if (!distribution) {
    throw new ApiFailure(
      404,
      "DISTRIBUTION_ROUND_NOT_FOUND",
      "This finalized Prize Pool round was not found.",
      false,
    );
  }
  return distribution;
}

export async function getPublicPrizeDrawSnapshot(
  env: Partial<Env>,
  roundId: string,
  offset: number,
  limit: number,
  now = new Date(),
): Promise<PublicPrizeDrawSnapshot> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  const draw = await stub.getPublicPrizeDrawSnapshot(
    roundId,
    offset,
    limit,
    serverTime,
    coordinatorRules(env),
  );
  if (!draw) {
    throw new ApiFailure(
      404,
      "PRIZE_DRAW_NOT_FOUND",
      "This locked Prize Draw snapshot was not found.",
      false,
    );
  }
  return draw;
}

export async function getAdminUnfundedDraws(
  env: Partial<Env>,
  activeRoundIds: string[],
  now = new Date(),
): Promise<PrizeDrawOperationalSummary[]> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getAdminUnfundedDraws(
    activeRoundIds,
    serverTime,
    coordinatorRules(env),
  );
}

export async function getPrizeDrawSummariesEndingAt(
  env: Partial<Env>,
  endTime: string,
  now = new Date(),
): Promise<PrizeDrawOperationalSummary[]> {
  const parsedEndTime = new Date(endTime);
  if (!Number.isFinite(parsedEndTime.getTime())) {
    throw new Error("Prize Draw end time is invalid.");
  }
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getPrizeDrawSummariesEndingAt(
    parsedEndTime.toISOString(),
    serverTime,
    coordinatorRules(env),
  );
}

export async function deriveVerifiedPrizeDrawWinners(
  env: Partial<Env>,
  roundId: string,
  switchboardRandomnessHex: string,
  now = new Date(),
): Promise<{
  grossPoolCents: string;
  algorithmVersion: PrizeDrawAlgorithmVersion;
  winners: { rank: number; winnerAddress: string }[];
}> {
  const first = await getPublicPrizeDrawSnapshot(env, roundId, 0, 100, now);
  if (
    first.status !== "SNAPSHOT_LOCKED" ||
    (!isHybridPrizeDraw(first.algorithmVersion) &&
      first.algorithmVersion !== WEIGHTED_PRIZE_DRAW_ALGORITHM_VERSION)
  ) {
    throw new ApiFailure(
      409,
      "PRIZE_DRAW_NOT_READY",
      "Only a locked supported Prize Draw can create a USDC claim distribution.",
      false,
    );
  }
  const participants = [...first.participants];
  let nextOffset = first.pagination.nextOffset;
  while (nextOffset !== null) {
    const page = await getPublicPrizeDrawSnapshot(
      env,
      roundId,
      nextOffset,
      100,
      now,
    );
    if (
      page.participantChecksum !== first.participantChecksum ||
      page.updatedAt !== first.updatedAt
    ) {
      throw new ApiFailure(
        409,
        "PRIZE_DRAW_CHANGED",
        "The Prize Draw snapshot changed while it was being read.",
        true,
      );
    }
    participants.push(...page.participants);
    nextOffset = page.pagination.nextOffset;
  }
  if (participants.length !== first.participantCount) {
    throw new Error("The complete Prize Draw participant set is unavailable.");
  }
  const winners = await selectPrizeDrawWinners(
    {
      roundId: first.roundId,
      algorithmVersion: first.algorithmVersion,
      configuredWinnerCount: first.configuredWinnerCount,
      winnerCount: first.winnerCount,
      participantCount: first.participantCount,
      totalWeight: BigInt(first.totalWeight),
      participantChecksum: first.participantChecksum,
      participantMerkleRoot: first.participantMerkleRoot,
      participants: participants.map((participant) => ({
        ...participant,
        eligibleVolumeCents: BigInt(participant.eligibleVolumeCents),
        eligibleFeeContributionMicroUsd: BigInt(
          participant.eligibleFeeContributionMicroUsd,
        ),
        weight: BigInt(participant.weight),
        rangeStart: BigInt(participant.rangeStart),
        rangeEnd: BigInt(participant.rangeEnd),
      })),
    },
    switchboardRandomnessHex,
  );
  return {
    grossPoolCents: first.grossPoolCents,
    algorithmVersion: first.algorithmVersion,
    winners: winners.map(({ rank, walletAddress }) => ({
      rank,
      winnerAddress: walletAddress,
    })),
  };
}

export async function getPublicDistributionCalendar(
  env: Partial<Env>,
  month: string | null,
  now = new Date(),
): Promise<PublicDistributionCalendar> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getPublicDistributionCalendar(
    month,
    serverTime,
    coordinatorRules(env),
  );
}

export async function closeDuePrizePoolRounds(
  env: Env,
  now = new Date(),
): Promise<PrizePoolState> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.closeDueRounds(serverTime, coordinatorRules(env));
}

export async function closeCurrentPrizePoolRoundForCanary(
  env: Partial<Env>,
  expectedRoundId: string,
  now = new Date(),
): Promise<AdminCanaryRoundCloseResult> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  const outcome = await stub.closeCurrentRoundForCanary(
    expectedRoundId,
    serverTime,
    coordinatorRules(env),
  );
  if (outcome.status === "CLOSED") {
    return AdminCanaryRoundCloseResultSchema.parse(outcome.result);
  }
  const failures = {
    ACTIVE_ROUND_CHANGED: {
      code: "CANARY_ACTIVE_ROUND_CHANGED",
      message:
        "The active round changed. Refresh Walletor Admin and try again.",
    },
    ALREADY_SPLIT: {
      code: "CANARY_ROUND_ALREADY_CLOSED",
      message:
        "The one-time early close is unavailable for this round or has already completed.",
    },
    NO_ELIGIBLE_PARTICIPANTS: {
      code: "CANARY_ROUND_HAS_NO_ELIGIBLE_SWAPS",
      message:
        "Make and confirm at least one $5.00+ Walletor swap before closing the test round.",
    },
    EMPTY_PRIZE_POOL: {
      code: "CANARY_ROUND_HAS_NO_PRIZE",
      message:
        "The active round has no whole-cent Prize Pool balance to distribute yet.",
    },
    OUTSIDE_ACTIVE_WINDOW: {
      code: "CANARY_ROUND_NOT_ACTIVE",
      message:
        "The round is no longer inside its active window. Refresh Walletor Admin.",
    },
  } as const;
  const failure = failures[outcome.reason];
  throw new ApiFailure(409, failure.code, failure.message, false);
}

export async function getWalletEngineState(
  env: Partial<Env>,
  walletAddress: string,
  now = new Date(),
): Promise<WalletEngineState> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getWalletEngineState(
    walletAddress,
    serverTime,
    coordinatorRules(env),
  );
}

export async function getWalletClaimState(
  env: Partial<Env>,
  walletAddress: string,
  now = new Date(),
): Promise<ClaimRewardsState> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getWalletClaimState(
    walletAddress,
    serverTime,
    coordinatorRules(env),
  );
}

export async function getAdminLedgerSnapshot(
  env: Partial<Env>,
  now = new Date(),
): Promise<AdminLedgerSnapshot> {
  const stub = coordinator(env);
  const serverTime = now.toISOString();
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    serverTime,
    readAccountingConfig(env).roundDurationHours,
  );
  return stub.getAdminSnapshot(serverTime, coordinatorRules(env));
}

export async function registerWalletSwapRiskQuote(
  env: Partial<Env>,
  order: SwapOrder,
  walletAddress: string,
  now = new Date(),
): Promise<void> {
  const config = readSwapRiskConfig(env);
  if (!config.enabled || !order.transaction) return;
  if (!isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_TAKER",
      "Connect a valid Solana wallet.",
      false,
    );
  }
  let quotedNotionalMicroUsd: bigint;
  try {
    quotedNotionalMicroUsd = quotedSwapNotionalMicroUsd(
      order.inUsdValueDecimal,
      order.outUsdValueDecimal,
    );
  } catch {
    throw new ApiFailure(
      409,
      "SWAP_LIMIT_VALUATION_UNAVAILABLE",
      "Walletor could not verify this quote's USD value for the rolling wallet limit.",
      true,
    );
  }
  if (quotedNotionalMicroUsd <= 0n) {
    throw new ApiFailure(
      409,
      "SWAP_LIMIT_VALUATION_UNAVAILABLE",
      "Walletor could not verify a positive USD value for the rolling wallet limit.",
      true,
    );
  }

  const registeredAt = now.toISOString();
  const stub = swapRiskGate(env, walletAddress);
  const decision = await stub.registerQuote(
    {
      requestId: order.requestId,
      walletAddress,
      quotedNotionalMicroUsd: quotedNotionalMicroUsd.toString(),
      registeredAt,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    },
    config.rollingLimitMicroUsd.toString(),
  );
  if (!decision.allowed) {
    throw rollingLimitFailure(
      decision.limitMicroUsd,
      decision.remainingMicroUsd,
    );
  }
}

export async function beginWalletSwapRiskExecution(
  env: Partial<Env>,
  requestId: string,
  walletAddress: string | undefined,
  now = new Date(),
): Promise<void> {
  const config = readSwapRiskConfig(env);
  if (!config.enabled) return;
  if (!walletAddress || !isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "SWAP_WALLET_REQUIRED",
      "Reconnect your Solana wallet before submitting this swap.",
      false,
    );
  }
  const serverTime = now.toISOString();
  const stub = swapRiskGate(env, walletAddress);
  const decision = await stub.beginExecution(
    requestId,
    walletAddress,
    serverTime,
    config.rollingLimitMicroUsd.toString(),
  );
  if (decision.allowed) return;
  if (decision.reason === "ROLLING_LIMIT_EXCEEDED") {
    throw rollingLimitFailure(
      decision.limitMicroUsd,
      decision.remainingMicroUsd,
    );
  }
  if (decision.reason === "ALLOWED") {
    throw new Error("Wallet swap risk gate returned an inconsistent result.");
  }
  const failures = {
    QUOTE_NOT_REGISTERED: [
      "SWAP_LIMIT_PERMIT_INVALID",
      "Request a fresh Walletor quote before submitting this swap.",
    ],
    QUOTE_WALLET_MISMATCH: [
      "SWAP_LIMIT_PERMIT_INVALID",
      "This quote belongs to a different wallet.",
    ],
    QUOTE_EXPIRED: [
      "SWAP_QUOTE_EXPIRED",
      "This quote expired. Request a fresh quote and try again.",
    ],
    EXECUTION_IN_PROGRESS: [
      "SWAP_EXECUTION_IN_PROGRESS",
      "This Walletor swap is already being submitted.",
    ],
    EXECUTION_ALREADY_CONFIRMED: [
      "SWAP_ALREADY_CONFIRMED",
      "This Walletor swap was already confirmed.",
    ],
    EXECUTION_PREVIOUSLY_FAILED: [
      "SWAP_EXECUTION_FAILED",
      "This Walletor swap already failed. Request a fresh quote.",
    ],
  } as const;
  const failure = failures[decision.reason];
  throw new ApiFailure(409, failure[0], failure[1], false);
}

export async function settleWalletSwapRiskExecution(
  env: Partial<Env>,
  requestId: string,
  walletAddress: string | undefined,
  confirmed: boolean,
  now = new Date(),
): Promise<void> {
  const config = readSwapRiskConfig(env);
  if (!config.enabled) return;
  if (!walletAddress || !isSolanaAddress(walletAddress)) {
    throw new Error("Wallet swap risk settlement is missing its wallet.");
  }
  const serverTime = now.toISOString();
  const stub = swapRiskGate(env, walletAddress);
  await stub.settleExecution(requestId, walletAddress, confirmed, serverTime);
}

export async function registerJupiterSwapOrder(
  env: Partial<Env>,
  order: SwapOrder,
  walletAddress: string,
  now = new Date(),
  questlineQuestId?: 89,
): Promise<void> {
  if (!isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_TAKER",
      "Connect a valid Solana wallet.",
      false,
    );
  }
  const referral = getJupiterReferralConfig(env);
  const accounting = readAccountingConfig(env);
  if (!accounting.enabled || referral === null) return;
  if (
    !order.transaction ||
    order.referralAccount !== referral.account ||
    order.platformFee?.feeBps !== referral.feeBps ||
    order.feeMint === null ||
    order.walletorPartnerShareBps !== referral.partnerShareBps
  ) {
    throw new ApiFailure(
      409,
      "JUPITER_ORDER_NOT_ACCOUNTABLE",
      "Jupiter could not produce complete Walletor fee evidence for this order.",
      false,
    );
  }

  const usesInputValuation = order.feeMint === order.inputMint;
  const usesOutputValuation = order.feeMint === order.outputMint;
  const valuationUsdDecimal = usesInputValuation
    ? order.inUsdValueDecimal
    : usesOutputValuation
      ? order.outUsdValueDecimal
      : null;
  const valuationAmountAtomic = usesInputValuation
    ? order.inAmount
    : order.outAmount;
  const rewardValuationUsdDecimal =
    order.inUsdValueDecimal ?? order.outUsdValueDecimal;
  if (
    !valuationUsdDecimal ||
    !rewardValuationUsdDecimal ||
    (!usesInputValuation && !usesOutputValuation)
  ) {
    throw new ApiFailure(
      409,
      "JUPITER_VALUATION_UNAVAILABLE",
      "This order cannot be valued safely for the Prize Pool.",
      false,
    );
  }

  const registeredAt = now.toISOString();
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    registeredAt,
    accounting.roundDurationHours,
  );
  await stub.registerJupiterOrder(
    {
      requestId: order.requestId,
      questlineQuestId,
      walletAddress,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inputAmountAtomic: order.inAmount,
      outputAmountAtomic: order.outAmount,
      feeMint: order.feeMint,
      quotedFeeAmountAtomic: order.platformFee.amount,
      referralAccount: referral.account,
      referralFeeBps: referral.feeBps,
      partnerShareBps: referral.partnerShareBps,
      valuationUsdDecimal,
      valuationAmountAtomic,
      rewardValuationUsdDecimal,
      registeredAt,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    },
    coordinatorRules(env),
  );
}

export async function creditJupiterSwapExecution(
  env: Partial<Env>,
  requestId: string,
  result: SwapExecuteResult,
  now = new Date(),
): Promise<VerifiedSwapCreditResult | null> {
  const accounting = readAccountingConfig(env);
  if (!accounting.enabled || result.status !== "Success") return null;
  if (
    result.code !== 0 ||
    !result.signature ||
    !isSolanaSignature(result.signature)
  ) {
    throw new ApiFailure(
      502,
      "JUPITER_EXECUTION_EVIDENCE_INCOMPLETE",
      "Jupiter confirmed the swap without complete accounting evidence.",
      true,
    );
  }

  const confirmedAt = now.toISOString();
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    confirmedAt,
    accounting.roundDurationHours,
  );
  const registeredOrder = await stub.getJupiterOrderByRequestId(requestId);
  if (!registeredOrder) return null;
  const evidence: JupiterSwapExecutionEvidence = {
    requestId,
    transactionHash: result.signature,
    inputAmountResult: result.inputAmountResult,
    outputAmountResult: result.outputAmountResult,
    totalInputAmount: result.totalInputAmount,
    totalOutputAmount: result.totalOutputAmount,
    verifiedReferralFeeAmountAtomic: null,
    verificationSource: "JUPITER_EXECUTE",
    confirmedAt,
  };
  await stub.stageJupiterExecution(evidence);
  try {
    const completedEvidence = await completeJupiterExecutionEvidence(
      env,
      stub,
      evidence,
    );
    await stub.stageJupiterExecution(completedEvidence);
    return await stub.creditJupiterExecution(
      completedEvidence,
      coordinatorRules(env),
    );
  } catch (error) {
    await stub.recordJupiterAccountingFailure(
      requestId,
      error instanceof Error ? error.message : "Unknown accounting error",
      new Date().toISOString(),
    );
    throw error;
  }
}

export async function retryJupiterSwapAccounting(
  env: Partial<Env>,
  transactionHash: string,
  now = new Date(),
): Promise<VerifiedSwapCreditResult | null> {
  if (!isSolanaSignature(transactionHash)) {
    throw new ApiFailure(
      400,
      "INVALID_TRANSACTION_SIGNATURE",
      "Enter a valid Solana transaction signature.",
      false,
    );
  }
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    now.toISOString(),
    readAccountingConfig(env).roundDurationHours,
  );
  const evidence =
    await stub.getJupiterExecutionByTransactionHash(transactionHash);
  if (!evidence) {
    return stub.retryJupiterExecution(transactionHash, coordinatorRules(env));
  }
  try {
    const completedEvidence = await completeJupiterExecutionEvidence(
      env,
      stub,
      evidence,
    );
    await stub.stageJupiterExecution(completedEvidence);
    return await stub.retryJupiterExecution(
      transactionHash,
      coordinatorRules(env),
    );
  } catch (error) {
    await stub.recordJupiterAccountingFailure(
      evidence.requestId,
      error instanceof Error ? error.message : "Unknown accounting error",
      now.toISOString(),
    );
    throw error;
  }
}

/**
 * Reconcile a confirmed Jupiter transaction from either the execution record
 * staged during `/execute` or, when that link is missing, finalized Solana
 * evidence. The latter path is intentionally server-side: the browser only
 * supplies a transaction signature and cannot author fees or rewards.
 */
export async function reconcileJupiterSwapAccounting(
  env: Partial<Env>,
  transactionHash: string,
  now = new Date(),
): Promise<VerifiedSwapCreditResult | null> {
  const receipt = await retryJupiterSwapAccounting(env, transactionHash, now);
  if (receipt) return receipt;
  return recoverJupiterSwapAccounting(env, transactionHash, now);
}

export interface PendingJupiterAccountingRetrySummary {
  examined: number;
  credited: number;
  stillPending: number;
  failed: number;
}

export async function retryPendingJupiterSwapAccounting(
  env: Partial<Env>,
  now = new Date(),
): Promise<PendingJupiterAccountingRetrySummary> {
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    now.toISOString(),
    readAccountingConfig(env).roundDurationHours,
  );
  const transactionHashes = await stub.listPendingJupiterTransactionHashes(10);
  const results = await Promise.allSettled(
    transactionHashes.map((transactionHash) =>
      reconcileJupiterSwapAccounting(env, transactionHash, now),
    ),
  );
  return results.reduce<PendingJupiterAccountingRetrySummary>(
    (summary, result) => {
      if (result.status === "rejected") {
        summary.failed += 1;
      } else if (result.value) {
        summary.credited += 1;
      } else {
        summary.stillPending += 1;
      }
      return summary;
    },
    {
      examined: transactionHashes.length,
      credited: 0,
      stillPending: 0,
      failed: 0,
    },
  );
}

async function completeJupiterExecutionEvidence(
  env: Partial<Env>,
  stub: DurableObjectStub<PrizePoolCoordinator>,
  evidence: JupiterSwapExecutionEvidence,
  finalizedTransaction?: FinalizedSolanaTransactionEvidence,
): Promise<JupiterSwapExecutionEvidence> {
  if (evidence.verifiedReferralFeeAmountAtomic !== null) {
    return evidence;
  }
  const order = await stub.getJupiterOrderByRequestId(evidence.requestId);
  if (!order) {
    throw new ApiFailure(
      409,
      "JUPITER_ORDER_NOT_REGISTERED",
      "The confirmed Jupiter order is not registered for Walletor rewards.",
      false,
    );
  }
  const transaction =
    finalizedTransaction ??
    (await getFinalizedSolanaTransactionEvidence(
      evidence.transactionHash,
      env.HELIUS_API_KEY,
    ));
  if (!transaction) {
    throw new ApiFailure(
      409,
      "SOLANA_TRANSACTION_NOT_FINALIZED",
      "The swap is confirmed and waiting for finalized reward evidence.",
      true,
      2,
    );
  }
  return {
    ...evidence,
    verifiedReferralFeeAmountAtomic: verifiedReferralFeeFromTransaction(
      transaction,
      order,
      { maxQuoteVariationBps: 500, execution: evidence },
    ).toString(),
    verificationSource: "SOLANA_FINALIZED_TRANSACTION",
    confirmedAt: transaction.confirmedAt,
  };
}

export async function recoverJupiterSwapAccounting(
  env: Partial<Env>,
  transactionHash: string,
  now = new Date(),
): Promise<VerifiedSwapCreditResult | null> {
  if (!isSolanaSignature(transactionHash)) {
    throw new ApiFailure(
      400,
      "INVALID_TRANSACTION_SIGNATURE",
      "Enter a valid Solana transaction signature.",
      false,
    );
  }
  const stub = coordinator(env);
  await stub.initialize(
    SOLANA_POOL_IDENTITY,
    now.toISOString(),
    readAccountingConfig(env).roundDurationHours,
  );
  const linkedEvidence =
    await stub.getJupiterExecutionByTransactionHash(transactionHash);
  if (linkedEvidence) {
    return retryJupiterSwapAccounting(env, transactionHash, now);
  }
  const existing = await stub.retryJupiterExecution(
    transactionHash,
    coordinatorRules(env),
  );
  if (existing) return existing;

  const transaction = await getFinalizedSolanaTransactionEvidence(
    transactionHash,
    env.HELIUS_API_KEY,
  );
  if (!transaction) return null;
  const candidates = await stub.findPendingJupiterOrdersForRecovery(
    transaction.signerAddresses,
    transaction.confirmedAt,
  );
  const matches = candidates.flatMap((order) => {
    try {
      const feeAmount = verifiedReferralFeeFromTransaction(transaction, order);
      return [{ order, feeAmount }];
    } catch {
      return [];
    }
  });
  if (matches.length === 0) {
    const referral = getJupiterReferralConfig(env);
    if (!referral) return null;
    const recoveredOrder = buildStablecoinRecoveryOrder(transaction, {
      referralAccount: referral.account,
      referralFeeBps: referral.feeBps,
      partnerShareBps: referral.partnerShareBps,
    });
    if (!recoveredOrder) return null;
    await stub.registerJupiterOrder(recoveredOrder, coordinatorRules(env));
    const recoveredEvidence: JupiterSwapExecutionEvidence = {
      requestId: recoveredOrder.requestId,
      transactionHash,
      inputAmountResult: null,
      outputAmountResult: null,
      totalInputAmount: null,
      totalOutputAmount: null,
      verifiedReferralFeeAmountAtomic: verifiedReferralFeeFromTransaction(
        transaction,
        recoveredOrder,
      ).toString(),
      verificationSource: "SOLANA_FINALIZED_TRANSACTION",
      confirmedAt: transaction.confirmedAt,
    };
    await stub.stageJupiterExecution(recoveredEvidence);
    return stub.creditJupiterExecution(
      recoveredEvidence,
      coordinatorRules(env),
    );
  }
  if (matches.length > 1) {
    throw new ApiFailure(
      409,
      "AMBIGUOUS_JUPITER_ACCOUNTING_RECOVERY",
      "More than one pending Walletor order matches this transaction.",
      false,
    );
  }
  const match = matches[0];
  if (!match) return null;
  const evidence: JupiterSwapExecutionEvidence = {
    requestId: match.order.requestId,
    transactionHash,
    inputAmountResult: null,
    outputAmountResult: null,
    totalInputAmount: null,
    totalOutputAmount: null,
    verifiedReferralFeeAmountAtomic: match.feeAmount.toString(),
    verificationSource: "SOLANA_FINALIZED_TRANSACTION",
    confirmedAt: transaction.confirmedAt,
  };
  await stub.stageJupiterExecution(evidence);
  return stub.creditJupiterExecution(evidence, coordinatorRules(env));
}
