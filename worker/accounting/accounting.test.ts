import { describe, expect, it } from "vitest";

import { readAccountingConfig } from "./config";
import { evaluateSwapEligibility } from "./eligibility";
import { splitWalletorFee } from "./math";
import { reconcilePoolBalance } from "./reconciliation";
import {
  allocateRoundRewards,
  calculateRewardWeight,
  calculateWltPoints,
  rewardTier,
} from "./rewards";
import {
  canaryContinuationRoundWindow,
  rollingDailyRoundWindow,
  alignedOpenRoundEnd,
  nextRoundWindow,
  roundCloseBoundaryAtOrAfter,
  roundProgressBps,
  utcRoundWindow,
} from "./rounds";

describe("financial accounting rules", () => {
  it("keeps consecutive rolling rounds exactly 24 hours apart across midnight", () => {
    const first = rollingDailyRoundWindow(new Date("2026-09-22T11:12:13.456Z"));
    expect(first.endTime).toBe("2026-09-23T11:12:13.456Z");
    const next = rollingDailyRoundWindow(new Date(first.endTime));
    expect(next.startTime).toBe(first.endTime);
    expect(next.endTime).toBe("2026-09-24T11:12:13.456Z");
    expect(next.roundId).not.toBe(first.roundId);
    expect(
      roundProgressBps(
        Date.parse("2026-09-23T00:00:00.000Z"),
        first.startTime,
        first.endTime,
      ),
    ).toBeLessThan(10_000);
    expect(() => rollingDailyRoundWindow(new Date("invalid"))).toThrow();
  });
  it.each([
    ["2026-09-15T00:00:00.000Z", "2026-09-15T00:00:00.000Z"],
    ["2026-09-14T16:00:00.000Z", "2026-09-15T00:00:00.000Z"],
    ["2026-09-15T00:00:00.000Z", "2026-09-16T00:00:00.000Z"],
  ])(
    "keeps a midnight verification from closing an open round early (%s, %s)",
    (start, event) => {
      expect(
        alignedOpenRoundEnd(start, "2026-09-16T00:00:00.000Z", event, 24),
      ).toBe("2026-09-16T00:00:00.000Z");
    },
  );
  it("does not rewind today's round when an older swap is recovered", () => {
    expect(
      alignedOpenRoundEnd(
        "2026-09-15T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
        "2026-09-11T10:39:00.000Z",
        24,
      ),
    ).toBe("2026-09-16T00:00:00.000Z");
    expect(
      alignedOpenRoundEnd(
        "2026-09-15T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
        "2026-09-15T12:49:22.000Z",
        24,
      ),
    ).toBe("2026-09-16T00:00:00.000Z");
  });
  it("splits a verified fee exactly without floating point", () => {
    expect(splitWalletorFee(100n, 10_000n, 0n)).toEqual({
      verifiedWalletorFeeCents: 100n,
      prizePoolContributionCents: 100n,
      platformRevenueCents: 0n,
    });
    expect(splitWalletorFee(101n, 8_000n, 2_000n)).toEqual({
      verifiedWalletorFeeCents: 101n,
      prizePoolContributionCents: 80n,
      platformRevenueCents: 21n,
    });
  });

  it("assigns exact UTC round boundaries and one progress calculation", () => {
    const beforeMidnight = utcRoundWindow(new Date("2026-07-31T23:59:59.999Z"));
    const atMidnight = utcRoundWindow(new Date("2026-08-01T00:00:00.000Z"));
    expect(beforeMidnight.startTime).toBe("2026-07-31T00:00:00.000Z");
    expect(beforeMidnight.endTime).toBe("2026-08-01T00:00:00.000Z");
    expect(atMidnight.startTime).toBe("2026-08-01T00:00:00.000Z");
    expect(
      roundProgressBps(
        Date.parse("2026-07-31T12:00:00.000Z"),
        beforeMidnight.startTime,
        beforeMidnight.endTime,
      ),
    ).toBe(5_000);
  });

  it("assigns hourly UTC round boundaries for hourly distributions", () => {
    const round = utcRoundWindow(
      new Date("2026-09-07T14:16:54.000Z"),
      undefined,
      1,
    );
    expect(round.startTime).toBe("2026-09-07T14:00:00.000Z");
    expect(round.endTime).toBe("2026-09-07T15:00:00.000Z");
    expect(
      roundProgressBps(
        Date.parse("2026-09-07T14:30:00.000Z"),
        round.startTime,
        round.endTime,
      ),
    ).toBe(5_000);
    expect(
      roundCloseBoundaryAtOrAfter(new Date("2026-09-07T14:16:54.000Z"), 1),
    ).toBe("2026-09-07T15:00:00.000Z");
    expect(
      roundCloseBoundaryAtOrAfter(new Date("2026-09-07T15:00:00.000Z"), 1),
    ).toBe("2026-09-07T15:00:00.000Z");
  });

  it("splits a controlled test round without changing its midnight boundary", () => {
    const active = utcRoundWindow(new Date("2026-09-06T08:30:00.000Z"));
    expect(
      canaryContinuationRoundWindow(
        active,
        new Date("2026-09-06T09:00:00.000Z"),
      ),
    ).toEqual({
      roundId: `${active.roundId}:continuation:2026-09-06T09:00:00.000Z`,
      startTime: "2026-09-06T09:00:00.000Z",
      endTime: "2026-09-07T00:00:00.000Z",
    });
    expect(() =>
      canaryContinuationRoundWindow(
        active,
        new Date("2026-09-07T00:00:00.000Z"),
      ),
    ).toThrow("only inside its active UTC window");
  });

  it("unlocks reward tiers by qualifying-swap count", () => {
    expect(rewardTier(1)).toMatchObject({
      achievedTier: 1,
      multiplierBps: 10_000,
      nextTier: 3,
    });
    expect(rewardTier(3)).toMatchObject({
      achievedTier: 3,
      multiplierBps: 11_000,
      nextTier: 5,
    });
    expect(rewardTier(5)).toMatchObject({
      achievedTier: 5,
      multiplierBps: 12_500,
      nextTier: 10,
    });
    expect(rewardTier(10)).toMatchObject({
      achievedTier: 10,
      multiplierBps: 15_000,
      nextTier: null,
    });
    expect(rewardTier(2)).toMatchObject({
      achievedTier: 1,
      nextTier: 3,
      swapsUntilNextTier: 1,
    });
  });

  it("allocates deterministic rewards and records the rounding remainder", async () => {
    const result = await allocateRoundRewards(100n, [
      {
        walletAddress: "wallet-b",
        eligibleSwapCount: 3,
        eligibleVolumeCents: 10_000n,
        multiplierBps: 11_000,
      },
      {
        walletAddress: "wallet-a",
        eligibleSwapCount: 1,
        eligibleVolumeCents: 2_000n,
        multiplierBps: 10_000,
      },
    ]);
    expect(
      result.allocations.map((allocation) => allocation.walletAddress),
    ).toEqual(["wallet-a", "wallet-b"]);
    expect(result.allocatedCents).toBe(99n);
    expect(result.remainderCents).toBe(1n);
    expect(
      result.allocations.reduce(
        (total, allocation) => total + allocation.rewardCents,
        0n,
      ),
    ).toBeLessThanOrEqual(100n);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("increases reward weight sublinearly when qualifying volume grows", () => {
    const lowerVolumeWeight = calculateRewardWeight(3, 10_000n, 11_000);
    const higherVolumeWeight = calculateRewardWeight(3, 20_000n, 11_000);

    expect(higherVolumeWeight).toBeGreaterThan(lowerVolumeWeight);
    expect(higherVolumeWeight).toBeLessThan(lowerVolumeWeight * 2n);
  });

  it("credits exactly two WLT Points using the backend reward rate", () => {
    const config = readAccountingConfig({
      WLT_BASE_POINTS_PER_ELIGIBLE_SWAP: "2",
    });
    expect(calculateWltPoints(config.wltBasePointsPerEligibleSwap)).toBe(2n);
  });

  it("does not silently enable rewards or payouts when configuration is missing", () => {
    const config = readAccountingConfig({});
    expect(config.enabled).toBe(false);
    expect(config.payoutsEnabled).toBe(false);
    expect(config.prizePoolWinnerCount).toBe(22);
    expect(config.prizePoolClaimFeeBps).toBe(250);
    expect(config.minimumRewardEligibleSwapCents).toBe(500n);
    expect(config.wltBasePointsPerEligibleSwap).toBe(0n);
  });

  it("supports an explicit one-hour Prize Pool cadence", () => {
    expect(
      readAccountingConfig({ ROUND_DURATION_HOURS: "1" }).roundDurationHours,
    ).toBe(1);
    expect(() => readAccountingConfig({ ROUND_DURATION_HOURS: "2" })).toThrow(
      "1, 4, or 24",
    );
  });

  it("supports four-hour windows and preserves history when changing cadence", () => {
    expect(
      readAccountingConfig({ ROUND_DURATION_HOURS: "4" }).roundDurationHours,
    ).toBe(4);
    const poolId = "solana:mainnet:prize-pool";
    const next = nextRoundWindow(
      new Date("2026-09-10T14:00:00.000Z"),
      poolId,
      4,
    );
    expect(next).toEqual({
      roundId: `${poolId}:2026-09-10T14:00:00.000Z`,
      startTime: "2026-09-10T14:00:00.000Z",
      endTime: "2026-09-10T16:00:00.000Z",
    });
    expect(nextRoundWindow(new Date(next.endTime), poolId, 4).endTime).toBe(
      "2026-09-10T20:00:00.000Z",
    );
    expect(
      roundCloseBoundaryAtOrAfter(new Date("2026-09-10T14:30:00.000Z"), 4),
    ).toBe("2026-09-10T16:00:00.000Z");
  });

  it("moves four-hour rounds onto midnight without reusing an earlier round ID", () => {
    const poolId = "solana:mainnet:prize-pool";
    const next = nextRoundWindow(
      new Date("2026-09-14T16:00:00.000Z"),
      poolId,
      24,
    );
    expect(next).toEqual({
      roundId: `${poolId}:2026-09-14T16:00:00.000Z`,
      startTime: "2026-09-14T16:00:00.000Z",
      endTime: "2026-09-15T00:00:00.000Z",
    });
    expect(nextRoundWindow(new Date(next.endTime), poolId, 24).endTime).toBe(
      "2026-09-16T00:00:00.000Z",
    );
    expect(
      roundCloseBoundaryAtOrAfter(new Date("2026-09-14T15:30:00.000Z"), 24),
    ).toBe("2026-09-15T00:00:00.000Z");
  });

  it("validates the immutable-per-round winner policy bounds", () => {
    expect(() =>
      readAccountingConfig({ PRIZE_POOL_WINNER_COUNT: "0" }),
    ).toThrow("between 1 and 100");
    expect(() =>
      readAccountingConfig({ PRIZE_POOL_WINNER_COUNT: "101" }),
    ).toThrow("between 1 and 100");
    expect(() =>
      readAccountingConfig({ PRIZE_POOL_CLAIM_FEE_BPS: "10001" }),
    ).toThrow("must be 250");
    expect(() =>
      readAccountingConfig({ MINIMUM_REWARD_ELIGIBLE_SWAP_USD: "0.00" }),
    ).toThrow("must be greater than zero");
  });

  it("requires an explicit positive point rate before enabling accounting", () => {
    expect(() =>
      readAccountingConfig({
        ACCOUNTING_ENABLED: "true",
        WALLETOR_TREASURY_ADDRESS:
          "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
      }),
    ).toThrow("positive WLT rate");
  });

  it("rejects a negative WLT point credit", () => {
    expect(() => calculateWltPoints(-2n)).toThrow(
      "WLT point inputs are invalid",
    );
  });

  it("requires an exact $5 value for Prize Pool and WLT eligibility", () => {
    const base = {
      finalized: true,
      signerMatches: true,
      swapInstructionPresent: true,
      walletorFeeTransferPresent: true,
      treasuryMatches: true,
      verifiedSwapValueCents: 500n,
      minimumRewardEligibleSwapCents: 500n,
      blockTimeMs: Date.parse("2026-07-31T12:00:00.000Z"),
      roundStartMs: Date.parse("2026-07-31T00:00:00.000Z"),
      roundEndMs: Date.parse("2026-08-01T00:00:00.000Z"),
      walletFirstSeenAtMs: null,
      newWalletReviewDays: 7,
    };
    expect(evaluateSwapEligibility({ ...base, finalized: false }).reason).toBe(
      "NOT_FINALIZED",
    );
    expect(
      evaluateSwapEligibility({ ...base, walletorFeeTransferPresent: false })
        .reason,
    ).toBe("WALLETOR_FEE_MISSING");
    expect(evaluateSwapEligibility(base).eligible).toBe(true);
    expect(
      evaluateSwapEligibility({ ...base, verifiedSwapValueCents: 499n }),
    ).toMatchObject({
      eligible: false,
      reason: "BELOW_MINIMUM_SWAP_VALUE",
    });
    expect(
      evaluateSwapEligibility({ ...base, blockTimeMs: base.blockTimeMs + 1 })
        .eligible,
    ).toBe(true);
  });

  it("gives sub-cent confirmed swaps a minimum nonzero reward weight", () => {
    expect(calculateRewardWeight(1, 0n, 10_000)).toBeGreaterThan(0n);
  });

  it("flags reconciliation mismatches without overwriting either value", () => {
    expect(reconcilePoolBalance(1_000n, 990n, 5n)).toEqual({
      expectedBalanceCents: 1_000n,
      actualBalanceCents: 990n,
      differenceCents: 10n,
      mismatch: true,
      pauseDistributions: true,
    });
  });
});
