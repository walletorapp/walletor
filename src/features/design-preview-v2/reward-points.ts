export function formatEarnedWltPoints(
  pointsPerEligibleSwap: string,
  eligibleSwapCount: number,
): string {
  if (
    !/^\d+$/.test(pointsPerEligibleSwap) ||
    !Number.isSafeInteger(eligibleSwapCount) ||
    eligibleSwapCount < 0
  ) {
    throw new Error("WLT reward inputs must be nonnegative integers.");
  }

  return (
    BigInt(pointsPerEligibleSwap) * BigInt(eligibleSwapCount)
  ).toLocaleString("en-US");
}
