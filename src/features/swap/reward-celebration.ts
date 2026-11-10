import type { VerifiedSwapCreditResult } from "../../../shared/accounting-contracts";

export function shouldCelebrateReward(
  receipt: VerifiedSwapCreditResult | null,
): receipt is VerifiedSwapCreditResult {
  return (
    receipt?.rewardEligible === true &&
    !receipt.duplicate &&
    BigInt(receipt.wltPointsCredited) > 0n
  );
}
