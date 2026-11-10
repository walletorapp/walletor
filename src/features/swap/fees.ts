import type { SwapOrder } from "../../../shared/swap-contracts";
import { formatBasisPoints, referralFeeBreakdown } from "../../lib/fees";
import { fromAtomicAmount, type SwapToken } from "./tokens";

export interface QuotedSwapFeeAmounts {
  feeTokenSymbol: string;
  total: string;
  walletor: string;
  jupiter: string;
}

export function swapFeeBreakdown(order: SwapOrder) {
  if (!order.referralAccount) return null;
  // Never split gasless/extra execution costs as referral revenue.
  return referralFeeBreakdown(
    order.platformFee?.feeBps ?? null,
    order.walletorPartnerShareBps,
  );
}

export function platformFeeLabel(order: SwapOrder): string {
  if (order.referralAccount) {
    if (order.feeBps !== null) {
      return `${formatBasisPoints(order.feeBps)} total swap fee`;
    }
    return "Total swap fee unavailable";
  }
  const platformBps = order.platformFee?.feeBps;
  if (platformBps !== null && platformBps !== undefined) {
    if (order.feeBps !== null && order.feeBps !== platformBps) {
      return `${formatBasisPoints(platformBps)} platform · ${formatBasisPoints(order.feeBps)} total`;
    }
    return `${formatBasisPoints(platformBps)} platform fee`;
  }
  return order.feeBps !== null
    ? `${formatBasisPoints(order.feeBps)} total swap fee`
    : "Included in quote · rate unavailable";
}

export function additionalExecutionFeeLabel(order: SwapOrder): string | null {
  const referralBps = order.platformFee?.feeBps;
  if (
    !order.referralAccount ||
    order.feeBps === null ||
    referralBps === null ||
    referralBps === undefined ||
    order.feeBps <= referralBps
  ) {
    return null;
  }
  return formatBasisPoints(order.feeBps - referralBps);
}

export function quotedSwapFeeAmounts(
  order: SwapOrder,
  inputToken: Pick<SwapToken, "mint" | "symbol" | "decimals">,
  outputToken: Pick<SwapToken, "mint" | "symbol" | "decimals">,
): QuotedSwapFeeAmounts | null {
  const amount = order.platformFee?.amount;
  const feeMint = order.platformFee?.feeMint;
  const partnerShareBps = order.walletorPartnerShareBps;
  if (
    amount === null ||
    amount === undefined ||
    feeMint === null ||
    feeMint === undefined ||
    partnerShareBps === null ||
    !Number.isSafeInteger(partnerShareBps) ||
    partnerShareBps < 0 ||
    partnerShareBps > 10_000
  ) {
    return null;
  }
  const feeToken =
    feeMint === inputToken.mint
      ? inputToken
      : feeMint === outputToken.mint
        ? outputToken
        : null;
  if (feeToken === null) return null;

  const totalAtomic = BigInt(amount);
  const walletorAtomic = (totalAtomic * BigInt(partnerShareBps)) / 10_000n;
  const jupiterAtomic = totalAtomic - walletorAtomic;
  const display = (value: bigint) =>
    `${fromAtomicAmount(value.toString(), feeToken.decimals)} ${feeToken.symbol}`;

  return {
    feeTokenSymbol: feeToken.symbol,
    total: display(totalAtomic),
    walletor: display(walletorAtomic),
    jupiter: display(jupiterAtomic),
  };
}
