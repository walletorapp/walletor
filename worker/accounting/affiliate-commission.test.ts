import { describe, expect, it } from "vitest";
import {
  PROPOSED_SEGMENTO_POLICY,
  splitAffiliateFee,
} from "./affiliate-commission";

describe("proposed affiliate fee split", () => {
  it("splits $40 received USDC into $4 KOL, $0.40 Segmento and $35.60 pool", () => {
    expect(splitAffiliateFee(40_000_000n, PROPOSED_SEGMENTO_POLICY)).toEqual({
      kolAtomic: 4_000_000n,
      platformAtomic: 400_000n,
      poolAtomic: 35_600_000n,
    });
  });
  it("conserves atomic units and leaves rounding dust in the pool", () => {
    for (const fee of [
      0n,
      1n,
      9n,
      10n,
      99n,
      101n,
      9_007_199_254_740_999_999n,
    ]) {
      const result = splitAffiliateFee(fee, PROPOSED_SEGMENTO_POLICY);
      expect(result.kolAtomic + result.platformAtomic + result.poolAtomic).toBe(
        fee,
      );
      expect(result.poolAtomic).toBeGreaterThanOrEqual(0n);
    }
    expect(splitAffiliateFee(101n, PROPOSED_SEGMENTO_POLICY)).toEqual({
      kolAtomic: 10n,
      platformAtomic: 1n,
      poolAtomic: 90n,
    });
  });
  it("supports no commission without reducing the pool", () => {
    expect(
      splitAffiliateFee(40_000_000n, { kolBps: 0, platformBpsOfKol: 1000 }),
    ).toEqual({
      kolAtomic: 0n,
      platformAtomic: 0n,
      poolAtomic: 40_000_000n,
    });
  });
  it("rejects negative fees, fractional or invalid rates, and over-allocation", () => {
    expect(() => splitAffiliateFee(-1n, PROPOSED_SEGMENTO_POLICY)).toThrow();
    for (const kolBps of [-1, 0.5, NaN, Infinity, 10_001])
      expect(() =>
        splitAffiliateFee(100n, { kolBps, platformBpsOfKol: 1000 }),
      ).toThrow();
    expect(() =>
      splitAffiliateFee(0n, { kolBps: 10_000, platformBpsOfKol: 1 }),
    ).toThrow();
  });
});
