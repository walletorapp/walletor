import { describe, expect, it } from "vitest";

import { readSwapRiskConfig } from "./config";

describe("swap risk configuration", () => {
  it("stays disabled unless explicitly enabled and defaults to $5,000", () => {
    expect(readSwapRiskConfig({})).toEqual({
      enabled: false,
      rollingLimitMicroUsd: 5_000_000_000n,
      rollingWindowHours: 24,
    });
  });

  it("accepts an explicit exact-decimal limit", () => {
    expect(
      readSwapRiskConfig({
        WALLET_SWAP_LIMIT_ENABLED: "true",
        WALLET_SWAP_ROLLING_LIMIT_USD: "1250.123456",
      }),
    ).toMatchObject({
      enabled: true,
      rollingLimitMicroUsd: 1_250_123_456n,
    });
  });

  it("rejects zero and excess precision", () => {
    expect(() =>
      readSwapRiskConfig({ WALLET_SWAP_ROLLING_LIMIT_USD: "0" }),
    ).toThrow("must be greater than zero");
    expect(() =>
      readSwapRiskConfig({ WALLET_SWAP_ROLLING_LIMIT_USD: "1.0000001" }),
    ).toThrow("six decimal places");
  });
});
