import type { SwapOrder } from "../../../shared/swap-contracts";

export const DEFAULT_MINIMUM_REWARD_USD = "5.00";

export function usdDecimalToCents(value: string): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Reward valuation must be a nonnegative decimal string.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return (BigInt(`${whole}${fraction}`) * 100n) / denominator;
}

export function rewardValuationUsdDecimal(order: SwapOrder): string | null {
  return order.inUsdValueDecimal ?? order.outUsdValueDecimal;
}

export function isBelowMinimumRewardValue(
  order: SwapOrder,
  minimumUsd: string,
): boolean | null {
  const valuation = rewardValuationUsdDecimal(order);
  if (valuation === null) return null;
  return usdDecimalToCents(valuation) < usdDecimalToCents(minimumUsd);
}
