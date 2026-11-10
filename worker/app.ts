import { Hono } from "hono";
import { AffiliateReportQuerySchema } from "../shared/affiliate-report-contracts";
import { getAffiliateReport } from "./accounting/runtime";
import { SeedDepositInputSchema } from "../shared/prize-seed-contracts";
import { confirmPrizeSeed, getPrizeSeed } from "./services/prize-seed";
import { bodyLimit } from "hono/body-limit";
import { referralRoutes } from "./referral-routes";
import { influencerRoutes } from "./influencer-routes";
import { InfluencerReportQuerySchema } from "../shared/influencer-contracts";
import { referralCoordinator } from "./accounting/runtime";
import { supportRoutes } from "./support-routes";
import { leaderboardRoutes } from "./leaderboard-routes";
import { secureHeaders } from "hono/secure-headers";
import { LaunchBoardResponseSchema } from "../shared/launch-contracts";

import {
  AdminCanaryRoundCloseInputSchema,
  AdminBootstrapSchema,
  AdminRuntimeSettingsInputSchema,
} from "../shared/admin-contracts";
import {
  PumpTokenIngestRequestSchema,
  SwapTokenSearchResultSchema,
  type SwapTokenSearchResult,
} from "../shared/contracts";
import {
  SwitchboardRandomnessRevealPrepareInputSchema,
  UsdcClaimBuildInputSchema,
  UsdcClaimConfirmInputSchema,
  UsdcClaimDistributionActivationSchema,
  UsdcClaimDistributionPrepareInputSchema,
  UsdcClaimDistributionStageInputSchema,
} from "../shared/usdc-claim-contracts";
import {
  SwapExecuteRequestSchema,
  SwapMarketSchema,
} from "../shared/swap-contracts";
import {
  beginWalletSwapRiskExecution,
  closeCurrentPrizePoolRoundForCanary,
  creditJupiterSwapExecution,
  deriveVerifiedPrizeDrawWinners,
  getPrizePoolState,
  getAdminUnfundedDraws,
  getPublicPrizeDrawSnapshot,
  getPublicDistributionCalendar,
  getPublicDistributionRound,
  getWalletClaimState,
  getWalletEngineState,
  getAdminLedgerSnapshot,
  reconcileJupiterSwapAccounting,
  recoverJupiterSwapAccounting,
  registerJupiterSwapOrder,
  getFeeReserveReport,
  getQuestlineStatus,
  flushQuestlineCompletions,
  registerWalletSwapRiskQuote,
  settleWalletSwapRiskExecution,
} from "./accounting/runtime";
import { readAccountingConfig } from "./accounting/config";
import { readUsdcClaimConfig } from "./accounting/usdc-claim-config";
import { readRewardsAutomationConfig } from "./accounting/automatic-claim-config";
import { authorizeBearer } from "./lib/auth";
import { requireCloudflareAccess } from "./lib/cloudflare-access";
import { isSolanaAddress } from "./lib/solana";
import { ApiFailure, publicCacheHeaders, requestIdFrom } from "./lib/http";
import { getTokenChartMarket } from "./services/token-chart-market";
import {
  unavailableRwaCountry,
  unavailableRwaJurisdictionResponse,
} from "./lib/jurisdiction";
import {
  getNewTokens,
  getRecentSwapTokens,
  getTokenPrices,
  getTokenDetail,
  getTrending,
  searchTokens,
} from "./services/jupiter";
import {
  executeSwap,
  getSwapOrderWithSubMinimumFallback,
  ReferralFeeUnavailableFailure,
} from "./services/jupiter-swap";
import {
  assertVerifiedRwaPair,
  listRwaAssets,
  readRwaFeatureConfig,
  verifiedRwaAsset,
} from "./services/rwa-registry";
import {
  beginRwaOrderExecution,
  registerRwaOrderPermit,
  settleRwaOrderExecution,
  validateRwaOrderPermit,
} from "./services/rwa-order-permits";
import { getJupiterReferralConfig } from "./services/jupiter-referral";
import {
  listReferralFeeMints,
  recordReferralFeeMintObservation,
  ReferralFeeMintStatusSchema,
  ReferralFeeMintStatusUpdateSchema,
  updateReferralFeeMintStatus,
} from "./services/referral-fee-mints";
import { getWalletBalance } from "./services/solana-balance";
import { getWalletHoldings } from "./services/solana-holdings";
import {
  activateUsdcClaimDistribution,
  buildUsdcClaimTransaction,
  confirmUsdcClaimTransaction,
  getUsdcClaimState,
  prepareUsdcClaimDistribution,
  recoverUsdcClaimDistribution,
  stageUsdcClaimDistribution,
  verifiedPrizeRandomnessValue,
} from "./services/usdc-claims";
import {
  getHeliusTokenMetadata,
  type HeliusTokenMetadata,
} from "./services/helius-assets";
import {
  listRecentLegacyIndexedTokens,
  listRecentIndexedTokens,
  markIndexedTokensUsed,
  mergeTokenResults,
  searchLegacyIndexedTokens,
  searchIndexedTokens,
  upsertHeliusTokenMetadata,
  upsertPumpTokens,
} from "./services/token-index";
import {
  authorizeTokenIngest,
  parseHeliusPumpWebhook,
  validatePumpTokens,
} from "./services/token-ingest";
import {
  getAdminD1Summary,
  getAdminRuntimeSettings,
  listAdminClaimDistributions,
  listAdminAuditEvents,
  recordAdminAuditEvent,
  updateAdminRuntimeSettings,
} from "./services/admin-store";
import { relayAdminSolanaRpc } from "./services/admin-solana-rpc";
import { prepareSwitchboardRandomnessReveal } from "./services/switchboard-randomness";
import { MagicBlockRoundInputSchema } from "../shared/magicblock-randomness";
import {
  assertMagicBlockSnapshot,
  isMagicBlockRound,
  magicBlockStatus,
  magicBlockSettings,
  prepareMagicBlockRequest,
} from "./services/magicblock-randomness";
import { prepareTreasurySetup } from "./services/treasury-setup";
import { ComplianceAdminResponseSchema } from "../shared/compliance-contracts";
import {
  complianceStatus,
  screenedSwapSigners as verifiedSwapSigners,
} from "./compliance/screening";

export const app = new Hono<{
  Bindings: Partial<Env>;
  Variables: { adminEmail: string };
}>();

app.use("/api/*", async (c, next) => {
  const startedAt = performance.now();
  const requestId = requestIdFrom(c);
  c.header("X-Request-Id", requestId);
  await next();
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  c.header("Server-Timing", `app;dur=${String(durationMs)}`);
  console.log(
    JSON.stringify({
      message: "api_request_complete",
      requestId,
      method: c.req.method,
      route: observableRoute(c.req.path),
      status: c.res.status,
      durationMs,
    }),
  );
});
app.use("/api/*", secureHeaders());
app.route("/api/referrals", referralRoutes);
app.route("/api/influencers", influencerRoutes);
app.route("/api/support", supportRoutes);
app.route("/api/leaderboard", leaderboardRoutes);

