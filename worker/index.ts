import { app } from "./app";
import { isPublicInformationRequest } from "./lib/public-information";
import { handleZealyTask, ZEALY_VERIFY_PATH } from "./services/zealy";
import { requireCloudflareAccess } from "./lib/cloudflare-access";
import { isAdminPath } from "./lib/admin-path";
import { ApiFailure } from "./lib/http";
import { withOwnerOnlyAccess } from "./lib/owner-only-access";
import {
  closeDuePrizePoolRounds,
  retryPendingJupiterSwapAccounting,
  flushQuestlineCompletions,
} from "./accounting/runtime";
import { getRecentSwapTokens } from "./services/jupiter";
import { pruneTokenIndex, upsertJupiterTokens } from "./services/token-index";
import { activateStagedUsdcClaimDistributions } from "./services/usdc-claims";
import { listIncompleteAutomaticSettlements } from "./services/automatic-claim-settlement";
import { readRewardsAutomationConfig } from "./accounting/automatic-claim-config";
import {
  isRwaPageRequest,
  unavailableCountry,
  unavailableJurisdictionResponse,
  unavailableRwaCountry,
  unavailableRwaJurisdictionResponse,
} from "./lib/jurisdiction";

export { PrizePoolCoordinator } from "./accounting/coordinator";
export { WalletorBackupReader } from "./backup-reader";
export { PrizeDrawWorkflow } from "./accounting/draw-workflow";
export { AutomaticClaimSettlementWorkflow } from "./accounting/draw-workflow";
export { WalletSwapRiskGate } from "./risk/wallet-swap-risk-gate";
export { LaunchFeed } from "./launch-feed";

export default {
  async fetch(request, env, ctx) {
    return withOwnerOnlyAccess(request, env, async () => {
      if (isPublicInformationRequest(request)) return env.ASSETS.fetch(request);
      // Zealy's server location is not the participant's location. This exact
      // machine endpoint authenticates independently and cannot execute swaps.
      if (new URL(request.url).pathname === ZEALY_VERIFY_PATH) {
        return handleZealyTask(request, env);
      }
      if (isAdminPath(new URL(request.url).pathname)) {
        try {
          await requireCloudflareAccess(
            request.headers.get("Cf-Access-Jwt-Assertion") ?? undefined,
            env,
          );
        } catch (error) {
          return Response.json(
            {
              error: {
                code:
                  error instanceof ApiFailure
                    ? error.code
                    : "ADMIN_ACCESS_INVALID",
                message:
                  "Sign in through the authorized Walletor Admin access portal.",
              },
            },
            {
              status: error instanceof ApiFailure ? error.status : 401,
              headers: {
                "Cache-Control": "no-store",
                "X-Robots-Tag": "noindex, nofollow",
              },
            },
          );
        }
      }
      const country = unavailableCountry(request);
      if (country) {
        const path = new URL(request.url).pathname;
        console.warn(
          JSON.stringify({
            message: "jurisdiction_request_blocked",
            country,
            requestType:
              path === "/api" ||
              path.startsWith("/api/") ||
              path === "/admin/api" ||
              path.startsWith("/admin/api/")
                ? "api"
                : "application",
          }),
        );
        return unavailableJurisdictionResponse(request, country);
      }

      const rwaCountry = unavailableRwaCountry(request);
      if (rwaCountry && isRwaPageRequest(request)) {
        console.warn(
          JSON.stringify({
            message: "rwa_jurisdiction_request_blocked",
            country: rwaCountry,
            requestType: "application",
          }),
        );
        return unavailableRwaJurisdictionResponse(request, rwaCountry);
      }

      const path = new URL(request.url).pathname;
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        (path === "/new-tokens" || path === "/new-tokens/")
      ) {
        const destination = new URL(request.url);
        destination.pathname = "/trenches";
        return Response.redirect(destination.toString(), 308);
      }
      if (path === "/region-unavailable") {
        return unavailableJurisdictionResponse(request, "preview");
      }
      if (
        path === "/api" ||
        path.startsWith("/api/") ||
        path === "/admin/api" ||
        path.startsWith("/admin/api/")
      ) {
        return app.fetch(request, env, ctx);
      }
      return env.ASSETS.fetch(request);
    });
  },
  scheduled(controller, env, ctx) {
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(checkPrizePoolRounds(env, controller));
      ctx.waitUntil(syncJupiterTokenIndex(env, controller.cron));
      ctx.waitUntil(retryPendingSwapAccounting(env, controller.cron));
      ctx.waitUntil(retryStagedClaimActivation(env, controller.cron));
      ctx.waitUntil(retryIncompleteClaimSettlements(env, controller));
      ctx.waitUntil(
        flushQuestlineCompletions(env).then((summary) => {
          if (summary.enabled && summary.attempted > 0)
            console.log(
              JSON.stringify({
                message: "questline_push_complete",
                ...summary,
              }),
            );
        }),
      );
      return;
    }
    if (controller.cron === "0 0 * * *") {
      ctx.waitUntil(startPrizeDrawWorkflow(env, controller));
      return;
    }
    ctx.waitUntil(checkPrizePoolRounds(env, controller));
    ctx.waitUntil(pruneTokenIndexSafely(env, controller.cron));
  },
} satisfies ExportedHandler<Env>;

