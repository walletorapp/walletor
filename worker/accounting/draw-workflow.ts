import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import {
  closeDuePrizePoolRounds,
  getPrizeDrawSummariesEndingAt,
} from "./runtime";
import { readAccountingConfig } from "./config";
import { utcRoundWindow } from "./rounds";
import { readUsdcClaimConfig } from "./usdc-claim-config";
import { readRewardsAutomationConfig } from "./automatic-claim-config";
import { advanceRoundFunding } from "../services/treasury-funding";
import {
  activateAutomaticDistribution,
  broadcastAutomaticDistributionFunding,
  broadcastAutomaticRandomnessCommit,
  broadcastAutomaticRandomnessReveal,
  confirmAndStageAutomaticDistribution,
  confirmAutomaticRandomnessCommit,
  confirmAutomaticRandomnessReveal,
  initializeAutomaticClaimSettlement,
  recordAutomaticSettlementFailure,
} from "../services/automatic-claim-settlement";

export interface PrizeDrawWorkflowParams {
  scheduledTime: string;
  trigger: "UTC_ROUND_CLOSE";
}

export interface AutomaticClaimSettlementWorkflowParams {
  roundId: string;
  trigger: "AUTOMATIC_RECOVERY";
}

async function runAutomaticSettlement(
  env: Env,
  step: WorkflowStep,
  roundId: string,
  stepSuffix: string,
) {
  await step.do(
    `collect and convert verified fees ${stepSuffix}`,
    {
      retries: { limit: 60, delay: "10 seconds", backoff: "constant" },
      timeout: "2 minutes",
    },
    async () => {
      const funding = await advanceRoundFunding(env.DB, env, roundId);
      if (!funding.ready)
        throw new Error("Treasury funding is awaiting finalized evidence.");
      return funding;
    },
  );
  await step.do(
    `broadcast Switchboard commit ${stepSuffix}`,
    {
      retries: { limit: 5, delay: "3 seconds", backoff: "linear" },
      timeout: "2 minutes",
    },
    async () => broadcastAutomaticRandomnessCommit(env.DB, env, roundId),
  );
  await step.do(
    `confirm Switchboard commit ${stepSuffix}`,
    {
      retries: { limit: 30, delay: "2 seconds", backoff: "linear" },
      timeout: "2 minutes",
    },
    async () => confirmAutomaticRandomnessCommit(env.DB, env, roundId),
  );

  await step.sleep(
    `wait for future Switchboard slot ${stepSuffix}`,
    "4 seconds",
  );
  await step.do(
    `broadcast Switchboard reveal ${stepSuffix}`,
    {
      retries: { limit: 10, delay: "3 seconds", backoff: "linear" },
      timeout: "3 minutes",
    },
    async () => broadcastAutomaticRandomnessReveal(env.DB, env, roundId),
  );
  const evidence = await step.do(
    `confirm Switchboard reveal ${stepSuffix}`,
    {
      retries: { limit: 30, delay: "2 seconds", backoff: "linear" },
      timeout: "2 minutes",
    },
    async () => confirmAutomaticRandomnessReveal(env.DB, env, roundId),
  );

  await step.do(
    `broadcast USDC funding ${stepSuffix}`,
    {
      retries: { limit: 5, delay: "5 seconds", backoff: "linear" },
      timeout: "3 minutes",
    },
    async () => broadcastAutomaticDistributionFunding(env.DB, env, evidence),
  );
  const staged = await step.do(
    `confirm and stage USDC distribution ${stepSuffix}`,
    {
      retries: { limit: 30, delay: "2 seconds", backoff: "linear" },
      timeout: "3 minutes",
    },
    async () => confirmAndStageAutomaticDistribution(env.DB, env, evidence),
  );
  return step.do(
    `activate claim entitlements ${stepSuffix}`,
    {
      retries: { limit: 10, delay: "5 seconds", backoff: "linear" },
      timeout: "3 minutes",
    },
    async () =>
      activateAutomaticDistribution(
        env.DB,
        env,
        roundId,
        staged.manifestChecksum,
      ),
  );
}

