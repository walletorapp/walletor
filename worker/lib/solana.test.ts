import { describe, expect, it } from "vitest";

import { isSolanaAddress, isSolanaSignature } from "./solana";

describe("Solana identifier validation", () => {
  it("accepts 32-byte base58 public keys", () => {
    expect(
      isSolanaAddress("Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh"),
    ).toBe(true);
  });

  it("accepts only 64-byte base58 transaction signatures", () => {
    expect(isSolanaSignature("1".repeat(64))).toBe(true);
    expect(isSolanaSignature("1".repeat(63))).toBe(false);
    expect(isSolanaSignature("not-a-solana-signature")).toBe(false);
  });
});