async function retryPendingSwapAccounting(
  env: Env,
  cron: string,
): Promise<void> {
  try {
    const summary = await retryPendingJupiterSwapAccounting(env);
    console.log(
      JSON.stringify({
        message: "pending_swap_accounting_retry_complete",
        cron,
        ...summary,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "pending_swap_accounting_retry_failed",
        cron,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    throw error;
  }
}

async function retryIncompleteClaimSettlements(
  env: Env,
  controller: ScheduledController,
): Promise<void> {
  if (!readRewardsAutomationConfig(env).enabled) return;
  const incomplete = await listIncompleteAutomaticSettlements(env.DB);
  if (incomplete.length === 0) return;
  const fiveMinuteBucket = Math.floor(controller.scheduledTime / 300_000);
  for (const settlement of incomplete) {
    const roundDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(settlement.roundId),
    );
    const roundKey = Array.from(new Uint8Array(roundDigest).slice(0, 8))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const instanceId = `claim-recovery-${roundKey}-${String(fiveMinuteBucket)}`;
    try {
      await env.AUTOMATIC_CLAIM_WORKFLOW.create({
        id: instanceId,
        params: {
          roundId: settlement.roundId,
          trigger: "AUTOMATIC_RECOVERY",
        },
      });
    } catch (error) {
      const existing = await env.AUTOMATIC_CLAIM_WORKFLOW.get(instanceId);
      const status = await existing.status();
      if (status.status === "errored" || status.status === "terminated") {
        console.error(
          JSON.stringify({
            message: "automatic_claim_recovery_failed",
            roundId: settlement.roundId,
            instanceId,
            error:
              status.error?.message ??
              (error instanceof Error ? error.message : "Unknown error"),
          }),
        );
      }
    }
  }
}

async function retryStagedClaimActivation(
  env: Env,
  cron: string,
): Promise<void> {
  try {
    const summary = await activateStagedUsdcClaimDistributions(env.DB, env);
    if (summary.attempted === 0) return;
    console.log(
      JSON.stringify({
        message: "automatic_claim_activation_complete",
        cron,
        ...summary,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "automatic_claim_activation_retry_failed",
        cron,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    throw error;
  }
}

async function startPrizeDrawWorkflow(
  env: Env,
  controller: ScheduledController,
): Promise<void> {
  const scheduledTime = new Date(controller.scheduledTime).toISOString();
  const hourlyBoundary = scheduledTime
    .slice(0, 13)
    .replaceAll("-", "")
    .replace("T", "");
  const instanceId = `prize-draw-${hourlyBoundary}`;
  try {
    await env.PRIZE_DRAW_WORKFLOW.create({
      id: instanceId,
      params: { scheduledTime, trigger: "UTC_ROUND_CLOSE" },
    });
    console.log(
      JSON.stringify({
        message: "prize_draw_workflow_started",
        cron: controller.cron,
        instanceId,
        scheduledTime,
      }),
    );
  } catch (error) {
    try {
      const existing = await env.PRIZE_DRAW_WORKFLOW.get(instanceId);
      const status = await existing.status();
      if (status.status === "errored" || status.status === "terminated") {
        throw new Error(
          `Existing Prize Draw Workflow is ${status.status}: ${status.error?.message ?? "unknown error"}`,
          { cause: error },
        );
      }
      console.log(
        JSON.stringify({
          message: "prize_draw_workflow_already_started",
          cron: controller.cron,
          instanceId,
          status: status.status,
        }),
      );
    } catch (lookupError) {
      console.error(
        JSON.stringify({
          message: "prize_draw_workflow_start_failed",
          cron: controller.cron,
          instanceId,
          createError:
            error instanceof Error ? error.message : "Unknown create error",
          lookupError:
            lookupError instanceof Error
              ? lookupError.message
              : "Unknown lookup error",
        }),
      );
      throw lookupError;
    }
  }
}

async function syncJupiterTokenIndex(env: Env, cron: string): Promise<void> {
  try {
    const tokens = await getRecentSwapTokens(env.JUPITER_API_KEY);
    const accepted = await upsertJupiterTokens(env.TOKEN_DB, tokens);
    console.log(
      JSON.stringify({
        message: "jupiter_token_index_sync_complete",
        cron,
        accepted,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "jupiter_token_index_sync_failed",
        cron,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    throw error;
  }
}

async function pruneTokenIndexSafely(env: Env, cron: string): Promise<void> {
  try {
    const deleted = await pruneTokenIndex(env.TOKEN_DB);
    console.log(
      JSON.stringify({
        message: "token_index_prune_complete",
        cron,
        deleted,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "token_index_prune_failed",
        cron,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}

async function checkPrizePoolRounds(
  env: Env,
  controller: ScheduledController,
): Promise<void> {
  try {
    const state = await closeDuePrizePoolRounds(
      env,
      new Date(controller.scheduledTime),
    );
    console.log(
      JSON.stringify({
        message: "prize_pool_round_check_complete",
        cron: controller.cron,
        roundId: state.activeRound.roundId,
        roundStatus: state.activeRound.status,
        serverTime: state.serverTime,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "prize_pool_round_check_failed",
        cron: controller.cron,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    throw error;
  }
}
