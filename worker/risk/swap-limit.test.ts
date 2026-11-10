import { describe, expect, it } from "vitest";

import {
  quotedSwapNotionalMicroUsd,
  usdDecimalToMicroUsdCeiling,
  walletSwapLimitDecision,
} from "./swap-limit";

describe("rolling wallet swap limit", () => {
  it("uses exact micro-USD and rounds sub-micro values up", () => {
    expect(usdDecimalToMicroUsdCeiling("10.25")).toBe(10_250_000n);
    expect(usdDecimalToMicroUsdCeiling("0.0000001")).toBe(1n);
  });

  it("uses the higher side of the quote as the conservative notional", () => {
    expect(quotedSwapNotionalMicroUsd("499.99", "500.01")).toBe(500_010_000n);
  });

  it("allows exactly $5,000 and rejects one micro-dollar more", () => {
    expect(
      walletSwapLimitDecision({
        usedMicroUsd: 4_000_000_000n,
        requestedMicroUsd: 1_000_000_000n,
        limitMicroUsd: 5_000_000_000n,
      }),
    ).toMatchObject({ allowed: true, remainingMicroUsd: "0" });
    expect(
      walletSwapLimitDecision({
        usedMicroUsd: 4_000_000_001n,
        requestedMicroUsd: 1_000_000_000n,
        limitMicroUsd: 5_000_000_000n,
      }),
    ).toMatchObject({
      allowed: false,
      reason: "ROLLING_LIMIT_EXCEEDED",
    });
  });
});
