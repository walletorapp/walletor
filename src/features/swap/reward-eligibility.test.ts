import { describe, expect, it } from "vitest";

import type { SwapOrder } from "../../../shared/swap-contracts";
import {
  isBelowMinimumRewardValue,
  rewardValuationUsdDecimal,
  usdDecimalToCents,
} from "./reward-eligibility";

const order = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  feeMint: "So11111111111111111111111111111111111111112",
  inUsdValueDecimal: "5.00",
  outUsdValueDecimal: "4.98",
} as SwapOrder;

describe("swap reward eligibility presentation", () => {
  it("uses the sell-side value even when Jupiter collects its fee from output", () => {
    expect(rewardValuationUsdDecimal(order)).toBe("5.00");
    expect(
      rewardValuationUsdDecimal({ ...order, feeMint: order.outputMint }),
    ).toBe("5.00");
  });

  it("applies an exact inclusive $5.00 minimum without floating point", () => {
    expect(usdDecimalToCents("4.999")).toBe(499n);
    expect(isBelowMinimumRewardValue(order, "5.00")).toBe(false);
    expect(
      isBelowMinimumRewardValue(
        { ...order, inUsdValueDecimal: "4.999" },
        "5.00",
      ),
    ).toBe(true);
  });

  it("falls back to output value only when input valuation is unavailable", () => {
    expect(
      isBelowMinimumRewardValue(
        {
          ...order,
          feeMint: order.outputMint,
          inUsdValueDecimal: null,
          outUsdValueDecimal: "9.55",
        },
        "5.00",
      ),
    ).toBe(false);
  });
});
