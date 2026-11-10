import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  ReferralJoinSchema,
  ReferralProofSchema,
} from "../shared/referral-contracts";
import { coordinatorRules, referralCoordinator } from "./accounting/runtime";
import { isSolanaAddress } from "./lib/solana";
import { ApiFailure } from "./lib/http";

export const referralRoutes = new Hono<{ Bindings: Env }>();
referralRoutes.use("*", bodyLimit({ maxSize: 4096 }));
referralRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});
referralRoutes.get("/", async (c) => {
  const wallet = c.req.query("wallet") ?? "";
  if (!isSolanaAddress(wallet))
    throw new ApiFailure(
      400,
      "INVALID_WALLET",
      "Connect a valid Solana wallet.",
      false,
    );
  const stub = await referralCoordinator(c.env);
  return c.json({
    data: await stub.getReferralState(
      wallet,
      new Date().toISOString(),
      coordinatorRules(c.env),
    ),
  });
});
referralRoutes.post("/challenge", async (c) => {
  const input = ReferralJoinSchema.parse(await c.req.json());
  const stub = await referralCoordinator(c.env);
  try {
    return c.json({
      data: await stub.referralChallenge(
        input.walletAddress,
        input.code,
        new Date().toISOString(),
      ),
    });
  } catch {
    throw new ApiFailure(
      400,
      "REFERRAL_NOT_AVAILABLE",
      "This referral cannot be registered. Use a valid link with a new wallet before its first Walletor swap. Self-referrals and replacing an existing referral are not allowed.",
      false,
    );
  }
});
referralRoutes.post("/join", async (c) => {
  const input = ReferralProofSchema.parse(await c.req.json());
  const stub = await referralCoordinator(c.env);
  try {
    await stub.joinReferral(input, new Date().toISOString());
  } catch {
    throw new ApiFailure(
      400,
      "REFERRAL_NOT_AVAILABLE",
      "Referral registration failed. Check the wallet and signature, or request a new message. Existing trading wallets cannot join a referral.",
      false,
    );
  }
  return c.json({ data: { joined: true } });
});
