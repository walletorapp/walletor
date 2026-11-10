import type {
  JupiterSwapExecutionEvidence,
  JupiterSwapOrderEvidence,
} from "../../shared/accounting-contracts";

const BPS_DENOMINATOR = 10_000n;
const MICRO_USD_PER_USD = 1_000_000n;
const CENTS_PER_USD = 100n;

interface DecimalFraction {
  numerator: bigint;
  denominator: bigint;
}

export interface ExecutedReferralFee {
  totalFeeAmountAtomic: bigint;
  walletorFeeAmountAtomic: bigint;
  totalFeeEstimatedMicroUsd: bigint;
  walletorFeeEstimatedMicroUsd: bigint;
  swapEstimatedUsdCents: bigint;
}

export function usdDecimalToCents(value: string): bigint {
  const valuation = decimalFraction(value);
  return (valuation.numerator * CENTS_PER_USD) / valuation.denominator;
}

function decimalFraction(value: string): DecimalFraction {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("USD valuation must be a nonnegative decimal string.");
  }
  const [whole = "0", fractional = ""] = value.split(".");
  const denominator = 10n ** BigInt(fractional.length);
  return {
    numerator: BigInt(`${whole}${fractional}`),
    denominator,
  };
}

function subtractNonnegative(left: string, right: string): bigint {
  const leftAtomic = BigInt(left);
  const rightAtomic = BigInt(right);
  if (leftAtomic < rightAtomic) {
    throw new Error("Jupiter execution amounts produced a negative fee.");
  }
  return leftAtomic - rightAtomic;
}

export function hasCompleteJupiterExecutionAmounts(
  execution: JupiterSwapExecutionEvidence,
): boolean {
  return (
    execution.inputAmountResult !== null &&
    execution.outputAmountResult !== null &&
    execution.totalInputAmount !== null &&
    execution.totalOutputAmount !== null
  );
}

export function deriveExecutedReferralFee(
  order: JupiterSwapOrderEvidence,
  execution: JupiterSwapExecutionEvidence,
): ExecutedReferralFee {
  if (order.requestId !== execution.requestId) {
    throw new Error("Jupiter execution does not match the registered order.");
  }

  const feeFromFinalizedTransaction =
    execution.verifiedReferralFeeAmountAtomic === null
      ? null
      : BigInt(execution.verifiedReferralFeeAmountAtomic);
  // Once Solana has finalized, the referral account's token-balance delta is
  // the authoritative fee evidence. Swap V2's aggregate execute amounts are
  // useful while confirmation is pending, but they must not override what was
  // actually transferred on-chain.
  const feeFromExecutionAmounts =
    feeFromFinalizedTransaction === null &&
    hasCompleteJupiterExecutionAmounts(execution)
      ? order.feeMint === order.inputMint
        ? subtractNonnegative(
            execution.totalInputAmount ?? "0",
            execution.inputAmountResult ?? "0",
          )
        : order.feeMint === order.outputMint
          ? subtractNonnegative(
              execution.outputAmountResult ?? "0",
              execution.totalOutputAmount ?? "0",
            )
          : (() => {
              throw new Error(
                "Jupiter fee mint is not one of the registered swap assets.",
              );
            })()
      : null;
  const totalFeeAmountAtomic =
    feeFromFinalizedTransaction ?? feeFromExecutionAmounts;
  if (totalFeeAmountAtomic === null) {
    throw new Error(
      "Jupiter execution is awaiting finalized referral-fee evidence.",
    );
  }

  if (totalFeeAmountAtomic <= 0n) {
    throw new Error("Confirmed Jupiter execution did not collect a fee.");
  }

  const walletorFeeAmountAtomic =
    (totalFeeAmountAtomic * BigInt(order.partnerShareBps)) / BPS_DENOMINATOR;
  if (walletorFeeAmountAtomic <= 0n) {
    throw new Error("Confirmed Jupiter fee is below Walletor's atomic share.");
  }

  const valuation = decimalFraction(order.valuationUsdDecimal);
  const valuationAmountAtomic = BigInt(order.valuationAmountAtomic);
  if (valuationAmountAtomic <= 0n || valuation.numerator <= 0n) {
    throw new Error("Registered Jupiter valuation is not positive.");
  }

  const estimatedMicroUsd = (amountAtomic: bigint): bigint =>
    (amountAtomic * valuation.numerator * MICRO_USD_PER_USD) /
    (valuationAmountAtomic * valuation.denominator);

  return {
    totalFeeAmountAtomic,
    walletorFeeAmountAtomic,
    totalFeeEstimatedMicroUsd: estimatedMicroUsd(totalFeeAmountAtomic),
    walletorFeeEstimatedMicroUsd: estimatedMicroUsd(walletorFeeAmountAtomic),
    swapEstimatedUsdCents: usdDecimalToCents(
      order.rewardValuationUsdDecimal ?? order.valuationUsdDecimal,
    ),
  };
}

export function microUsdToCents(value: bigint): bigint {
  if (value < 0n) throw new Error("USD valuation cannot be negative.");
  return value / 10_000n;
}
