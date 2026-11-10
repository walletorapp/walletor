export type RewardReconciliationRetry = Readonly<{
  delayMs: number;
  status: "SYNCING" | "DELAYED";
}>;

const FAST_RETRY_DELAYS_MS = [
  250, 400, 600, 800, 1_000, 1_200, 1_500, 2_000,
] as const;
const DELAYED_RETRY_MS = 5_000;

export const REWARD_SYNC_COUNTDOWN_SECONDS = 7;

export function rewardSyncCountdownSeconds(
  startedAtMs: number,
  nowMs: number,
): number {
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(
    0,
    Math.ceil(REWARD_SYNC_COUNTDOWN_SECONDS - elapsedMs / 1_000),
  );
}

/**
 * Poll finalized reward evidence closely just after a confirmed swap, then
 * back off if Solana or the verification provider is taking unusually long.
 */
export function rewardReconciliationRetry(
  completedAttempts: number,
): RewardReconciliationRetry {
  const delay = FAST_RETRY_DELAYS_MS[completedAttempts - 1];
  return delay === undefined
    ? { delayMs: DELAYED_RETRY_MS, status: "DELAYED" }
    : { delayMs: delay, status: "SYNCING" };
}
