export interface MultiplierTier {
  achievedTier: 0 | 1 | 3 | 5 | 10;
  multiplierBps: 10_000 | 11_000 | 12_500 | 15_000;
  nextTier: 1 | 3 | 5 | 10 | null;
  swapsUntilNextTier: number;
}

export const REWARD_TIERS = [
  { swaps: 1, multiplierBps: 10_000 },
  { swaps: 3, multiplierBps: 11_000 },
  { swaps: 5, multiplierBps: 12_500 },
  { swaps: 10, multiplierBps: 15_000 },
] as const;

export interface RewardParticipant {
  walletAddress: string;
  eligibleSwapCount: number;
  eligibleVolumeCents: bigint;
  multiplierBps: number;
}

export interface RewardAllocation {
  walletAddress: string;
  eligibleSwapCount: number;
  eligibleVolumeCents: bigint;
  multiplierBps: number;
  volumeScore: bigint;
  calculatedWeight: bigint;
  shareNumerator: bigint;
  shareDenominator: bigint;
  rewardCents: bigint;
}

export interface RewardAllocationResult {
  allocations: RewardAllocation[];
  allocatedCents: bigint;
  remainderCents: bigint;
  checksum: string;
}

export function rewardTier(eligibleSwapCount: number): MultiplierTier {
  if (!Number.isInteger(eligibleSwapCount) || eligibleSwapCount < 0) {
    throw new Error("Eligible swap count must be a nonnegative integer.");
  }

  let achieved: (typeof REWARD_TIERS)[number] = REWARD_TIERS[0];
  let achievedTier: MultiplierTier["achievedTier"] = 0;
  for (const tier of REWARD_TIERS) {
    if (eligibleSwapCount >= tier.swaps) {
      achieved = tier;
      achievedTier = tier.swaps;
    }
  }

  const next = REWARD_TIERS.find((tier) => tier.swaps > achievedTier) ?? null;
  if (next === null) {
    return {
      achievedTier: 10,
      multiplierBps: 15_000,
      nextTier: null,
      swapsUntilNextTier: 0,
    };
  }

  return {
    achievedTier,
    multiplierBps: achievedTier === 0 ? 10_000 : achieved.multiplierBps,
    nextTier: next.swaps,
    swapsUntilNextTier: Math.max(next.swaps - eligibleSwapCount, 0),
  };
}

export function calculateWltPoints(basePointsPerEligibleSwap: bigint): bigint {
  if (basePointsPerEligibleSwap < 0n) {
    throw new Error("WLT point inputs are invalid.");
  }
  return basePointsPerEligibleSwap;
}

export function logarithmicVolumeScore(eligibleVolumeCents: bigint): bigint {
  if (eligibleVolumeCents < 0n) {
    throw new Error("Eligible volume cannot be negative.");
  }
  // A valid fee-bearing swap can be worth less than one cent after the public
  // USD estimate is rounded to cents. Give that confirmed activity the same
  // minimum score as one cent instead of silently excluding the transaction.
  const scoredVolumeCents =
    eligibleVolumeCents === 0n ? 1n : eligibleVolumeCents;
  let exponent = 0n;
  let powerOfTwo = 1n;
  while (powerOfTwo * 2n <= scoredVolumeCents) {
    powerOfTwo *= 2n;
    exponent += 1n;
  }
  const fractional = ((scoredVolumeCents - powerOfTwo) * 1_024n) / powerOfTwo;
  return (exponent + 1n) * 1_024n + fractional;
}

export function calculateRewardWeight(
  eligibleSwapCount: number,
  eligibleVolumeCents: bigint,
  multiplierBps: number,
): bigint {
  if (
    eligibleSwapCount <= 0 ||
    !Number.isInteger(eligibleSwapCount) ||
    multiplierBps < 10_000
  ) {
    throw new Error("Reward participant inputs are invalid.");
  }
  return (
    BigInt(eligibleSwapCount) *
    BigInt(multiplierBps) *
    logarithmicVolumeScore(eligibleVolumeCents)
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function allocateRoundRewards(
  roundPrizePoolCents: bigint,
  participants: RewardParticipant[],
): Promise<RewardAllocationResult> {
  if (roundPrizePoolCents < 0n) {
    throw new Error("Round Prize Pool cannot be negative.");
  }
  const sorted = [...participants].sort((left, right) =>
    left.walletAddress.localeCompare(right.walletAddress),
  );
  const weighted = sorted.map((participant) => {
    if (
      participant.eligibleSwapCount <= 0 ||
      !Number.isInteger(participant.eligibleSwapCount) ||
      participant.multiplierBps < 10_000 ||
      participant.eligibleVolumeCents < 0n
    ) {
      throw new Error("Reward participant inputs are invalid.");
    }
    return {
      ...participant,
      volumeScore: logarithmicVolumeScore(participant.eligibleVolumeCents),
      calculatedWeight: calculateRewardWeight(
        participant.eligibleSwapCount,
        participant.eligibleVolumeCents,
        participant.multiplierBps,
      ),
    };
  });
  const totalWeight = weighted.reduce(
    (total, participant) => total + participant.calculatedWeight,
    0n,
  );
  if (weighted.length > 0 && totalWeight === 0n) {
    throw new Error("Reward weight cannot be zero when participants exist.");
  }

  const allocations = weighted.map<RewardAllocation>((participant) => ({
    ...participant,
    shareNumerator: participant.calculatedWeight,
    shareDenominator: totalWeight,
    rewardCents:
      totalWeight === 0n
        ? 0n
        : (roundPrizePoolCents * participant.calculatedWeight) / totalWeight,
  }));
  const allocatedCents = allocations.reduce(
    (total, allocation) => total + allocation.rewardCents,
    0n,
  );
  const canonical = allocations
    .map((allocation) =>
      [
        allocation.walletAddress,
        allocation.eligibleSwapCount,
        allocation.eligibleVolumeCents.toString(),
        allocation.multiplierBps,
        allocation.volumeScore.toString(),
        allocation.calculatedWeight.toString(),
        allocation.shareNumerator.toString(),
        allocation.shareDenominator.toString(),
        allocation.rewardCents.toString(),
      ].join(":"),
    )
    .join("\n");
  return {
    allocations,
    allocatedCents,
    remainderCents: roundPrizePoolCents - allocatedCents,
    checksum: await sha256(canonical),
  };
}
