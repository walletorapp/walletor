import { z } from "zod";
import { isSolanaAddress } from "../lib/solana";

export const ZealyVerificationSchema = z.object({
  userId: z.string().min(1).max(128),
  communityId: z.string().min(1).max(128),
  subdomain: z.string().min(1).max(128),
  questId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  accounts: z.object({ wallet: z.string().refine(isSolanaAddress) }),
});
export type ZealyVerification = z.infer<typeof ZealyVerificationSchema>;
export interface ZealySql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: string[]
  ): { toArray(): T[] };
}

export function zealyDayWindow(now: string, campaignStartsAt: string) {
  const current = Date.parse(now);
  const campaign = Date.parse(campaignStartsAt);
  if (!Number.isFinite(current) || !Number.isFinite(campaign))
    throw new Error("Invalid Zealy campaign date");
  const day = new Date(current).toISOString().slice(0, 10);
  return {
    day,
    start: new Date(
      Math.max(Date.parse(`${day}T00:00:00.000Z`), campaign),
    ).toISOString(),
    end: new Date(current).toISOString(),
    active: campaign <= current,
  };
}

export const ZEALY_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS zealy_fee_wallet_time ON referral_fee_ledger(wallet_address, created_at, transaction_hash);
CREATE TABLE IF NOT EXISTS zealy_wallet_bindings (
  community_id TEXT NOT NULL, user_id TEXT NOT NULL, wallet_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (community_id, user_id), UNIQUE (community_id, wallet_address)
);
CREATE TABLE IF NOT EXISTS zealy_daily_verifications (
  community_id TEXT NOT NULL, wallet_address TEXT NOT NULL, utc_day TEXT NOT NULL,
  user_id TEXT NOT NULL, quest_id TEXT NOT NULL, request_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL, verified_at TEXT NOT NULL,
  PRIMARY KEY (community_id, wallet_address, utc_day)
);`;

// Only confirmed fee-bearing swaps already credited by Walletor's authoritative
// coordinator qualify. Referral/social point awards never satisfy this query.
export const ZEALY_ELIGIBLE_SWAP_SQL = `
SELECT s.transaction_hash
FROM referral_fee_ledger f
JOIN processed_swaps s ON s.transaction_hash = f.transaction_hash
JOIN jupiter_swap_orders o ON o.transaction_hash = s.transaction_hash
WHERE f.wallet_address = ? AND s.chain_id = 'solana-mainnet'
  AND f.created_at >= ? AND f.created_at <= ?
  AND s.created_at >= ? AND s.created_at <= ?
  AND o.created_at >= ? AND o.status = 'CREDITED'
  AND json_extract(s.result_json, '$.rewardEligible') = 1
  AND CAST(json_extract(s.result_json, '$.wltPointsCredited') AS INTEGER) > 0
ORDER BY f.created_at DESC LIMIT 1`;

export type ZealyVerificationResult =
  "VERIFIED" | "NO_SWAP" | "WALLET_BOUND" | "OTHER_QUEST" | "NOT_STARTED";

export function verifyZealyDailySwap(
  sql: ZealySql,
  input: ZealyVerification,
  campaignStartsAt: string,
  now: string,
): ZealyVerificationResult {
  const window = zealyDayWindow(now, campaignStartsAt);
  if (!window.active) return "NOT_STARTED";
  const wallet = input.accounts.wallet;
  const bindings = sql
    .exec<{ user_id: string; wallet_address: string }>(
      "SELECT user_id, wallet_address FROM zealy_wallet_bindings WHERE community_id = ? AND (user_id = ? OR wallet_address = ?)",
      input.subdomain,
      input.userId,
      wallet,
    )
    .toArray();
  if (
    bindings.some(
      (row) => row.user_id !== input.userId || row.wallet_address !== wallet,
    )
  )
    return "WALLET_BOUND";
  const previous = sql
    .exec<{ quest_id: string }>(
      "SELECT quest_id FROM zealy_daily_verifications WHERE community_id = ? AND wallet_address = ? AND utc_day = ?",
      input.subdomain,
      wallet,
      window.day,
    )
    .toArray()[0];
  if (previous)
    return previous.quest_id === input.questId ? "VERIFIED" : "OTHER_QUEST";
  const swap = sql
    .exec<{ transaction_hash: string }>(
      ZEALY_ELIGIBLE_SWAP_SQL,
      wallet,
      window.start,
      window.end,
      window.start,
      window.end,
      campaignStartsAt,
    )
    .toArray()[0];
  if (!swap) return "NO_SWAP";
  sql.exec(
    "INSERT OR IGNORE INTO zealy_wallet_bindings VALUES (?, ?, ?, ?)",
    input.subdomain,
    input.userId,
    wallet,
    now,
  );
  sql.exec(
    "INSERT INTO zealy_daily_verifications VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    input.subdomain,
    wallet,
    window.day,
    input.userId,
    input.questId,
    input.requestId,
    swap.transaction_hash,
    now,
  );
  return "VERIFIED";
}
