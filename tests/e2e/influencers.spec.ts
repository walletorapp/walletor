import { expect, test } from "@playwright/test";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import {
  InfluencerStatusSchema,
  InfluencerProfileSchema,
  InfluencerChallengeSchema,
  influencerCode,
} from "../../shared/influencer-contracts";
import { z } from "zod";

test("unknown creator links cannot register or accrue lifetime commissions", async ({
  request,
}) => {
  const walletAddress = Keypair.generate().publicKey.toBase58();
  const input = { walletAddress, code: "unapproved-creator" };
  const response = await request.get(
    `/api/influencers/status?${new URLSearchParams(input)}`,
  );
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(
    z.object({ data: InfluencerStatusSchema }).parse(await response.json())
      .data,
  ).toMatchObject({ approved: false, canJoin: false, joined: false });
  const challenge = await request.post("/api/influencers/challenge", {
    data: { ...input, purpose: "JOIN" },
  });
  expect(challenge.status()).toBe(400);
  const report = await request.post("/api/influencers/report", {
    data: {
      proof: {
        ...input,
        purpose: "REPORT",
        nonce: crypto.randomUUID(),
        signature: "1".repeat(64),
      },
      query: {
        from: "2026-10-16T00:00:00.000Z",
        to: "2026-10-17T00:00:00.000Z",
        after: 0,
      },
    },
  });
  expect(report.status()).toBe(400);
  expect(await report.text()).not.toContain("lifetimeTotals");
});
test("creator portal offers direct onboarding rather than fabricated earnings", async ({
  page,
}) => {
  await page.goto("/influencers");
  await expect(
    page.getByRole("heading", { name: "Influencer earnings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect influencer wallet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lifetime earnings", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("any influencer can create their own verified link without Segmento or an admin CSV", async ({
  request,
}) => {
  const owner = Keypair.generate();
  const walletAddress = owner.publicKey.toBase58();
  const code = influencerCode(walletAddress);
  const initial = await request.get(
    `/api/influencers/profile?wallet=${walletAddress}`,
  );
  expect(
    z.object({ data: InfluencerProfileSchema }).parse(await initial.json()).data
      .registered,
  ).toBe(false);
  const response = await request.post("/api/influencers/challenge", {
    data: { walletAddress, code, purpose: "ENROLL" },
  });
  expect(response.ok()).toBe(true);
  const challenge = z
    .object({ data: InfluencerChallengeSchema })
    .parse(await response.json()).data;
  const proof = {
    walletAddress,
    code,
    purpose: "ENROLL",
    nonce: challenge.nonce,
    signature: bs58.encode(
      ed25519.sign(
        new TextEncoder().encode(challenge.message),
        owner.secretKey.slice(0, 32),
      ),
    ),
  };
  const enrolled = await request.post("/api/influencers/enroll", {
    data: proof,
  });
  expect(enrolled.ok()).toBe(true);
  expect(
    z.object({ data: InfluencerProfileSchema }).parse(await enrolled.json())
      .data,
  ).toMatchObject({
    registered: true,
    referralUrl: `https://walletor.com/?ref=${code}`,
  });
  const replacement = await request.post("/api/influencers/challenge", {
    data: {
      walletAddress: Keypair.generate().publicKey.toBase58(),
      code,
      purpose: "ENROLL",
    },
  });
  expect(replacement.status()).toBe(400);
  const replay = await request.post("/api/influencers/enroll", { data: proof });
  expect(replay.status()).toBe(400);
});
