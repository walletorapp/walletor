import {
  DAILY_SEED_CENTS,
  SEED_CAMPAIGN_DAYS,
} from "../../shared/prize-seed-contracts";

export const SEED_DAY_MS = 86_400_000;
export const PRIZE_SEED_SQL = `
CREATE TABLE IF NOT EXISTS prize_seed_campaign (
 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 authority_address TEXT NOT NULL, deposit_account TEXT NOT NULL,
 requested_at TEXT NOT NULL, funded_at TEXT, deposit_signature TEXT UNIQUE,
 starts_at TEXT, ends_at TEXT
);
CREATE TABLE IF NOT EXISTS prize_seed_rounds (
 round_id TEXT PRIMARY KEY, day_index INTEGER NOT NULL UNIQUE,
 amount_cents INTEGER NOT NULL CHECK(amount_cents = 10000),
 created_at TEXT NOT NULL
);`;

export interface SeedSql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): {
    toArray(): T[];
  };
}
export interface SeedCampaign extends Record<string, SqlStorageValue> {
  authority_address: string;
  deposit_account: string;
  requested_at: string;
  funded_at: string | null;
  deposit_signature: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export function seedCampaign(sql: SeedSql): SeedCampaign | null {
  return (
    sql
      .exec<SeedCampaign>(
        "SELECT * FROM prize_seed_campaign WHERE singleton = 1",
      )
      .toArray()[0] ?? null
  );
}

/** Call inside the same transaction that opens/updates the active round. */
export function applyDailyPrizeSeed(
  sql: SeedSql,
  authority: string,
  now: string,
): boolean {
  const campaign = seedCampaign(sql);
  if (!campaign?.funded_at || !campaign.starts_at || !campaign.ends_at)
    return false;
  if (campaign.authority_address !== authority)
    throw new Error(
      "Daily prize reserve belongs to a different distribution wallet.",
    );
  const round = sql
    .exec<{ round_id: string; start_time: string; end_time: string }>(
      `SELECT r.round_id, r.start_time, r.end_time FROM rounds r
     JOIN pool_state p ON r.round_id = p.active_round_id WHERE p.singleton = 1 AND r.status = 'OPEN'`,
    )
    .toArray()[0];
  if (!round) return false;
  const offset = Date.parse(round.start_time) - Date.parse(campaign.starts_at);
  const index = offset / SEED_DAY_MS;
  // Early closes, recovery windows and cadence changes cannot consume extra seeds.
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= SEED_CAMPAIGN_DAYS ||
    Date.parse(round.end_time) - Date.parse(round.start_time) !== SEED_DAY_MS
  )
    return false;
  if (
    sql
      .exec(
        "SELECT round_id FROM prize_seed_rounds WHERE round_id = ? OR day_index = ?",
        round.round_id,
        index,
      )
      .toArray().length
  )
    return false;
  const pool = sql
    .exec<{ current_balance_microusd: string }>(
      "SELECT current_balance_microusd FROM pool_state WHERE singleton = 1",
    )
    .toArray()[0];
  if (!pool) throw new Error("Prize Pool is unavailable.");
  const balance =
    BigInt(pool.current_balance_microusd) + BigInt(DAILY_SEED_CENTS) * 10_000n;
  const cents = Number(balance / 10_000n);
  if (!Number.isSafeInteger(cents))
    throw new Error("Prize Pool balance exceeds accounting limits.");
  sql.exec(
    "INSERT INTO prize_seed_rounds(round_id, day_index, amount_cents, created_at) VALUES (?, ?, ?, ?)",
    round.round_id,
    index,
    DAILY_SEED_CENTS,
    now,
  );
  sql.exec(
    `UPDATE pool_state SET current_balance_microusd = ?, current_balance_cents = ?,
    treasury_seed_cents = treasury_seed_cents + ?, updated_at = ? WHERE singleton = 1`,
    balance.toString(),
    cents,
    DAILY_SEED_CENTS,
    now,
  );
  sql.exec(
    `INSERT INTO ledger (ledger_entry_id, round_id, chain_id, transaction_hash, action,
    amount_cents, idempotency_key, reason, created_at)
    SELECT ?, ?, chain_id, ?, 'TREASURY_DAILY_SEED', ?, ?, ?, ? FROM pool_state WHERE singleton = 1`,
    crypto.randomUUID(),
    round.round_id,
    campaign.deposit_signature,
    DAILY_SEED_CENTS,
    `daily-seed:${round.round_id}`,
    "100 USDC daily seed from the verified seven-day reserve; swap fees are additional.",
    now,
  );
  return true;
}