export class PrizeDrawWorkflow extends WorkflowEntrypoint<
  Env,
  PrizeDrawWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<PrizeDrawWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const scheduledTime = new Date(event.payload.scheduledTime);
    if (!Number.isFinite(scheduledTime.getTime())) {
      throw new Error("Prize Draw Workflow received an invalid timestamp.");
    }

    const snapshot = await step.do(
      "lock verified round and stage draw snapshot",
      {
        retries: {
          limit: 10,
          delay: "10 seconds",
          backoff: "exponential",
        },
        timeout: "5 minutes",
      },
      async () => {
        const state = await closeDuePrizePoolRounds(this.env, scheduledTime);
        return {
          activeRoundId: state.activeRound.roundId,
          activeRoundStatus: state.activeRound.status,
          serverTime: state.serverTime,
        };
      },
    );

    const coordination = await step.do(
      "verify the immutable draw and evaluate the on-chain safety gate",
      {
        retries: {
          limit: 5,
          delay: "5 seconds",
          backoff: "exponential",
        },
        timeout: "2 minutes",
      },
      async () => {
        const { roundDurationHours } = readAccountingConfig(this.env);
        const closedAt = utcRoundWindow(
          scheduledTime,
          undefined,
          roundDurationHours,
        ).startTime;
        const draws = await getPrizeDrawSummariesEndingAt(
          this.env,
          closedAt,
          scheduledTime,
        );
        const claimConfig = readUsdcClaimConfig(this.env);
        const automaticConfig = readRewardsAutomationConfig(this.env);
        return {
          closedAt,
          claimNetwork: claimConfig.network,
          automaticSettlementEnabled: automaticConfig.enabled,
          rounds: draws.map((draw) => ({
            ...draw,
            onchainStatus:
              draw.participantCount === 0
                ? ("NO_ELIGIBLE_PARTICIPANTS" as const)
                : !claimConfig.executionEnabled
                  ? ("PAYOUT_EXECUTION_DISABLED" as const)
                  : !automaticConfig.enabled
                    ? ("AWAITING_VERIFIED_USDC_DISTRIBUTION" as const)
                    : ("AUTOMATIC_SETTLEMENT_QUEUED" as const),
          })),
        };
      },
    );

    const settlements = [];
    for (const [index, draw] of coordination.rounds.entries()) {
      const stepSuffix = String(index + 1);
      if (
        draw.participantCount === 0 ||
        draw.onchainStatus !== "AUTOMATIC_SETTLEMENT_QUEUED"
      ) {
        settlements.push({
          roundId: draw.roundId,
          status: draw.onchainStatus,
        });
        continue;
      }
      try {
        const identity = await step.do(
          `initialize automatic settlement ${stepSuffix}`,
          async () =>
            initializeAutomaticClaimSettlement(
              this.env.DB,
              this.env,
              draw,
              scheduledTime,
            ),
        );
        if (identity.status === "ACTIVE" || identity.status === "STAGED") {
          settlements.push({
            roundId: draw.roundId,
            status: identity.status,
          });
          continue;
        }

        const active = await runAutomaticSettlement(
          this.env,
          step,
          draw.roundId,
          stepSuffix,
        );
        settlements.push({ roundId: draw.roundId, ...active });
      } catch (error) {
        await recordAutomaticSettlementFailure(
          this.env.DB,
          draw.roundId,
          error,
        );
        throw error;
      }
    }

    return {
      status: "ROUND_SETTLEMENT_COMPLETE",
      trigger: event.payload.trigger,
      ...snapshot,
      coordination,
      settlements,
    };
  }
}

export class AutomaticClaimSettlementWorkflow extends WorkflowEntrypoint<
  Env,
  AutomaticClaimSettlementWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<AutomaticClaimSettlementWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const { roundId } = event.payload;
    if (!/^[a-z0-9:.-]{1,160}$/i.test(roundId)) {
      throw new Error("Automatic claim recovery received an invalid round ID.");
    }
    try {
      const active = await runAutomaticSettlement(
        this.env,
        step,
        roundId,
        "recovery",
      );
      return {
        workflowStatus: "ROUND_SETTLEMENT_RECOVERED",
        trigger: event.payload.trigger,
        roundId,
        ...active,
      };
    } catch (error) {
      await recordAutomaticSettlementFailure(this.env.DB, roundId, error);
      throw error;
    }
  }
}
