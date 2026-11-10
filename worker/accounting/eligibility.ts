export interface EligibilityInput {
  finalized: boolean;
  signerMatches: boolean;
  swapInstructionPresent: boolean;
  walletorFeeTransferPresent: boolean;
  treasuryMatches: boolean;
  verifiedSwapValueCents: bigint;
  minimumRewardEligibleSwapCents: bigint;
  blockTimeMs: number;
  roundStartMs: number;
  roundEndMs: number;
  walletFirstSeenAtMs: number | null;
  newWalletReviewDays: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason:
    | "ELIGIBLE"
    | "NOT_FINALIZED"
    | "SIGNER_MISMATCH"
    | "SWAP_INSTRUCTION_MISSING"
    | "WALLETOR_FEE_MISSING"
    | "TREASURY_MISMATCH"
    | "BELOW_MINIMUM_SWAP_VALUE"
    | "OUTSIDE_ACTIVE_ROUND";
  flagNewWalletForReview: boolean;
}

export function evaluateSwapEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const newWalletThresholdMs = input.newWalletReviewDays * 86_400_000;
  const flagNewWalletForReview =
    input.walletFirstSeenAtMs !== null &&
    input.blockTimeMs - input.walletFirstSeenAtMs < newWalletThresholdMs;
  const reject = (
    reason: Exclude<EligibilityResult["reason"], "ELIGIBLE">,
  ): EligibilityResult => ({ eligible: false, reason, flagNewWalletForReview });

  if (!input.finalized) return reject("NOT_FINALIZED");
  if (!input.signerMatches) return reject("SIGNER_MISMATCH");
  if (!input.swapInstructionPresent) return reject("SWAP_INSTRUCTION_MISSING");
  if (!input.walletorFeeTransferPresent) return reject("WALLETOR_FEE_MISSING");
  if (!input.treasuryMatches) return reject("TREASURY_MISMATCH");
  if (input.verifiedSwapValueCents < input.minimumRewardEligibleSwapCents) {
    return reject("BELOW_MINIMUM_SWAP_VALUE");
  }
  if (
    input.blockTimeMs < input.roundStartMs ||
    input.blockTimeMs >= input.roundEndMs
  ) {
    return reject("OUTSIDE_ACTIVE_ROUND");
  }
  return { eligible: true, reason: "ELIGIBLE", flagNewWalletForReview };
}
