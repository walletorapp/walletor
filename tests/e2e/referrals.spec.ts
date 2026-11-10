import { expect, test } from "@playwright/test";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import {
  ReferralChallengeSchema,
  ReferralStateSchema,
} from "../../shared/referral-contracts";
import { z } from "zod";

test("Worker persists signed referral registration without rewarding a mere connection", async ({
  request,
}) => {
  const owner = Keypair.generate().publicKey.toBase58();
  const user = Keypair.generate();
  const walletAddress = user.publicKey.toBase58();
  const stateResponse = await request.get(`/api/referrals?wallet=${owner}`);
  expect(stateResponse.ok()).toBe(true);
  const { data } = z
    .object({ data: ReferralStateSchema })
    .parse(await stateResponse.json());
  const repeated = await request.get(`/api/referrals?wallet=${owner}`);
  expect(
    z.object({ data: ReferralStateSchema }).parse(await repeated.json()).data
      .code,
  ).toBe(data.code);
  const challengeResponse = await request.post("/api/referrals/challenge", {
    data: { walletAddress, code: data.code },
  });
  expect(challengeResponse.ok()).toBe(true);
  const challenge = z
    .object({ data: ReferralChallengeSchema })
    .parse(await challengeResponse.json()).data;
  const proof = {
    walletAddress,
    code: data.code,
    nonce: challenge.nonce,
    signature: bs58.encode(
      ed25519.sign(
        new TextEncoder().encode(challenge.message),
        user.secretKey.slice(0, 32),
      ),
    ),
  };
  const forged = await request.post("/api/referrals/join", {
    data: { ...proof, signature: bs58.encode(new Uint8Array(64)) },
  });
  expect(forged.status()).toBe(400);
  expect(
    (await request.post("/api/referrals/join", { data: proof })).ok(),
  ).toBe(true);
  expect(
    (await request.post("/api/referrals/join", { data: proof })).status(),
  ).toBe(400);
  const joinedResponse = await request.get(
    `/api/referrals?wallet=${walletAddress}`,
  );
  const joined = z
    .object({ data: ReferralStateSchema })
    .parse(await joinedResponse.json()).data;
  expect(joined.joined).toBe(true);
  expect(joined.bonusPoints).toBe("0");
});

test("Referral page and Claims placement work without a connected wallet", async ({
  page,
}) => {
  await page.goto("/referal");
  await expect(
    page.getByRole("heading", { name: "Referral", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet to get your link" }),
  ).toBeVisible();
  await page.goto("/claim-rewards");
  const panel = page.getByRole("region", {
    name: "Share Walletor. Earn 100 WLT Points.",
  });
  await expect(panel).toBeAttached();
  await panel.scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("link", { name: "Open your Referral page →" }),
  ).toHaveAttribute("href", "/referal");
  const order = await page.evaluate(() => {
    const referral = document.querySelector(".referral-panel");
    const footer = document.querySelector(".concept-social-footer");
    return (
      !!referral &&
      !!footer &&
      !!(
        referral.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    );
  });
  expect(order).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
