import { z } from "zod";

export interface QuestlineSql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): T[] };
}

export const QuestlineConfigSchema = z.object({
  questId: z.number().int().positive(),
  startsAt: z.iso.datetime({ precision: 3 }),
});
export type QuestlineConfig = z.infer<typeof QuestlineConfigSchema>;

export interface QuestlineSwap {
  chainId: string;
  signature: string;
  wallet: string;
  orderStartedAt: string;
  confirmedAt: string;
  eligible: boolean;
  valueCents: bigint;
  questId?: number;
}

interface QuestlineCandidate extends Record<string, SqlStorageValue> {
  quest_id: number;
  wallet_address: string;
  utc_day: string;
  transaction_hash: string;
  confirmed_at: string;
  attempts: number;
}
export interface QuestlineJob extends QuestlineCandidate {
  lease: string;
}

export const QUESTLINE_SQL = `
CREATE TABLE IF NOT EXISTS questline_verified_swaps (
  transaction_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  order_started_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questline_swap_time ON questline_verified_swaps(confirmed_at, wallet_address);
CREATE TABLE IF NOT EXISTS questline_campaigns (
  quest_id INTEGER PRIMARY KEY,
  starts_at TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence = 'UTC_DAY')
);
CREATE TABLE IF NOT EXISTS questline_completions (
  quest_id INTEGER NOT NULL REFERENCES questline_campaigns(quest_id),
  wallet_address TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','IN_FLIGHT','ACCEPTED','EXPIRED','REJECTED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease TEXT,
  lease_until TEXT,
  last_code TEXT,
  accepted_at TEXT,
  PRIMARY KEY (quest_id, wallet_address, utc_day),
  UNIQUE (quest_id, transaction_hash)
);
CREATE INDEX IF NOT EXISTS questline_pending ON questline_completions(quest_id,status,next_attempt_at);
`;

// Called only within the authoritative swap-credit transaction. This records
// verification evidence, not a quest completion, and never awards Walletor points.
export function recordQuestlineSwap(sql: QuestlineSql, swap: QuestlineSwap) {
  if (
    swap.chainId !== "solana-mainnet" ||
    swap.questId !== 89 ||
    !swap.eligible ||
    swap.valueCents < 500n
  )
    return;
  sql.exec(
    `INSERT OR IGNORE INTO questline_verified_swaps
      (transaction_hash,wallet_address,order_started_at,confirmed_at) VALUES (?,?,?,?)`,
    swap.signature,
    swap.wallet,
    swap.orderStartedAt,
    swap.confirmedAt,
  );
}

export class QuestlineLedger {
  constructor(private readonly sql: QuestlineSql) {}

  initialize() {
    this.sql.exec(QUESTLINE_SQL);
  }

  configure(raw: QuestlineConfig) {
    const config = QuestlineConfigSchema.parse(raw);
    const previous = this.sql
      .exec<{ starts_at: string }>(
        "SELECT starts_at FROM questline_campaigns WHERE quest_id = ?",
        config.questId,
      )
      .toArray()[0];
    if (previous && previous.starts_at !== config.startsAt)
      throw new Error(
        "Questline campaign start cannot change; create a new quest instead.",
      );
    this.sql.exec(
      "INSERT OR IGNORE INTO questline_campaigns VALUES (?,?,'UTC_DAY')",
      config.questId,
      config.startsAt,
    );
    return config;
  }

  enqueue(config: QuestlineConfig, now: string) {
    const parsedNow = z.iso.datetime({ precision: 3 }).parse(now);
    const day = parsedNow.slice(0, 10);
    this.sql.exec(
      `UPDATE questline_completions SET status='EXPIRED',lease=NULL,lease_until=NULL
       WHERE quest_id=? AND utc_day < ? AND status IN ('PENDING','IN_FLIGHT')`,
      config.questId,
      day,
    );
    if (parsedNow < config.startsAt) return;
    const start =
      config.startsAt > `${day}T00:00:00.000Z`
        ? config.startsAt
        : `${day}T00:00:00.000Z`;
    const candidates = this.sql
      .exec<{
        transaction_hash: string;
        wallet_address: string;
        confirmed_at: string;
      }>(
        `SELECT s.transaction_hash,s.wallet_address,s.confirmed_at
       FROM questline_verified_swaps s
       WHERE s.confirmed_at >= ? AND s.confirmed_at <= ? AND s.order_started_at >= ?
       AND NOT EXISTS (SELECT 1 FROM questline_completions c
         WHERE c.quest_id=? AND c.wallet_address=s.wallet_address AND c.utc_day=?)
       ORDER BY s.confirmed_at,s.transaction_hash LIMIT 200`,
        start,
        parsedNow,
        config.startsAt,
        config.questId,
        day,
      )
      .toArray();
    for (const candidate of candidates)
      this.sql.exec(
        `INSERT OR IGNORE INTO questline_completions
       (quest_id,wallet_address,utc_day,transaction_hash,confirmed_at,status,next_attempt_at)
       VALUES (?,?,?,?,?,'PENDING',?)`,
        config.questId,
        candidate.wallet_address,
        day,
        candidate.transaction_hash,
        candidate.confirmed_at,
        parsedNow,
      );
  }

  claim(questId: number, now: string): QuestlineJob | null {
    const candidate = this.sql
      .exec<QuestlineCandidate>(
        `SELECT quest_id,wallet_address,utc_day,transaction_hash,confirmed_at,attempts
       FROM questline_completions
       WHERE quest_id=? AND utc_day=? AND next_attempt_at <= ?
       AND (status='PENDING' OR (status='IN_FLIGHT' AND lease_until <= ?))
       ORDER BY next_attempt_at,wallet_address LIMIT 1`,
        questId,
        now.slice(0, 10),
        now,
        now,
      )
      .toArray()[0];
    if (!candidate) return null;
    const lease = crypto.randomUUID();
    const attempts = candidate.attempts + 1;
    this.sql.exec(
      `UPDATE questline_completions SET status='IN_FLIGHT',attempts=?,lease=?,lease_until=?
       WHERE quest_id=? AND wallet_address=? AND utc_day=?`,
      attempts,
      lease,
      new Date(Date.parse(now) + 60_000).toISOString(),
      questId,
      candidate.wallet_address,
      candidate.utc_day,
    );
    return { ...candidate, attempts, lease };
  }

  settle(
    job: QuestlineJob,
    outcome: {
      status: "ACCEPTED" | "PENDING" | "REJECTED";
      code: string;
      retryAfterMs?: number;
    },
    now: string,
  ) {
    const delay = Math.max(
      60_000,
      Math.min(
        outcome.retryAfterMs ?? 60_000 * 2 ** Math.min(job.attempts - 1, 6),
        60 * 60_000,
      ),
    );
    this.sql.exec(
      `UPDATE questline_completions SET status=?,next_attempt_at=?,last_code=?,accepted_at=?,lease=NULL,lease_until=NULL
       WHERE quest_id=? AND wallet_address=? AND utc_day=? AND status='IN_FLIGHT' AND lease=?`,
      outcome.status,
      new Date(Date.parse(now) + delay).toISOString(),
      outcome.code.slice(0, 80),
      outcome.status === "ACCEPTED" ? now : null,
      job.quest_id,
      job.wallet_address,
      job.utc_day,
      job.lease,
    );
  }

  summary(questId: number) {
    return this.sql
      .exec<{ status: string; count: number }>(
        "SELECT status,COUNT(*) AS count FROM questline_completions WHERE quest_id=? GROUP BY status",
        questId,
      )
      .toArray();
  }
}
