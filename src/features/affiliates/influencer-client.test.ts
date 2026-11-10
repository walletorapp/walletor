import { afterEach, expect, it, vi } from "vitest";
import { signInfluencerAction } from "./influencer-client";
import { influencerMessage } from "../../../shared/influencer-contracts";
afterEach(() => {
  vi.unstubAllGlobals();
});
const wallet = "So11111111111111111111111111111111111111112";
const nonce = "00000000-0000-4000-8000-000000000001";
const expiresAt = "2026-10-16T14:05:00.000Z";
it("never asks the wallet to sign an unexpected server-provided message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        data: { nonce, expiresAt, message: "Sign an unrelated operation" },
      }),
    ),
  );
  const sign = vi.fn();
  await expect(
    signInfluencerAction(wallet, "creator", "JOIN", sign),
  ).rejects.toThrow("Unexpected referral signature");
  expect(sign).not.toHaveBeenCalled();
});
it("signs only the explicit domain, wallet, policy and action challenge", async () => {
  const message = influencerMessage(
    { walletAddress: wallet, code: "creator", purpose: "JOIN" },
    nonce,
    expiresAt,
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { nonce, expiresAt, message } }),
      ),
  );
  const sign = vi.fn().mockResolvedValue(new Uint8Array(64).fill(1));
  await expect(
    signInfluencerAction(wallet, "creator", "JOIN", sign),
  ).resolves.toMatchObject({
    walletAddress: wallet,
    code: "creator",
    purpose: "JOIN",
    nonce,
  });
  expect(sign).toHaveBeenCalledWith(new TextEncoder().encode(message));
});
