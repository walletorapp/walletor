import { z } from "zod";

export const REPAIR_ROUND_ID =
  "solana:mainnet:prize-pool:2026-09-15T00:00:00.000Z";
const END = "2026-09-16T00:00:00.000Z";
const KEY = "restore-premature-september-15-round-v1";

export interface RepairDatabase {
  read(query: string, ...values: string[]): Record<string, unknown>[];
  write(query: string, ...values: (string | number)[]): void;
  transaction(action: () => void): void;
}

const roundSchema = z.object({
  round_id: z.string(),
  status: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  total_pool_cents: z.number().int().nonnegative(),
  remainder_cents: z.number().int().nonnegative(),
});
const poolSchema = z.object({
  active_round_id: z.string(),
  current_balance_cents: z.number().int().nonnegative(),
  current_balance_microusd: z.string().regex(/^\d+$/),
});

/** One-time, user-authorized correction. Never adds revenue or WLT credits. */
export function restoreSeptemberRound(
  db: RepairDatabase,
  now: string,
): boolean {
  if (now < "2026-09-15T00:00:00.000Z" || now >= END) return false;
  let restored = false;
  db.transaction(() => {
    const sourceRow = db.read(
      "SELECT * FROM rounds WHERE round_id = ?",
      REPAIR_ROUND_ID,
    )[0];
    if (!sourceRow) return;
    const source = roundSchema.parse(sourceRow);
    if (
      source.status === "OPEN" ||
      source.total_pool_cents === 0 ||
      source.end_time > source.start_time
    )
      return;
    const poolRows = db.read("SELECT * FROM pool_state WHERE singleton = 1");
    const pool = poolSchema.parse(poolRows[0]);
    if (
      !pool.active_round_id.startsWith(
        "solana:mainnet:prize-pool:recovery:2026-09-15T",
      )
    )
      return;
    const targetRows = db.read(
      "SELECT * FROM rounds WHERE round_id = ?",
      pool.active_round_id,
    );
    if (roundSchema.parse(targetRows[0]).status !== "OPEN")
      throw new Error("Repair requires the open recovery round.");
    for (const table of ["participants", "processed_swaps", "prize_draws"]) {
      if (
        db.read(
          `SELECT * FROM ${table} WHERE round_id = ?`,
          pool.active_round_id,
        ).length
      ) {
        throw new Error(
          "Recovery round has activity; automatic restoration is blocked.",
        );
      }
    }
    const draws = db.read(
      "SELECT * FROM prize_draws WHERE round_id = ?",
      REPAIR_ROUND_ID,
    );
    if (
      draws.length !== 1 ||
      draws[0]?.status !== "SNAPSHOT_LOCKED" ||
      draws[0].randomness_account !== null ||
      draws[0].commit_transaction_signature !== null ||
      draws[0].settlement_transaction_signature !== null
    ) {
      throw new Error(
        "Cannot restore a round with randomness or settlement evidence.",
      );
    }
    const allocations = db.read(
      "SELECT * FROM allocations WHERE round_id = ?",
      REPAIR_ROUND_ID,
    );
    const allocated = allocations.reduce((sum, row) => {
      if (
        row.status !== "CLAIM_UNAVAILABLE_BETA" ||
        row.payout_transaction_hash !== null
      ) {
        throw new Error("Cannot restore claimable or paid allocations.");
      }
      return (
        sum + BigInt(z.number().int().nonnegative().parse(row.reward_cents))
      );
    }, 0n);
    const amount =
      BigInt(source.total_pool_cents) - BigInt(source.remainder_cents);
    if (amount <= 0n || allocated !== amount)
      throw new Error("Locked allocation balance does not reconcile.");
    const snapshots: Record<string, unknown> = {
      source: sourceRow,
      recovery: targetRows,
      pool: poolRows,
    };
    for (const table of [
      "participants",
      "processed_swaps",
      "allocations",
      "prize_draws",
      "prize_draw_participants",
      "prize_draw_winners",
      "ledger",
    ]) {
      snapshots[table] = db.read(
        `SELECT * FROM ${table} WHERE round_id = ?`,
        REPAIR_ROUND_ID,
      );
    }
    db.write(
      "CREATE TABLE IF NOT EXISTS accounting_repairs (repair_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, restored_cents TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    if (
      db.read(
        "SELECT repair_id FROM accounting_repairs WHERE repair_id = ?",
        KEY,
      ).length
    )
      return;
    db.write(
      "INSERT INTO accounting_repairs VALUES (?, ?, ?, ?)",
      KEY,
      JSON.stringify(snapshots),
      amount.toString(),
      now,
    );
    // Preserve immutable draw and ledger evidence. Void only the unfunded
    // liability and resume today's participants in the existing open round.
    db.write(
      "UPDATE prize_draws SET status = 'FAILED', failure_reason = ?, updated_at = ? WHERE round_id = ?",
      KEY,
      now,
      REPAIR_ROUND_ID,
    );
    db.write(
      "UPDATE allocations SET status = 'FAILED', reward_cents = 0 WHERE round_id = ?",
      REPAIR_ROUND_ID,
    );
    db.write(
      "UPDATE rounds SET status = 'FAILED', total_pool_cents = 0, failure_reason = ?, updated_at = ? WHERE round_id = ?",
      KEY,
      now,
      REPAIR_ROUND_ID,
    );
    db.write(
      "UPDATE rounds SET start_time = ?, end_time = ?, updated_at = ? WHERE round_id = ?",
      source.start_time,
      END,
      now,
      pool.active_round_id,
    );
    db.write(
      "UPDATE participants SET round_id = ? WHERE round_id = ?",
      pool.active_round_id,
      REPAIR_ROUND_ID,
    );
    db.write(
      "UPDATE processed_swaps SET round_id = ?, result_json = json_set(result_json, '$.roundId', ?) WHERE round_id = ?",
      pool.active_round_id,
      pool.active_round_id,
      REPAIR_ROUND_ID,
    );
    db.write(
      "UPDATE jupiter_swap_orders SET result_json = json_set(result_json, '$.roundId', ?) WHERE json_extract(result_json, '$.roundId') = ?",
      pool.active_round_id,
      REPAIR_ROUND_ID,
    );
    const micros = BigInt(pool.current_balance_microusd) + amount * 10_000n;
    db.write(
      "UPDATE pool_state SET current_balance_microusd = ?, current_balance_cents = ?, updated_at = ? WHERE singleton = 1",
      micros.toString(),
      Number(micros / 10_000n),
      now,
    );
    db.write(
      "INSERT INTO ledger (ledger_entry_id, round_id, chain_id, transaction_hash, action, amount_cents, idempotency_key, reason, created_at) VALUES (?, ?, 'solana-mainnet', NULL, 'PREMATURE_ROUND_RESTORED', ?, ?, ?, ?)",
      KEY,
      pool.active_round_id,
      Number(amount),
      KEY,
      "Restored unfunded premature closure and daily participants; original snapshot archived; no additional revenue or WLT issued.",
      now,
    );
    restored = true;
  });
  return restored;
}
