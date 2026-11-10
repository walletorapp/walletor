// Operator-authorized, one-time early close. No later round can use this action.
export const EARLY_CLOSE_ROUND_ID =
  "solana:mainnet:prize-pool:2026-09-22T00:00:00.000Z";

export function isRollingDailyRound(roundId: string): boolean {
  return /^solana:mainnet:prize-pool:rolling:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(
    roundId,
  );
}
