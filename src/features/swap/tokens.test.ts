import { describe, expect, it } from "vitest";

import { fromAtomicAmount, toAtomicAmount } from "./tokens";

describe("swap token amounts", () => {
  it("converts decimals without floating-point accounting", () => {
    expect(toAtomicAmount("1.000000001", 9)).toBe("1000000001");
    expect(toAtomicAmount("0.25", 6)).toBe("250000");
    expect(fromAtomicAmount("1000000001", 9)).toBe("1.000000001");
  });

  it("rejects excess precision and invalid values", () => {
    expect(toAtomicAmount("0.0000001", 6)).toBeNull();
    expect(toAtomicAmount("1e3", 6)).toBeNull();
    expect(toAtomicAmount("-1", 6)).toBeNull();
  });
});
