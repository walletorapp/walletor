import type { TokenDetail, TokenSummary } from "../shared/contracts";
import type { PrizePoolState } from "../shared/accounting-contracts";

export function prizePoolFixture(now: number): PrizePoolState {
  return {
    accountingStatus: "LIVE",
    valuationStatus: "ESTIMATED",
    valuationExplanation: "Estimated collected fees",
    poolId: "test-pool",
    chainId: "solana:mainnet",
    chainFamily: "SOLANA",
    networkName: "Solana",
    currentPrizePoolMicroUsd: "123450000",
    currentPrizePoolCents: "12345",
    currentRoundSeedCents: "10000",
    organicContributionsMicroUsd: "23450000",
    organicContributionsCents: "2345",
    treasurySeedContributionsCents: "10000",
    totalCollectedMicroUsd: "123450000",
    totalCollectedCents: "12345",
    totalDistributedCents: "0",
    platformRevenueCents: "0",
    currentParticipants: 2,
    failedPayoutCount: 0,
    remainderCarriedForwardCents: "0",
    activeRound: {
      roundId: "test-prize-bar-round",
      status: "OPEN",
      startTime: new Date(now - 23 * 3600_000).toISOString(),
      endTime: new Date(now + 3600_000).toISOString(),
      lockedAt: null,
      completedAt: null,
      totalPoolCents: "12345",
      totalEligibleSwaps: 2,
      totalEligibleVolumeCents: "1000",
      eligibleWalletCount: 2,
      allocationChecksum: null,
      remainderCents: "0",
      failedPayoutCount: 0,
      payoutTransactionHashes: [],
    },
    completedRounds: [],
    serverTime: new Date(now).toISOString(),
    claimStatus: "CLAIM_UNAVAILABLE_BETA",
    distributionExplanation: "Test round",
    transparency: {
      treasuryAddress: null,
      referralAccount: null,
      referralFeeBps: 50,
      walletorPartnerShareBps: 8000,
      prizePoolShareBps: 8900,
      payoutExecutionStatus: "LOCKED_BETA",
      rewardEligibility: {
        everyConfirmedFeeBearingSwapCounts: true,
        repeatedTradeParametersAllowed: true,
        transactionSignatureCreditedOnce: true,
        weightingFormula: "CONFIRMED_SWAPS_X_TIER_X_LOG2_VOLUME_SCORE",
        tiers: [
          { confirmedSwaps: 1, multiplierBps: 10000 },
          { confirmedSwaps: 3, multiplierBps: 11000 },
          { confirmedSwaps: 5, multiplierBps: 12500 },
          { confirmedSwaps: 10, multiplierBps: 15000 },
        ],
      },
    },
  };
}

export const mint = "So11111111111111111111111111111111111111112";

export const token: TokenSummary = {
  address: mint,
  symbol: "SOL",
  name: "Wrapped SOL",
  logoUrl: null,
  rank: 1,
  priceUsd: 156.42,
  marketCapUsd: 80_000_000_000,
  liquidityUsd: 18_500_000,
  volume24hUsd: 2_100_000_000,
  priceChange1hPercent: 0.42,
  priceChange24hPercent: 3.14,
  holders: 1_200_000,
  listedAt: "2024-01-01T00:00:00.000Z",
};

export const tokenDetail: TokenDetail = {
  ...token,
  decimals: 9,
  supply: "510000000000000000",
  trades24h: 120_000,
  buys24h: 64_000,
  sells24h: 56_000,
  uniqueWallets24h: 43_000,
};

export function apiList(data: TokenSummary[] = [token]) {
  return {
    data,
    meta: {
      source: "jupiter",
      fetchedAt: "2026-07-22T12:00:00.000Z",
      requestId: "test-request",
    },
  };
}

export function apiDetail(data: TokenDetail = tokenDetail) {
  return {
    data,
    meta: {
      source: "jupiter",
      fetchedAt: "2026-07-22T12:00:00.000Z",
      requestId: "test-request",
    },
  };
}
