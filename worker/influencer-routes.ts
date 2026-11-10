import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  InfluencerProofSchema,
  InfluencerRequestSchema,
  InfluencerReportQuerySchema,
} from "../shared/influencer-contracts";
import { referralCoordinator } from "./accounting/runtime";
import { ApiFailure } from "./lib/http";

export const influencerRoutes = new Hono<{ Bindings: Partial<Env> }>();
influencerRoutes.use("*", bodyLimit({ maxSize: 4096 }));
influencerRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (c.req.method === "POST") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      throw new ApiFailure(
        403,
        "INFLUENCER_ORIGIN_INVALID",
        "Open the influencer program on Walletor.",
        false,
      );
    if (!c.env.INFLUENCER_RATE_LIMIT)
      throw new ApiFailure(
        503,
        "INFLUENCER_SERVICE_UNAVAILABLE",
        "Influencer registration is temporarily unavailable.",
        true,
      );
    const limit = await c.env.INFLUENCER_RATE_LIMIT.limit({
      key: c.req.header("CF-Connecting-IP") ?? "unknown",
    });
    if (!limit.success) {
      c.header("Retry-After", "60");
      throw new ApiFailure(
        429,
        "INFLUENCER_RATE_LIMITED",
        "Please wait a minute before trying another influencer request.",
        true,
        60,
      );
    }
  }
  await next();
});
influencerRoutes.get("/status", async (c) => {
  const input = InfluencerRequestSchema.omit({ purpose: true }).parse(
    c.req.query(),
  );
  const stub = await referralCoordinator(c.env);
  return c.json({
    data: await stub.influencerStatus(input.walletAddress, input.code),
  });
});
influencerRoutes.get("/profile", async (c) => {
  const wallet = InfluencerRequestSchema.shape.walletAddress.parse(
    c.req.query("wallet"),
  );
  const stub = await referralCoordinator(c.env);
  return c.json({ data: await stub.influencerProfile(wallet) });
});
influencerRoutes.post("/enroll", async (c) => {
  const proof = InfluencerProofSchema.parse(await c.req.json());
  const stub = await referralCoordinator(c.env);
  try {
    return c.json({
      data: await stub.enrollInfluencer(proof, new Date().toISOString()),
    });
  } catch {
    throw new ApiFailure(
      400,
      "INFLUENCER_ENROLLMENT_UNAVAILABLE",
      "Use your own wallet and a fresh enrollment signature to create your influencer link.",
      false,
    );
  }
});
influencerRoutes.post("/challenge", async (c) => {
  const input = InfluencerRequestSchema.parse(await c.req.json());
  const stub = await referralCoordinator(c.env);
  try {
    return c.json({
      data: await stub.influencerChallenge(input, new Date().toISOString()),
    });
  } catch {
    throw new ApiFailure(
      400,
      "INFLUENCER_REFERRAL_UNAVAILABLE",
      "Use your own wallet for enrollment, or a registered creator code for referrals. User referrals must be registered before the wallet's first Walletor order.",
      false,
    );
  }
});
influencerRoutes.post("/join", async (c) => {
  const input = InfluencerProofSchema.parse(await c.req.json());
  const stub = await referralCoordinator(c.env);
  try {
    await stub.joinInfluencer(input, new Date().toISOString());
  } catch {
    throw new ApiFailure(
      400,
      "INFLUENCER_REFERRAL_UNAVAILABLE",
      "Registration failed. Check your signature and registered creator code. Existing referrals and wallets with prior orders cannot be registered again.",
      false,
    );
  }
  return c.json({ data: { joined: true } });
});
influencerRoutes.post("/report", async (c) => {
  const input = z
    .object({
      proof: InfluencerProofSchema,
      query: InfluencerReportQuerySchema,
    })
    .strict()
    .parse(await c.req.json());
  const stub = await referralCoordinator(c.env);
  try {
    return c.json({
      data: await stub.getPrivateInfluencerReport(
        input.proof,
        input.query,
        new Date().toISOString(),
      ),
    });
  } catch {
    throw new ApiFailure(
      400,
      "INFLUENCER_REPORT_UNAVAILABLE",
      "Your earnings report could not be verified. Use your registered influencer wallet and sign a new request.",
      false,
    );
  }
});
