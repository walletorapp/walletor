import bs58 from "bs58";
import {
  InfluencerChallengeSchema,
  influencerMessage,
} from "../../../shared/influencer-contracts";

export async function influencerApi(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (response.redirected || response.status === 401 || response.status === 403)
    throw new Error(
      "Referral service unavailable. Check your login and try again.",
    );
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("Referral service unavailable. Please try again later.");
  const json: unknown = await response.json();
  if (!response.ok) {
    if (
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof json.error === "object" &&
      json.error !== null &&
      "message" in json.error &&
      typeof json.error.message === "string"
    )
      throw new Error(json.error.message);
    throw new Error(
      "Referral service unavailable. Check your login and try again.",
    );
  }
  if (typeof json !== "object" || json === null || !("data" in json))
    throw new Error("Invalid referral service response.");
  return json.data;
}
export async function signInfluencerAction(
  walletAddress: string,
  code: string,
  purpose: "ENROLL" | "JOIN" | "REPORT",
  sign: (message: Uint8Array) => Promise<Uint8Array>,
) {
  const input = { walletAddress, code, purpose };
  const challenge = InfluencerChallengeSchema.parse(
    await influencerApi("/api/influencers/challenge", input),
  );
  if (
    challenge.message !==
    influencerMessage(input, challenge.nonce, challenge.expiresAt)
  )
    throw new Error("Unexpected referral signature request.");
  const signature = await sign(new TextEncoder().encode(challenge.message));
  return {
    ...input,
    nonce: challenge.nonce,
    signature: bs58.encode(signature),
  };
}
export function defaultInfluencerDates() {
  const to = new Date();
  const from = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      29 * 86_400_000,
  );
  return {
    from: from.toISOString().slice(0, 10),
    through: to.toISOString().slice(0, 10),
  };
}
export function influencerDateQuery(from: string, through: string) {
  return {
    from: new Date(`${from}T00:00:00Z`).toISOString(),
    to: new Date(Date.parse(`${through}T00:00:00Z`) + 86_400_000).toISOString(),
    after: 0,
  };
}
