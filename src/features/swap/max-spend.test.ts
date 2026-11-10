import { describe, expect, it } from "vitest";

import {
  fractionOfAvailableBalance,
  SOL_MAX_NETWORK_FEE_BUFFER_LAMPORTS,
} from "./max-spend";

describe("fractionOfAvailableBalance", () => {
  it("reserves SOL for fees when the full native balance is selected", () => {
    expect(fractionOfAvailableBalance(95_179_940n, 1n, 1n, true)).toBe(
      95_179_940n - SOL_MAX_NETWORK_FEE_BUFFER_LAMPORTS,
    );
  });

  it("does not subtract the reserve from partial SOL selections", () => {
    expect(fractionOfAvailableBalance(10_000_000n, 1n, 2n, true)).toBe(
      5_000_000n,
    );
  });

  it("does not subtract the SOL reserve from SPL token balances", () => {
    expect(fractionOfAvailableBalance(10_000_000n, 1n, 1n, false)).toBe(
      10_000_000n,
    );
  });

  it("returns zero when the SOL balance cannot cover the reserve", () => {
    expect(fractionOfAvailableBalance(2_000_000n, 1n, 1n, true)).toBe(0n);
  });
});