app.use("/admin/api/*", async (c, next) => {
  const startedAt = performance.now();
  const requestId = requestIdFrom(c);
  c.header("X-Request-Id", requestId);
  const actor = await requireCloudflareAccess(
    c.req.header("Cf-Access-Jwt-Assertion"),
    c.env,
  );
  c.set("adminEmail", actor.email);
  await next();
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  c.header("Server-Timing", `admin;dur=${String(durationMs)}`);
  console.log(
    JSON.stringify({
      message: "admin_request_complete",
      requestId,
      method: c.req.method,
      route: c.req.path,
      status: c.res.status,
      durationMs,
    }),
  );
});
app.use("/admin/api/*", secureHeaders());

app.get("/admin/api/prize-seed", async (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ data: await getPrizeSeed(c.env) });
});
app.post(
  "/admin/api/prize-seed/:action",
  bodyLimit({ maxSize: 1024 }),
  async (c) => {
    c.header("Cache-Control", "private, no-store");
    const origin = c.req.header("Origin");
    if (
      (origin && origin !== new URL(c.req.url).origin) ||
      !c.req.header("Content-Type")?.startsWith("application/json")
    ) {
      throw new ApiFailure(
        403,
        "SEED_REQUEST_DENIED",
        "Use the Walletor Admin reserve controls.",
        false,
      );
    }
    if (c.req.param("action") === "prepare")
      return c.json({ data: await getPrizeSeed(c.env, true) });
    if (c.req.param("action") !== "confirm") return c.notFound();
    const input = SeedDepositInputSchema.safeParse(await c.req.json<unknown>());
    if (!input.success)
      throw new ApiFailure(
        400,
        "SEED_SIGNATURE_INVALID",
        "Enter the full Solana deposit transaction signature.",
        false,
      );
    try {
      return c.json({
        data: await confirmPrizeSeed(c.env, input.data.signature),
      });
    } catch {
      throw new ApiFailure(
        409,
        "SEED_DEPOSIT_NOT_VERIFIED",
        "Reserve not activated. Use a finalized, direct transfer of exactly 700 USDC from another wallet after preparing the reserve. The deposit must remain in the distribution wallet. If already funded, refresh its status; do not send another deposit.",
        true,
      );
    }
  },
);

app.get("/api/compliance/status", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ data: await complianceStatus(c.env) });
});

app.get("/admin/api/compliance", async (c) => {
  if (!c.env.DB)
    throw new ApiFailure(
      503,
      "SCREENING_UNAVAILABLE",
      "Compliance records are unavailable.",
      true,
    );
  const [status, result] = await Promise.all([
    complianceStatus(c.env),
    c.env.DB.prepare(
      `SELECT event_id AS eventId, wallet_address AS walletAddress,
      action, reference, decision, policy_version AS policyVersion,
      source_hash AS sourceHash, created_at AS createdAt
      FROM compliance_events ORDER BY created_at DESC LIMIT 100`,
    ).all(),
  ]);
  c.header("Cache-Control", "private, no-store");
  return c.json(
    ComplianceAdminResponseSchema.parse({
      data: { status, events: result.results },
    }),
  );
});

app.get("/admin/api/treasury/setup", async (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ data: await prepareTreasurySetup(c.env, false) });
});
app.get("/admin/api/treasury/funding-status", async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  const journalExists = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'treasury_operations'",
  ).first<{ name: string }>();
  const [rounds, operations] = await Promise.all([
    c.env.DB.prepare(
      "SELECT round_id, status, last_error FROM automatic_claim_settlements ORDER BY updated_at DESC LIMIT 10",
    ).all(),
    journalExists
      ? c.env.DB.prepare(
          "SELECT round_id, kind, status, signature, output_amount_atomic FROM treasury_operations ORDER BY created_at DESC LIMIT 10",
        ).all()
      : Promise.resolve({ results: [] }),
  ]);
  return c.json({
    data: {
      automaticEnabled: readRewardsAutomationConfig(c.env).enabled,
      rounds: rounds.results,
      operations: operations.results,
    },
  });
});
app.post("/admin/api/treasury/setup/prepare", async (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ data: await prepareTreasurySetup(c.env, true) });
});

app.get("/admin/api/affiliates/segmento/preview", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const query = AffiliateReportQuerySchema.safeParse(c.req.query());
  if (!query.success)
    throw new ApiFailure(
      400,
      "AFFILIATE_REPORT_QUERY_INVALID",
      "Choose valid UTC dates within 31 days, an optional Solana wallet and a page size of 1–100.",
      false,
    );
  if (query.data.wallet && !isSolanaAddress(query.data.wallet))
    throw new ApiFailure(
      400,
      "AFFILIATE_REPORT_WALLET_INVALID",
      "Enter a valid Solana wallet address.",
      false,
    );
  return c.json({ data: await getAffiliateReport(c.env, query.data) });
});

app.get("/admin/api/fee-reserve", async (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ data: await getFeeReserveReport(c.env) });
});

app.get("/admin/api/integrations/questline", async (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ data: await getQuestlineStatus(c.env) });
});

app.get("/admin/api/influencers/report", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const query = InfluencerReportQuerySchema.parse(c.req.query());
  const stub = await referralCoordinator(c.env);
  return c.json({
    data: await stub.getInfluencerReport(query, new Date().toISOString()),
  });
});

