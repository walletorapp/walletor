import {
  QuestlineConfigSchema,
  type QuestlineConfig,
  type QuestlineJob,
} from "../accounting/questline";

export const QUESTLINE_PUSH_URL =
  "https://quests.magicblock.app/api/validators/push";
interface QuestlineEnvironment {
  QUESTLINE_ENABLED?: string;
  QUESTLINE_QUEST_ID?: string;
  QUESTLINE_CAMPAIGN_START_AT?: string;
  QUESTLINE_API_KEY?: string;
}
export function readQuestlineConfig(
  env: QuestlineEnvironment,
): QuestlineConfig | null {
  if (env.QUESTLINE_ENABLED !== "true") return null;
  const config = QuestlineConfigSchema.safeParse({
    questId: Number(env.QUESTLINE_QUEST_ID),
    startsAt: env.QUESTLINE_CAMPAIGN_START_AT,
  });
  if (!config.success || config.data.questId !== 89)
    throw new Error("Questline campaign configuration is invalid.");
  return config.data;
}

export interface QuestlineDelivery {
  status: "ACCEPTED" | "PENDING" | "REJECTED";
  code: string;
  retryAfterMs?: number;
  stop?: boolean;
}

// The project-key authorization path is server-to-server. No user's wallet
// signature or private key is needed, and credentials never follow redirects.
export async function deliverQuestline(
  job: QuestlineJob,
  apiKey: string,
  now = new Date(),
): Promise<QuestlineDelivery> {
  if (job.utc_day !== now.toISOString().slice(0, 10))
    return { status: "PENDING", code: "OUTSIDE_DAILY_WINDOW", stop: true };
  if (!/^qlk_live_[A-Za-z0-9_-]{20,}$/.test(apiKey))
    return {
      status: "PENDING",
      code: "KEY_NOT_CONFIGURED",
      retryAfterMs: 900_000,
      stop: true,
    };
  try {
    const response = await fetch(QUESTLINE_PUSH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `walletor:questline:${String(job.quest_id)}:${job.wallet_address}:${job.utc_day}`,
      },
      body: JSON.stringify({
        payload: {
          quest: job.quest_id,
          user: job.wallet_address,
          timestamp: now.getTime(),
        },
      }),
      signal: AbortSignal.timeout(6_000),
      redirect: "manual",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get("Retry-After");
      const retryMs = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - now.getTime()
        : undefined;
      return {
        status: "PENDING",
        code: `HTTP_${String(response.status)}`,
        ...(Number.isFinite(retryMs) ? { retryAfterMs: retryMs } : {}),
        ...([401, 403, 404].includes(response.status)
          ? { stop: true, retryAfterMs: 900_000 }
          : {}),
      };
    }
    // HTTP acknowledgement is distinct from proof of a Questline points award.
    // Reject an explicit JSON failure, even if an upstream responds with 200.
    if (response.status !== 204) {
      if (!response.headers.get("Content-Type")?.includes("application/json")) {
        await response.body?.cancel();
        return { status: "PENDING", code: "INVALID_ACKNOWLEDGEMENT" };
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        ("error" in body && body.error) ||
        ("success" in body && body.success === false) ||
        ("ok" in body && body.ok === false)
      )
        return { status: "PENDING", code: "INVALID_ACKNOWLEDGEMENT" };
    }
    return { status: "ACCEPTED", code: `HTTP_${String(response.status)}` };
  } catch {
    // Do not persist or log upstream content, headers or errors: these may
    // include credentials and private request details.
    return { status: "PENDING", code: "NETWORK_OR_TIMEOUT" };
  }
}
