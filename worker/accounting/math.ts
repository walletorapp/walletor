const BPS_DENOMINATOR = 10_000n;

export interface FeeSplit {
  verifiedWalletorFeeCents: bigint;
  prizePoolContributionCents: bigint;
  platformRevenueCents: bigint;
}

export function splitWalletorFee(
  verifiedWalletorFeeCents: bigint,
  prizePoolPercentageBps: bigint,
  platformRevenuePercentageBps: bigint,
): FeeSplit {
  if (verifiedWalletorFeeCents < 0n) {
    throw new Error("Verified Walletor fee cannot be negative.");
  }
  if (
    prizePoolPercentageBps < 0n ||
    platformRevenuePercentageBps < 0n ||
    prizePoolPercentageBps + platformRevenuePercentageBps !== BPS_DENOMINATOR
  ) {
    throw new Error("Fee split percentages must total 10,000 basis points.");
  }

  const prizePoolContributionCents =
    (verifiedWalletorFeeCents * prizePoolPercentageBps) / BPS_DENOMINATOR;
  return {
    verifiedWalletorFeeCents,
    prizePoolContributionCents,
    platformRevenueCents: verifiedWalletorFeeCents - prizePoolContributionCents,
  };
}

export function absoluteDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}