app.get("/admin/api/bootstrap", async (c) => {
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  const now = new Date();
  const [ledger, database, settings, auditEvents, claimDistributions] =
    await Promise.all([
      getAdminLedgerSnapshot(c.env),
      getAdminD1Summary(c.env.DB, c.env.TOKEN_DB),
      getAdminRuntimeSettings(c.env.DB),
      listAdminAuditEvents(c.env.DB),
      listAdminClaimDistributions(c.env.DB),
    ]);
  const latestClosedDraws = await getAdminUnfundedDraws(
    c.env,
    claimDistributions
      .filter((distribution) => distribution.status === "ACTIVE")
      .map((distribution) => distribution.roundId),
    now,
  );
  const distributionsByRound = new Map(
    claimDistributions.map((distribution) => [
      distribution.roundId,
      distribution,
    ]),
  );
  const data = AdminBootstrapSchema.parse({
    actor: { email: c.get("adminEmail") },
    ledger,
    database,
    settings,
    auditEvents,
    claimOperations: (() => {
      const config = readUsdcClaimConfig(c.env);
      return {
        payoutsEnabled: config.executionEnabled,
        fundingEnabled: config.fundingEnabled,
        automaticSettlementEnabled: readRewardsAutomationConfig(c.env).enabled,
        network: config.network,
        authorityAddress: config.authorityAddress,
        programId: config.programId,
        mintAddress: config.mintAddress,
        claimFeeBps: config.claimFeeBps,
        ...magicBlockSettings(c.env),
        latestClosedRounds: latestClosedDraws.map((draw) => ({
          ...draw,
          distribution: distributionsByRound.get(draw.roundId) ?? null,
        })),
      };
    })(),
    capabilities: {
      financialRecordsReadOnly: true,
      claimsReadOnly: false,
      runtimeSettingsEditable: true,
    },
    generatedAt: new Date().toISOString(),
  });
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.post("/admin/api/solana-rpc", async (c) => {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    throw new ApiFailure(
      413,
      "ADMIN_SOLANA_RPC_REQUEST_TOO_LARGE",
      "The admin Solana request is too large.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const data = await relayAdminSolanaRpc(c.env, raw);
  c.header("Cache-Control", "private, no-store");
  return c.json(data);
});

app.post(
  "/admin/api/claim-distributions/randomness/reveal/prepare",
  async (c) => {
    const contentLength = Number(c.req.header("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 1_024) {
      throw new ApiFailure(
        413,
        "SWITCHBOARD_RANDOMNESS_REVEAL_REQUEST_TOO_LARGE",
        "The Switchboard randomness reveal request is too large.",
        false,
      );
    }
    const requestText = await c.req.text();
    if (new TextEncoder().encode(requestText).byteLength > 1_024) {
      throw new ApiFailure(
        413,
        "SWITCHBOARD_RANDOMNESS_REVEAL_REQUEST_TOO_LARGE",
        "The Switchboard randomness reveal request is too large.",
        false,
      );
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(requestText) as unknown;
    } catch {
      // The schema below returns the same safe validation error for malformed JSON.
    }
    const parsed = SwitchboardRandomnessRevealPrepareInputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiFailure(
        400,
        "INVALID_SWITCHBOARD_RANDOMNESS_REVEAL",
        "The Switchboard randomness reveal request is invalid.",
        false,
      );
    }
    const data = await prepareSwitchboardRandomnessReveal(
      c.env,
      parsed.data.randomnessAccount,
    );
    c.header("Cache-Control", "private, no-store");
    return c.json({ data, meta: { requestId: requestIdFrom(c) } });
  },
);

app.put("/admin/api/settings", async (c) => {
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  const input: unknown = await c.req.json().catch(() => null);
  const parsed = AdminRuntimeSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiFailure(
      400,
      "INVALID_ADMIN_SETTINGS",
      "Review the operational settings and try again.",
      false,
    );
  }
  const data = await updateAdminRuntimeSettings(
    c.env.DB,
    parsed.data,
    c.get("adminEmail"),
    requestIdFrom(c),
  );
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.post("/admin/api/claim-distributions/recover", async (c) => {
  if (!c.env.DB)
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "The accounting database is unavailable.",
      false,
    );
  const parsed = AdminCanaryRoundCloseInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    throw new ApiFailure(
      400,
      "INVALID_ROUND",
      "Select a valid round to recover.",
      false,
    );
  const data = await recoverUsdcClaimDistribution(
    c.env.DB,
    c.env,
    parsed.data.roundId,
  );
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.post("/admin/api/claim-distributions/stage", async (c) => {
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 250_000) {
    throw new ApiFailure(
      413,
      "CLAIM_MANIFEST_TOO_LARGE",
      "The USDC claim manifest is too large.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = UsdcClaimDistributionStageInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiFailure(
      400,
      "INVALID_USDC_CLAIM_MANIFEST",
      "The USDC claim manifest is invalid.",
      false,
    );
  }
  if (
    parsed.data.manifest.magicblock ||
    isMagicBlockRound(c.env, parsed.data.manifest.roundId)
  ) {
    await assertMagicBlockSnapshot(
      c.env,
      await getPublicPrizeDrawSnapshot(
        c.env,
        parsed.data.manifest.roundId,
        0,
        1,
      ),
    );
  }
  const verifiedDraw = await deriveVerifiedPrizeDrawWinners(
    c.env,
    parsed.data.manifest.roundId,
    parsed.data.manifest.randomnessValue,
  );
  const staged = await stageUsdcClaimDistribution(
    c.env.DB,
    c.env,
    parsed.data.preparationId,
    parsed.data.manifest,
    {
      roundId: parsed.data.manifest.roundId,
      grossPrizeAmountAtomic: (
        BigInt(verifiedDraw.grossPoolCents) * 10_000n
      ).toString(),
      winners: verifiedDraw.winners,
      algorithmVersion: verifiedDraw.algorithmVersion,
    },
    c.get("adminEmail"),
    requestIdFrom(c),
  );
  let data = staged;
  try {
    data = await activateUsdcClaimDistribution(
      c.env.DB,
      c.env,
      staged.roundId,
      staged.manifestChecksum,
      "automation@walletor.com",
      `${requestIdFrom(c)}:automatic-activation`,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "automatic_claim_activation_deferred",
        requestId: requestIdFrom(c),
        roundId: staged.roundId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.use(
  "/admin/api/claim-distributions/magicblock/*",
  bodyLimit({ maxSize: 1024 }),
);
app.post("/admin/api/claim-distributions/magicblock/:action", async (c) => {
  const action = c.req.param("action");
  if (action !== "prepare" && action !== "status")
    throw new ApiFailure(
      404,
      "NOT_FOUND",
      "Unknown randomness operation.",
      false,
    );
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = MagicBlockRoundInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new ApiFailure(
      400,
      "INVALID_ROUND",
      "A valid locked round ID is required.",
      false,
    );
  const data =
    action === "prepare"
      ? await prepareMagicBlockRequest(
          c.env,
          await getPublicPrizeDrawSnapshot(c.env, parsed.data.roundId, 0, 1),
          c.get("adminEmail"),
        )
      : await magicBlockStatus(c.env, parsed.data.roundId);
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.post("/admin/api/claim-distributions/prepare", async (c) => {
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    throw new ApiFailure(
      413,
      "CLAIM_PREPARATION_TOO_LARGE",
      "The USDC claim preparation request is too large.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = UsdcClaimDistributionPrepareInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiFailure(
      400,
      "INVALID_USDC_CLAIM_PREPARATION",
      "The USDC claim preparation request is invalid.",
      false,
    );
  }
  const randomnessValue = await verifiedPrizeRandomnessValue(
    c.env,
    parsed.data,
  );
  if (isMagicBlockRound(c.env, parsed.data.roundId)) {
    await assertMagicBlockSnapshot(
      c.env,
      await getPublicPrizeDrawSnapshot(c.env, parsed.data.roundId, 0, 1),
    );
  }
  const verifiedDraw = await deriveVerifiedPrizeDrawWinners(
    c.env,
    parsed.data.roundId,
    randomnessValue,
  );
  const data = await prepareUsdcClaimDistribution(
    c.env.DB,
    c.env,
    parsed.data,
    {
      grossPrizeAmountAtomic: (
        BigInt(verifiedDraw.grossPoolCents) * 10_000n
      ).toString(),
      winners: verifiedDraw.winners,
      randomnessValue,
      algorithmVersion: verifiedDraw.algorithmVersion,
    },
    c.get("adminEmail"),
    requestIdFrom(c),
  );
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.post("/admin/api/claim-distributions/test-round/close", async (c) => {
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  if (!readUsdcClaimConfig(c.env).executionEnabled) {
    throw new ApiFailure(
      409,
      "PAYOUT_EXECUTION_DISABLED",
      "The mainnet claim gate is not enabled.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = AdminCanaryRoundCloseInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiFailure(
      400,
      "INVALID_CANARY_ROUND",
      "Refresh Walletor Admin and select the active round.",
      false,
    );
  }
  const requestId = requestIdFrom(c);
  const actorEmail = c.get("adminEmail");
  const data = await closeCurrentPrizePoolRoundForCanary(
    c.env,
    parsed.data.roundId,
  );
  try {
    await recordAdminAuditEvent(c.env.DB, {
      requestId,
      roundId: data.closedRoundId,
      actorEmail,
      action: "CLOSE_CANARY_PRIZE_ROUND",
      entityType: "PRIZE_POOL_ROUND",
      entityId: data.closedRoundId,
      details: data,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "canary_round_audit_write_failed",
        requestId,
        roundId: data.closedRoundId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId } });
});

app.post("/admin/api/claim-distributions/:roundId/activate", async (c) => {
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "ADMIN_DATABASE_NOT_CONFIGURED",
      "Walletor Admin cannot reach the Cloudflare D1 database.",
      false,
    );
  }
  const roundId = c.req.param("roundId");
  if (!/^[a-z0-9:.-]{1,160}$/i.test(roundId)) {
    throw new ApiFailure(
      400,
      "INVALID_PRIZE_DRAW_ROUND",
      "Enter a valid Prize Draw round identifier.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = UsdcClaimDistributionActivationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiFailure(
      400,
      "INVALID_USDC_CLAIM_ACTIVATION",
      "The USDC claim activation request is invalid.",
      false,
    );
  }
  const data = await activateUsdcClaimDistribution(
    c.env.DB,
    c.env,
    roundId,
    parsed.data.manifestChecksum,
    c.get("adminEmail"),
    requestIdFrom(c),
  );
  c.header("Cache-Control", "private, no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.get("/api/health", (c) =>
  c.json({
    data: { status: "ok", service: "walletor-api" },
    meta: { requestId: requestIdFrom(c) },
  }),
);

app.get("/api/prize-pool", async (c) => {
  const data = await getPrizePoolState(c.env);
  c.header("Cache-Control", "no-store");
  return c.json({
    data,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/prize-pool/distributions", async (c) => {
  const month = c.req.query("month") ?? null;
  if (month !== null && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new ApiFailure(
      400,
      "INVALID_DISTRIBUTION_MONTH",
      "Enter a valid UTC calendar month in YYYY-MM format.",
      false,
    );
  }
  const data = await getPublicDistributionCalendar(c.env, month);
  c.header("Cache-Control", publicCacheHeaders(15)["Cache-Control"]);
  return c.json({
    data,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/prize-pool/distributions/:roundId", async (c) => {
  const roundId = c.req.param("roundId");
  if (!/^[a-z0-9:.-]{1,160}$/i.test(roundId)) {
    throw new ApiFailure(
      400,
      "INVALID_DISTRIBUTION_ROUND",
      "Enter a valid Prize Pool round identifier.",
      false,
    );
  }
  const offset = parseBoundedInteger(c.req.query("offset"), 0, 0, 100_000);
  const limit = parseBoundedInteger(c.req.query("limit"), 50, 1, 100);
  const data = await getPublicDistributionRound(c.env, roundId, offset, limit);
  c.header("Cache-Control", publicCacheHeaders(15)["Cache-Control"]);
  return c.json({
    data,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/prize-pool/draws/:roundId", async (c) => {
  const roundId = c.req.param("roundId");
  if (!/^[a-z0-9:.-]{1,160}$/i.test(roundId)) {
    throw new ApiFailure(
      400,
      "INVALID_PRIZE_DRAW_ROUND",
      "Enter a valid Prize Draw round identifier.",
      false,
    );
  }
  const offset = parseBoundedInteger(c.req.query("offset"), 0, 0, 100_000);
  const limit = parseBoundedInteger(c.req.query("limit"), 50, 1, 100);
  const data = await getPublicPrizeDrawSnapshot(c.env, roundId, offset, limit);
  c.header("Cache-Control", publicCacheHeaders(15)["Cache-Control"]);
  return c.json({
    data,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/wallets/:address/engine", async (c) => {
  const walletAddress = c.req.param("address");
  if (!isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Connect a valid Solana wallet to view Walletor Engine activity.",
      false,
    );
  }
  const data = await getWalletEngineState(c.env, walletAddress);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    data,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/wallets/:address/claims", async (c) => {
  const walletAddress = c.req.param("address");
  if (!isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Connect a valid Solana wallet to review claim rewards.",
      false,
    );
  }
  const data = await getWalletClaimState(c.env, walletAddress);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    data,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/wallets/:address/solana-claims", async (c) => {
  const walletAddress = c.req.param("address");
  const data = await getUsdcClaimState(c.env, walletAddress);
  c.header("Cache-Control", "private, no-store");
  return c.json({
    data,
    meta: {
      source: "solana" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.post("/api/solana-claims/build", async (c) => {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    throw new ApiFailure(
      413,
      "CLAIM_REQUEST_TOO_LARGE",
      "The claim request is too large.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const input = UsdcClaimBuildInputSchema.safeParse(raw);
  if (!input.success) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_CLAIM",
      "The Solana claim request is invalid.",
      false,
    );
  }
  const data = await buildUsdcClaimTransaction(
    c.env,
    input.data.walletAddress,
    input.data.entitlementId,
  );
  c.header("Cache-Control", "no-store");
  return c.json({
    data,
    meta: {
      source: "solana" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.post("/api/solana-claims/submit", async (c) => {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 12_000) {
    throw new ApiFailure(
      413,
      "CLAIM_REQUEST_TOO_LARGE",
      "The signed claim request is too large.",
      false,
    );
  }
  const raw: unknown = await c.req.json().catch(() => null);
  const input = UsdcClaimConfirmInputSchema.safeParse(raw);
  if (!input.success) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_CLAIM",
      "The signed Solana claim request is invalid.",
      false,
    );
  }
  const data = await confirmUsdcClaimTransaction(c.env, input.data);
  c.header("Cache-Control", "no-store");
  return c.json({
    data,
    meta: {
      source: "solana" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/tokens/trending", async (c) => {
  const data = await getTrending(c.env.JUPITER_API_KEY);
  c.header("Cache-Control", publicCacheHeaders(20)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({ data, meta: marketMeta(requestIdFrom(c)) });
});

app.get("/api/tokens/new", async (c) => {
  const data = await getNewTokens(c.env.JUPITER_API_KEY);
  c.header("Cache-Control", publicCacheHeaders(30)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({ data, meta: marketMeta(requestIdFrom(c)) });
});

app.get("/api/tokens/search", async (c) => {
  const query = c.req.query("q") ?? "";
  const normalizedQuery = query.trim();
  const exactMint = isSolanaAddress(normalizedQuery) ? normalizedQuery : null;
  const [jupiterResult, indexedResult, legacyResult, heliusResult] =
    await Promise.allSettled([
      searchTokens(query, c.env.JUPITER_API_KEY),
      c.env.TOKEN_DB
        ? searchIndexedTokens(c.env.TOKEN_DB, query)
        : Promise.resolve([]),
      c.env.DB
        ? searchLegacyIndexedTokens(c.env.DB, query)
        : Promise.resolve([]),
      exactMint
        ? getHeliusTokenMetadata(exactMint, c.env.HELIUS_API_KEY)
        : Promise.resolve(null),
    ]);
  const jupiter = settledTokenResults(jupiterResult, "jupiter_token_search");
  const indexed = settledTokenResults(indexedResult, "indexed_token_search");
  const legacy = settledTokenResults(
    legacyResult,
    "legacy_indexed_token_search",
  );
  const heliusMetadata =
    heliusResult.status === "fulfilled" ? heliusResult.value : null;
  const heliusToken = heliusMetadata
    ? heliusMetadataToSearchResult(heliusMetadata)
    : null;
  if (
    jupiterResult.status === "rejected" &&
    indexed.length === 0 &&
    legacy.length === 0 &&
    heliusToken === null
  ) {
    throw jupiterResult.reason;
  }
  const merged = mergeTokenResults(jupiter, [...legacy, ...indexed]);
  const data = (
    heliusToken && !merged.some((token) => token.address === exactMint)
      ? [heliusToken, ...merged]
      : merged
  ).map((token) =>
    exactMint && token.address === exactMint
      ? {
          ...token,
          logoUrl: heliusMetadata?.logoUrl ?? token.logoUrl,
        }
      : token,
  );
  if (exactMint && c.env.TOKEN_DB) {
    await updateTokenRetentionSafely(
      c.env.TOKEN_DB,
      exactMint,
      heliusMetadata,
      indexed.some((token) => token.address === exactMint),
      requestIdFrom(c),
    );
  }
  c.header("Cache-Control", publicCacheHeaders(10)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({
    data,
    meta: marketMeta(requestIdFrom(c), "walletor-token-index"),
  });
});

app.get("/api/tokens/launches", async (c) => {
  if (!c.env.LAUNCH_FEED)
    throw new ApiFailure(
      503,
      "LAUNCH_FEED_UNAVAILABLE",
      "Launch discovery is temporarily unavailable.",
      true,
    );
  const feed = c.env.LAUNCH_FEED.get(
    c.env.LAUNCH_FEED.idFromName("pumpfun-mainnet"),
  );
  const data = await feed.snapshot();
  c.header("Cache-Control", "no-store");
  return c.json(LaunchBoardResponseSchema.parse({ data }));
});

app.get("/api/tokens/discovery", async (c) => {
  const source = c.req.query("source") ?? "all";
  if (source !== "all" && source !== "pumpfun") {
    throw new ApiFailure(
      400,
      "INVALID_TOKEN_SOURCE",
      "Token discovery source must be all or pumpfun.",
      false,
    );
  }
  const [jupiterResult, indexedResult, legacyResult] = await Promise.allSettled(
    [
      source === "all"
        ? getRecentSwapTokens(c.env.JUPITER_API_KEY)
        : Promise.resolve([]),
      c.env.TOKEN_DB
        ? listRecentIndexedTokens(c.env.TOKEN_DB, source)
        : Promise.resolve([]),
      c.env.DB
        ? listRecentLegacyIndexedTokens(c.env.DB, source)
        : Promise.resolve([]),
    ],
  );
  const jupiter = settledTokenResults(jupiterResult, "jupiter_recent_tokens");
  const indexed = settledTokenResults(indexedResult, "indexed_recent_tokens");
  const legacy = settledTokenResults(
    legacyResult,
    "legacy_indexed_recent_tokens",
  );
  if (
    source === "all" &&
    jupiterResult.status === "rejected" &&
    indexed.length === 0 &&
    legacy.length === 0
  ) {
    throw jupiterResult.reason;
  }
  const data = mergeTokenResults(jupiter, [...legacy, ...indexed], 50);
  c.header("Cache-Control", publicCacheHeaders(10)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({
    data,
    meta: marketMeta(requestIdFrom(c), "walletor-token-index"),
  });
});

app.post("/api/internal/tokens/pumpfun", async (c) => {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 200_000) {
    throw new ApiFailure(
      413,
      "REQUEST_TOO_LARGE",
      "The token ingestion payload is too large.",
      false,
    );
  }
  await authorizeTokenIngest(
    c.req.header("authorization"),
    c.env.TOKEN_INGEST_SECRET,
  );
  if (!c.env.TOKEN_DB) {
    throw new ApiFailure(
      503,
      "TOKEN_INDEX_NOT_CONFIGURED",
      "The token index database is not configured.",
      false,
    );
  }
  const input: unknown = await c.req.json().catch(() => null);
  const parsed = PumpTokenIngestRequestSchema.safeParse(input);
  const tokens = parsed.success
    ? validatePumpTokens(parsed.data.tokens)
    : parseHeliusPumpWebhook(input);
  if (tokens === null) {
    throw new ApiFailure(
      400,
      "INVALID_PUMP_TOKEN_EVENT",
      "The Pump.fun token event has an invalid shape.",
      false,
    );
  }
  const accepted = await upsertPumpTokens(c.env.TOKEN_DB, tokens);
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      data: { accepted },
      meta: { requestId: requestIdFrom(c) },
    },
    200,
  );
});

app.get("/api/internal/referral-fee-mints", async (c) => {
  const db = await authorizeReferralAdmin(c);
  const status = ReferralFeeMintStatusSchema.safeParse(
    c.req.query("status") ?? "PENDING",
  );
  if (!status.success) {
    throw new ApiFailure(
      400,
      "INVALID_REFERRAL_FEE_MINT_STATUS",
      "Choose a valid referral fee-mint status.",
      false,
    );
  }
  const data = await listReferralFeeMints(db, status.data);
  c.header("Cache-Control", "no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.post("/api/internal/referral-fee-mints/:mint/status", async (c) => {
  const db = await authorizeReferralAdmin(c);
  const input: unknown = await c.req.json().catch(() => null);
  const update = ReferralFeeMintStatusUpdateSchema.safeParse(input);
  if (!update.success) {
    throw new ApiFailure(
      400,
      "INVALID_REFERRAL_FEE_MINT_UPDATE",
      "The referral fee-mint status update is invalid.",
      false,
    );
  }
  const data = await updateReferralFeeMintStatus(
    db,
    c.req.param("mint"),
    update.data,
  );
  c.header("Cache-Control", "no-store");
  return c.json({ data, meta: { requestId: requestIdFrom(c) } });
});

app.get("/api/prices", async (c) => {
  const data = await getTokenPrices(
    (c.req.query("ids") ?? "").split(",").filter(Boolean),
    c.env.JUPITER_API_KEY,
  );
  c.header("Cache-Control", publicCacheHeaders(10)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({ data, meta: marketMeta(requestIdFrom(c)) });
});

app.get("/api/rwa/assets", async (c) => {
  const unavailableCountry = unavailableRwaCountry(c.req.raw);
  if (unavailableCountry) {
    return unavailableRwaJurisdictionResponse(c.req.raw, unavailableCountry);
  }
  const features = readRwaFeatureConfig(c.env);
  const assets = await listRwaAssets(c.env);
  c.header("Cache-Control", publicCacheHeaders(10)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({
    data: {
      stocksEnabled: features.stocksEnabled,
      tradingEnabled: features.tradingEnabled,
      jupiterzRouteBadgeEnabled: features.jupiterzRouteBadgeEnabled,
      assets,
    },
    meta: {
      source: "walletor-rwa-registry" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/tokens/:address/chart-market", async (c) => {
  const data = await getTokenChartMarket(c.req.param("address"));
  c.header("Cache-Control", publicCacheHeaders(30)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({
    data,
    meta: {
      source: "dexscreener" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/tokens/:address", async (c) => {
  const address = c.req.param("address");
  if (!isSolanaAddress(address)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Enter a valid Solana token mint address.",
      false,
    );
  }
  const data = await getTokenDetail(address, c.env.JUPITER_API_KEY);
  c.header("Cache-Control", publicCacheHeaders(20)["Cache-Control"]);
  c.header("Vary", "Accept-Encoding");
  return c.json({ data, meta: marketMeta(requestIdFrom(c)) });
});

app.get("/api/swap/order", async (c) => {
  const taker = c.req.query("taker");
  const inputMint = c.req.query("inputMint") ?? "";
  const outputMint = c.req.query("outputMint") ?? "";
  const parsedMarket = SwapMarketSchema.safeParse(
    c.req.query("market") ?? "crypto",
  );
  if (!parsedMarket.success) {
    throw new ApiFailure(
      400,
      "INVALID_SWAP_MARKET",
      "Choose either the crypto or Stocks (RWA) market.",
      false,
    );
  }
  const market = parsedMarket.data;
  const pairIncludesVerifiedRwa = Boolean(
    verifiedRwaAsset(inputMint) ?? verifiedRwaAsset(outputMint),
  );
  const unavailableCountry = unavailableRwaCountry(c.req.raw);
  if ((market === "rwa" || pairIncludesVerifiedRwa) && unavailableCountry) {
    return unavailableRwaJurisdictionResponse(c.req.raw, unavailableCountry);
  }
  if (market !== "rwa" && pairIncludesVerifiedRwa) {
    throw new ApiFailure(
      400,
      "RWA_MARKET_REQUIRED",
      "Verified tokenized stocks must use Walletor's dedicated Stocks (RWA) market.",
      false,
    );
  }
  const rwaFeatures = readRwaFeatureConfig(c.env);
  if (market === "rwa") {
    assertVerifiedRwaPair(c.env, inputMint, outputMint);
  }
  const referral =
    market === "crypto"
      ? (getJupiterReferralConfig(c.env) ?? undefined)
      : undefined;
  let resolution: Awaited<
    ReturnType<typeof getSwapOrderWithSubMinimumFallback>
  >;
  try {
    resolution = await getSwapOrderWithSubMinimumFallback(
      {
        market,
        inputMint,
        outputMint,
        amount: c.req.query("amount") ?? "",
        taker,
        referral,
      },
      readAccountingConfig(c.env).minimumRewardEligibleSwapCents,
      c.env.JUPITER_API_KEY,
    );
  } catch (error) {
    if (
      error instanceof ReferralFeeUnavailableFailure &&
      error.feeMint !== null &&
      referral &&
      c.env.DB
    ) {
      await observeReferralFeeMintSafely(c.env.DB, {
        mint: error.feeMint,
        referralAccount: referral.account,
        inputMint,
        outputMint,
        configuredFeeBps: referral.feeBps,
        observedPlatformFeeBps: null,
        feeApplied: false,
      });
    }
    throw error;
  }
  const data = resolution.order;
  if (data.transaction && !taker) {
    throw new ApiFailure(
      400,
      "SWAP_WALLET_REQUIRED",
      "Connect a wallet before preparing a transaction.",
      false,
    );
  }
  if (c.env.TOKEN_DB) {
    await markSwapPairUsedSafely(
      c.env.TOKEN_DB,
      inputMint,
      outputMint,
      requestIdFrom(c),
    );
  }
  const referralApplied = Boolean(
    referral &&
    !resolution.usedSubMinimumFallback &&
    data.referralAccount === referral.account &&
    data.platformFee?.feeBps === referral.feeBps,
  );
  if (
    resolution.usedSubMinimumFallback &&
    resolution.unavailableReferralFeeMint !== null &&
    referral &&
    c.env.DB
  ) {
    await observeReferralFeeMintSafely(c.env.DB, {
      mint: resolution.unavailableReferralFeeMint,
      referralAccount: referral.account,
      inputMint,
      outputMint,
      configuredFeeBps: referral.feeBps,
      observedPlatformFeeBps: null,
      feeApplied: false,
    });
  }
  if (referralApplied && referral && data.feeMint !== null && c.env.DB) {
    await observeReferralFeeMintSafely(c.env.DB, {
      mint: data.feeMint,
      referralAccount: referral.account,
      inputMint,
      outputMint,
      configuredFeeBps: referral.feeBps,
      observedPlatformFeeBps: data.platformFee?.feeBps ?? null,
      feeApplied: true,
    });
  }
  if (taker) {
    await registerWalletSwapRiskQuote(c.env, data, taker);
  }
  if (taker && market === "rwa" && data.transaction) {
    if (!c.env.DB) {
      throw new ApiFailure(
        503,
        "RWA_ORDER_STORE_NOT_CONFIGURED",
        "Stocks (RWA) order protection is not configured.",
        false,
      );
    }
    await registerRwaOrderPermit(c.env.DB, data, taker);
  }
  if (
    taker &&
    referralApplied &&
    (market === "crypto" || rwaFeatures.rewardsEnabled)
  ) {
    await registerJupiterSwapOrder(
      c.env,
      data,
      taker,
      new Date(),
      c.req.query("questline") === "89" ? 89 : undefined,
    );
  }
  c.header("Cache-Control", "no-store");
  return c.json({ data, meta: marketMeta(requestIdFrom(c)) });
});

app.get("/api/wallet/balance", async (c) => {
  const owner = c.req.query("owner") ?? "";
  const inputMint = c.req.query("inputMint") ?? "";
  if (!isSolanaAddress(owner) || !isSolanaAddress(inputMint)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "The wallet owner and selected token mint must be valid Solana addresses.",
      false,
    );
  }
  const data = await getWalletBalance(owner, inputMint, {
    heliusApiKey: c.env.HELIUS_API_KEY,
  });
  c.header("Cache-Control", "no-store");
  return c.json({
    data,
    meta: {
      source: "solana" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.get("/api/wallet/holdings", async (c) => {
  const owner = c.req.query("owner") ?? "";
  if (!isSolanaAddress(owner)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "The wallet owner must be a valid Solana address.",
      false,
    );
  }
  const data = await getWalletHoldings(owner, {
    heliusApiKey: c.env.HELIUS_API_KEY,
  });
  c.header("Cache-Control", "no-store");
  return c.json({
    data,
    meta: {
      source: "solana-helius" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.post("/api/swap/execute", async (c) => {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 150_000) {
    throw new ApiFailure(
      413,
      "REQUEST_TOO_LARGE",
      "The signed transaction payload is too large.",
      false,
    );
  }
  const input: unknown = await c.req.json().catch(() => null);
  const parsedRequest = SwapExecuteRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    throw new ApiFailure(
      400,
      "INVALID_SIGNED_TRANSACTION",
      "The signed Jupiter transaction is invalid.",
      false,
    );
  }
  const request = parsedRequest.data;
  const unavailableCountry = unavailableRwaCountry(c.req.raw);
  if (request.market === "rwa" && unavailableCountry) {
    return unavailableRwaJurisdictionResponse(c.req.raw, unavailableCountry);
  }
  // Validate wallet ownership independently of sanctions-source availability.
  verifiedSwapSigners(request.signedTransaction, request.taker);
  const rwaFeatures = readRwaFeatureConfig(c.env);
  if (request.market === "rwa") {
    if (!rwaFeatures.stocksEnabled || !rwaFeatures.tradingEnabled) {
      throw new ApiFailure(
        503,
        "RWA_TRADING_NOT_ENABLED",
        "Stocks (RWA) trading is in a controlled rollout and is not enabled yet.",
        false,
      );
    }
    if (!c.env.DB) {
      throw new ApiFailure(
        503,
        "RWA_ORDER_STORE_NOT_CONFIGURED",
        "Stocks (RWA) order protection is not configured.",
        false,
      );
    }
    await validateRwaOrderPermit(c.env.DB, request.requestId, request.taker);
  }
  await beginWalletSwapRiskExecution(c.env, request.requestId, request.taker);
  if (request.market === "rwa" && c.env.DB && request.taker) {
    try {
      await beginRwaOrderExecution(c.env.DB, request.requestId, request.taker);
    } catch (error) {
      await settleWalletSwapRiskExecution(
        c.env,
        request.requestId,
        request.taker,
        false,
      );
      throw error;
    }
  }
  let execution: Awaited<ReturnType<typeof executeSwap>>;
  try {
    execution = await executeSwap(input, c.env.JUPITER_API_KEY);
  } catch (error) {
    const failedSettlements: Promise<void>[] = [
      settleWalletSwapRiskExecution(
        c.env,
        request.requestId,
        request.taker,
        false,
      ),
    ];
    if (request.market === "rwa" && c.env.DB) {
      failedSettlements.push(
        settleRwaOrderExecution(c.env.DB, request.requestId, false, null),
      );
    }
    const outcomes = await Promise.allSettled(failedSettlements);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        console.error(
          JSON.stringify({
            message: "swap_failed_state_settlement_failed",
            requestId: requestIdFrom(c),
            jupiterRequestId: request.requestId,
            error:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : "Unknown settlement error",
          }),
        );
      }
    }
    throw error;
  }
  if (request.market === "rwa" && c.env.DB) {
    try {
      await settleRwaOrderExecution(
        c.env.DB,
        request.requestId,
        execution.status === "Success",
        execution.signature,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "rwa_order_settlement_failed",
          requestId: requestIdFrom(c),
          jupiterRequestId: request.requestId,
          transactionHash: execution.signature,
          error: error instanceof Error ? error.message : "Unknown RWA error",
        }),
      );
      c.executionCtx.waitUntil(
        settleRwaOrderExecution(
          c.env.DB,
          request.requestId,
          execution.status === "Success",
          execution.signature,
        ).catch((retryError: unknown) => {
          console.error(
            JSON.stringify({
              message: "rwa_order_settlement_retry_failed",
              jupiterRequestId: request.requestId,
              error:
                retryError instanceof Error
                  ? retryError.message
                  : "Unknown RWA retry error",
            }),
          );
        }),
      );
    }
  }
  try {
    await settleWalletSwapRiskExecution(
      c.env,
      request.requestId,
      request.taker,
      execution.status === "Success",
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "wallet_swap_risk_settlement_failed",
        requestId: requestIdFrom(c),
        jupiterRequestId: request.requestId,
        error: error instanceof Error ? error.message : "Unknown risk error",
      }),
    );
    c.executionCtx.waitUntil(
      settleWalletSwapRiskExecution(
        c.env,
        request.requestId,
        request.taker,
        execution.status === "Success",
      ).catch((retryError: unknown) => {
        console.error(
          JSON.stringify({
            message: "wallet_swap_risk_settlement_retry_failed",
            jupiterRequestId: request.requestId,
            error:
              retryError instanceof Error
                ? retryError.message
                : "Unknown risk retry error",
          }),
        );
      }),
    );
  }
  let walletorAccounting = null;
  if (
    execution.status === "Success" &&
    (request.market === "crypto" || rwaFeatures.rewardsEnabled)
  ) {
    try {
      walletorAccounting = await creditJupiterSwapExecution(
        c.env,
        request.requestId,
        execution,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "walletor_swap_accounting_pending",
          requestId: requestIdFrom(c),
          jupiterRequestId: request.requestId,
          transactionHash: execution.signature,
          error:
            error instanceof Error ? error.message : "Unknown accounting error",
        }),
      );
      if (execution.signature) {
        c.executionCtx.waitUntil(
          reconcileJupiterSwapAccounting(c.env, execution.signature).catch(
            (retryError: unknown) => {
              console.error(
                JSON.stringify({
                  message: "walletor_swap_accounting_retry_failed",
                  jupiterRequestId: request.requestId,
                  transactionHash: execution.signature,
                  error:
                    retryError instanceof Error
                      ? retryError.message
                      : "Unknown accounting retry error",
                }),
              );
            },
          ),
        );
      }
    }
  }
  if (walletorAccounting?.rewardEligible && c.env.QUESTLINE_API_KEY) {
    c.executionCtx.waitUntil(
      flushQuestlineCompletions(c.env).catch(() => {
        console.warn("questline_delivery_deferred_to_scheduler");
      }),
    );
  }
  const data = { ...execution, walletorAccounting };
  c.header("Cache-Control", "no-store");
  return c.json({ data, meta: marketMeta(requestIdFrom(c)) });
});

app.post("/api/swap/accounting/:signature", async (c) => {
  const receipt = await reconcileJupiterSwapAccounting(
    c.env,
    c.req.param("signature"),
  );
  const fetchedAt = new Date().toISOString();
  if (receipt?.rewardEligible && c.env.QUESTLINE_API_KEY) {
    c.executionCtx.waitUntil(
      flushQuestlineCompletions(c.env).catch(() => {
        console.warn("questline_delivery_deferred_to_scheduler");
      }),
    );
  }
  c.header("Cache-Control", "no-store");
  return c.json({
    data: {
      status: receipt ? ("CREDITED" as const) : ("SYNCING" as const),
      walletorAccounting: receipt,
    },
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt,
      requestId: requestIdFrom(c),
    },
  });
});

app.post("/api/internal/accounting/recover/:signature", async (c) => {
  await authorizeBearer(
    c.req.header("authorization"),
    c.env.REFERRAL_ADMIN_SECRET,
    {
      notConfiguredCode: "ACCOUNTING_RECOVERY_NOT_CONFIGURED",
      notConfiguredMessage: "Swap accounting recovery is not configured.",
      unauthorizedCode: "ACCOUNTING_RECOVERY_UNAUTHORIZED",
      unauthorizedMessage: "Swap accounting recovery authorization failed.",
    },
  );
  const receipt = await recoverJupiterSwapAccounting(
    c.env,
    c.req.param("signature"),
  );
  if (!receipt) {
    throw new ApiFailure(
      409,
      "ACCOUNTING_RECOVERY_NOT_MATCHED",
      "No uniquely matching pending Walletor order was found for this transaction.",
      false,
    );
  }
  c.header("Cache-Control", "no-store");
  return c.json({
    data: receipt,
    meta: {
      source: "walletor-ledger" as const,
      fetchedAt: new Date().toISOString(),
      requestId: requestIdFrom(c),
    },
  });
});

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "API route not found.",
        retryable: false,
      },
      meta: { requestId: requestIdFrom(c) },
    },
    404,
  ),
);

app.onError((error, c) => {
  const requestId = requestIdFrom(c);
  const failure =
    error instanceof ApiFailure
      ? error
      : new ApiFailure(
          500,
          "INTERNAL_ERROR",
          "An unexpected server error occurred.",
          true,
        );

  console.error(
    JSON.stringify({
      message: "api_request_failed",
      requestId,
      method: c.req.method,
      path: c.req.path,
      code: failure.code,
      status: failure.status,
      cause:
        error instanceof ApiFailure
          ? undefined
          : error.message.replace(/https?:\/\/\S+/g, "[redacted URL]"),
    }),
  );
  if (failure.retryAfter) c.header("Retry-After", String(failure.retryAfter));
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      },
      meta: { requestId },
    },
    failure.status,
  );
});

function marketMeta(
  requestId: string,
  source: "jupiter" | "walletor-token-index" = "jupiter",
) {
  return {
    source,
    fetchedAt: new Date().toISOString(),
    requestId,
  };
}

function settledTokenResults<T>(
  result: PromiseSettledResult<T[]>,
  operation: string,
): T[] {
  if (result.status === "fulfilled") return result.value;
  console.error(
    JSON.stringify({
      message: "token_discovery_source_failed",
      operation,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown token discovery error",
    }),
  );
  return [];
}

function heliusMetadataToSearchResult(
  metadata: HeliusTokenMetadata,
): SwapTokenSearchResult | null {
  if (
    metadata.name === null ||
    metadata.symbol === null ||
    metadata.decimals === null ||
    metadata.decimals < 0 ||
    metadata.decimals > 18
  ) {
    return null;
  }
  const parsed = SwapTokenSearchResultSchema.safeParse({
    address: metadata.mint,
    symbol: metadata.symbol.slice(0, 24),
    name: metadata.name.slice(0, 120),
    logoUrl: metadata.logoUrl,
    decimals: metadata.decimals,
    isVerified: false,
    organicScore: null,
    organicScoreLabel: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    holders: null,
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    topHoldersPercent: null,
    source: "helius",
    discoveredAt: null,
  });
  return parsed.success ? parsed.data : null;
}

async function updateTokenRetentionSafely(
  db: D1Database,
  mint: string,
  metadata: HeliusTokenMetadata | null,
  alreadyIndexed: boolean,
  requestId: string,
): Promise<void> {
  try {
    if (
      !alreadyIndexed &&
      metadata &&
      (await upsertHeliusTokenMetadata(db, metadata))
    ) {
      return;
    }
    await markIndexedTokensUsed(db, [mint]);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "token_index_retention_update_failed",
        requestId,
        mint,
        error: error instanceof Error ? error.message : "Unknown D1 error",
      }),
    );
  }
}

async function markSwapPairUsedSafely(
  db: D1Database,
  inputMint: string,
  outputMint: string,
  requestId: string,
): Promise<void> {
  try {
    await markIndexedTokensUsed(db, [inputMint, outputMint]);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "token_index_swap_pair_retention_failed",
        requestId,
        inputMint,
        outputMint,
        error: error instanceof Error ? error.message : "Unknown D1 error",
      }),
    );
  }
}

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ApiFailure(
      400,
      "INVALID_PAGINATION",
      "Distribution pagination values must be unsigned integers.",
      false,
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiFailure(
      400,
      "INVALID_PAGINATION",
      "Distribution pagination values are outside the supported range.",
      false,
    );
  }
  return parsed;
}

function observableRoute(path: string): string {
  if (/^\/api\/wallets\/[^/]+\/engine$/.test(path)) {
    return "/api/wallets/:address/engine";
  }
  if (/^\/api\/wallets\/[^/]+\/claims$/.test(path)) {
    return "/api/wallets/:address/claims";
  }
  if (/^\/api\/wallets\/[^/]+\/solana-claims$/.test(path)) {
    return "/api/wallets/:address/solana-claims";
  }
  if (/^\/api\/prize-pool\/draws\/[^/]+$/.test(path)) {
    return "/api/prize-pool/draws/:roundId";
  }
  if (/^\/api\/prize-pool\/distributions\/[^/]+$/.test(path)) {
    return "/api/prize-pool/distributions/:roundId";
  }
  if (/^\/api\/tokens\/[^/]+\/chart-market$/.test(path))
    return "/api/tokens/:address/chart-market";
  if (/^\/api\/tokens\/[^/]+$/.test(path)) return "/api/tokens/:address";
  if (/^\/api\/internal\/accounting\/recover\/[^/]+$/.test(path)) {
    return "/api/internal/accounting/recover/:signature";
  }
  if (/^\/api\/internal\/referral-fee-mints\/[^/]+\/status$/.test(path)) {
    return "/api/internal/referral-fee-mints/:mint/status";
  }
  return path;
}

async function authorizeReferralAdmin(c: {
  env: Partial<Env>;
  req: { header(name: string): string | undefined };
}): Promise<D1Database> {
  await authorizeBearer(
    c.req.header("authorization"),
    c.env.REFERRAL_ADMIN_SECRET,
    {
      notConfiguredCode: "REFERRAL_ADMIN_NOT_CONFIGURED",
      notConfiguredMessage: "Referral fee-mint operations are not configured.",
      unauthorizedCode: "REFERRAL_ADMIN_UNAUTHORIZED",
      unauthorizedMessage: "Referral fee-mint authorization failed.",
    },
  );
  if (!c.env.DB) {
    throw new ApiFailure(
      503,
      "REFERRAL_FEE_MINT_REGISTRY_NOT_CONFIGURED",
      "The referral fee-mint registry is not configured.",
      false,
    );
  }
  return c.env.DB;
}

async function observeReferralFeeMintSafely(
  db: D1Database,
  observation: Parameters<typeof recordReferralFeeMintObservation>[1],
): Promise<void> {
  try {
    await recordReferralFeeMintObservation(db, observation);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "referral_fee_mint_observation_failed",
        mint: observation.mint,
        feeApplied: observation.feeApplied,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}
