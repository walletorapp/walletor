import {
  WalletSwapLimitDecisionSchema,
  type WalletSwapLimitDecision,
} from "../../shared/risk-contracts";

const MICRO_USD_PER_USD = 1_000_000n;

function decimalToFraction(value: string): {
  numerator: bigint;
  denominator: bigint;
} {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Swap USD valuation must be a nonnegative decimal string.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}

export function usdDecimalToMicroUsdCeiling(value: string): bigint {
  const fraction = decimalToFraction(value);
  const scaled = fraction.numerator * MICRO_USD_PER_USD;
  return (scaled + fraction.denominator - 1n) / fraction.denominator;
}

export function quotedSwapNotionalMicroUsd(
  inputUsdDecimal: string | null,
  outputUsdDecimal: string | null,
): bigint {
  const valuations = [inputUsdDecimal, outputUsdDecimal]
    .filter((value): value is string => value !== null)
    .map(usdDecimalToMicroUsdCeiling);
  if (valuations.length === 0) {
    throw new Error("The swap quote has no usable USD valuation.");
  }
  return valuations.reduce(
    (highest, value) => (value > highest ? value : highest),
    0n,
  );
}

export function walletSwapLimitDecision(input: {
  usedMicroUsd: bigint;
  requestedMicroUsd: bigint;
  limitMicroUsd: bigint;
}): WalletSwapLimitDecision {
  if (
    input.usedMicroUsd < 0n ||
    input.requestedMicroUsd < 0n ||
    input.limitMicroUsd <= 0n
  ) {
    throw new Error("Wallet swap-limit values are invalid.");
  }
  const projected = input.usedMicroUsd + input.requestedMicroUsd;
  return WalletSwapLimitDecisionSchema.parse({
    allowed: projected <= input.limitMicroUsd,
    reason:
      projected <= input.limitMicroUsd ? "ALLOWED" : "ROLLING_LIMIT_EXCEEDED",
    limitMicroUsd: input.limitMicroUsd.toString(),
    usedMicroUsd: input.usedMicroUsd.toString(),
    requestedMicroUsd: input.requestedMicroUsd.toString(),
    remainingMicroUsd:
      projected >= input.limitMicroUsd
        ? "0"
        : (input.limitMicroUsd - projected).toString(),
    windowHours: 24,
  });
}
