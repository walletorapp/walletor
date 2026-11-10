import { describe, expect, it } from "vitest";

import { formatBasisPoints, referralFeeBreakdown } from "./fees";

describe("fee rate presentation", () => {
  it("shows 50 bps as 0.5% total, with 0.4% Walletor and 0.1% Jupiter", () => {
    expect(referralFeeBreakdown(50, 8000)).toEqual({
      referral: "0.5%",
      walletor: "0.4%",
      jupiter: "0.1%",
    });
  });

  it("preserves fractional basis points and historical rates exactly", () => {
    expect(referralFeeBreakdown(255, 8000)).toEqual({
      referral: "2.55%",
      walletor: "2.04%",
      jupiter: "0.51%",
    });
    expect(referralFeeBreakdown(125, 8001)).toEqual({
      referral: "1.25%",
      walletor: "1.000125%",
      jupiter: "0.249875%",
    });
    expect(referralFeeBreakdown(200, 8000)?.walletor).toBe("1.6%");
  });

  it("does not invent a rate or split when terms are unavailable or invalid", () => {
    expect(formatBasisPoints(null)).toBe("Unavailable");
    expect(referralFeeBreakdown(null, 8000)).toBeNull();
    expect(referralFeeBreakdown(125, null)).toBeNull();
    expect(referralFeeBreakdown(125, 10_001)).toBeNull();
    expect(referralFeeBreakdown(-1, 8000)).toBeNull();
    expect(referralFeeBreakdown(Number.NaN, 8000)).toBeNull();
    expect(formatBasisPoints(0)).toBe("0%");
    expect(formatBasisPoints(100)).toBe("1%");
  });
});
