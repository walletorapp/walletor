import {
  FEE_RESERVE_BPS,
  FEE_RESERVE_POLICY,
  FeeReserveReportSchema,
} from "../../shared/fee-reserve-contracts";

interface Sql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): T[] };
}

export const FEE_RESERVE_SQL = `
CREATE TABLE IF NOT EXISTS fee_reserve_policy (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  policy TEXT NOT NULL, starts_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fee_reserve_receipts (
  chain_id TEXT NOT NULL, transaction_hash TEXT NOT NULL,
  fee_mint TEXT NOT NULL, policy TEXT NOT NULL,
  gross_atomic TEXT NOT NULL, reserved_atomic TEXT NOT NULL,
  pool_atomic TEXT NOT NULL, reserved_microusd TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(chain_id, transaction_hash)
);
CREATE TABLE IF NOT EXISTS fee_reserve_balances (
  fee_mint TEXT PRIMARY KEY, reserved_atomic TEXT NOT NULL,
  reserved_microusd TEXT NOT NULL, receipt_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fee_reserve_receipts_recent
ON fee_reserve_receipts(confirmed_at DESC, transaction_hash DESC);
CREATE TRIGGER IF NOT EXISTS fee_reserve_receipts_no_update
BEFORE UPDATE ON fee_reserve_receipts BEGIN
  SELECT RAISE(ABORT, 'fee reserve receipts are immutable');
END;
CREATE TRIGGER IF NOT EXISTS fee_reserve_receipts_no_delete
BEFORE DELETE ON fee_reserve_receipts BEGIN
  SELECT RAISE(ABORT, 'fee reserve receipts are immutable');
END;
CREATE TRIGGER IF NOT EXISTS fee_reserve_policy_no_update
BEFORE UPDATE ON fee_reserve_policy BEGIN
  SELECT RAISE(ABORT, 'fee reserve policy is immutable');
END;
CREATE TRIGGER IF NOT EXISTS fee_reserve_policy_no_delete
BEFORE DELETE ON fee_reserve_policy BEGIN
  SELECT RAISE(ABORT, 'fee reserve policy is immutable');
END;
`;

export function initializeFeeReserve(sql: Sql, startsAt: string) {
  if (!Number.isFinite(Date.parse(startsAt)))
    throw new Error("Invalid reserve start.");
  sql.exec(FEE_RESERVE_SQL);
  sql.exec(
    "INSERT OR IGNORE INTO fee_reserve_policy VALUES (1, ?, ?)",
    FEE_RESERVE_POLICY,
    startsAt,
  );
}

export function feeReserveStart(sql: Sql): string {
  const row = sql
    .exec<{ starts_at: string }>(
      "SELECT starts_at FROM fee_reserve_policy WHERE singleton = 1",
    )
    .toArray()[0];
  if (!row) throw new Error("Fee reserve policy is missing.");
  return row.starts_at;
}

/** Exact atomic reserve; rounding dust remains in the pool. USD is display only. */
export function splitFeeReserve(
  gross: bigint,
  grossMicroUsd: bigint,
  confirmedAt: string,
  startsAt: string,
) {
  if (
    gross < 0n ||
    grossMicroUsd < 0n ||
    !Number.isFinite(Date.parse(confirmedAt)) ||
    !Number.isFinite(Date.parse(startsAt))
  )
    throw new Error("Invalid fee reserve input.");
  const active = Date.parse(confirmedAt) >= Date.parse(startsAt);
  const reserved = active ? (gross * BigInt(FEE_RESERVE_BPS)) / 10_000n : 0n;
  const reservedMicroUsd = gross > 0n ? (grossMicroUsd * reserved) / gross : 0n;
  return {
    active,
    gross,
    reserved,
    pool: gross - reserved,
    reservedMicroUsd,
    poolMicroUsd: grossMicroUsd - reservedMicroUsd,
  };
}

/** Must run inside the same transaction as gross receipt and net pool credit. */
export function recordFeeReserve(
  sql: Sql,
  chainId: string,
  signature: string,
  mint: string,
  confirmedAt: string,
  split: ReturnType<typeof splitFeeReserve>,
) {
  if (!split.active) return;
  sql.exec(
    `INSERT INTO fee_reserve_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    chainId,
    signature,
    mint,
    FEE_RESERVE_POLICY,
    split.gross.toString(),
    split.reserved.toString(),
    split.pool.toString(),
    split.reservedMicroUsd.toString(),
    confirmedAt,
  );
  const old = sql
    .exec<{
      reserved_atomic: string;
      reserved_microusd: string;
      receipt_count: number;
    }>("SELECT * FROM fee_reserve_balances WHERE fee_mint = ?", mint)
    .toArray()[0];
  sql.exec(
    `INSERT INTO fee_reserve_balances VALUES (?, ?, ?, ?)
    ON CONFLICT(fee_mint) DO UPDATE SET reserved_atomic=excluded.reserved_atomic,
    reserved_microusd=excluded.reserved_microusd, receipt_count=excluded.receipt_count`,
    mint,
    (BigInt(old?.reserved_atomic ?? "0") + split.reserved).toString(),
    (BigInt(old?.reserved_microusd ?? "0") + split.reservedMicroUsd).toString(),
    (old?.receipt_count ?? 0) + 1,
  );
}

export function readFeeReserve(sql: Sql, now: string) {
  return FeeReserveReportSchema.parse({
    policy: FEE_RESERVE_POLICY,
    startsAt: feeReserveStart(sql),
    reserveBps: FEE_RESERVE_BPS,
    payoutEnabled: false,
    generatedAt: now,
    balances: sql
      .exec<{
        fee_mint: string;
        reserved_atomic: string;
        reserved_microusd: string;
        receipt_count: number;
      }>("SELECT * FROM fee_reserve_balances ORDER BY fee_mint")
      .toArray()
      .map((r) => ({
        feeMint: r.fee_mint,
        reservedAtomic: r.reserved_atomic,
        estimatedMicroUsd: r.reserved_microusd,
        receiptCount: r.receipt_count,
      })),
    receipts: sql
      .exec<{
        transaction_hash: string;
        fee_mint: string;
        gross_atomic: string;
        reserved_atomic: string;
        pool_atomic: string;
        confirmed_at: string;
      }>(
        "SELECT * FROM fee_reserve_receipts ORDER BY confirmed_at DESC, transaction_hash DESC LIMIT 100",
      )
      .toArray()
      .map((r) => ({
        transactionHash: r.transaction_hash,
        feeMint: r.fee_mint,
        grossAtomic: r.gross_atomic,
        reservedAtomic: r.reserved_atomic,
        poolAtomic: r.pool_atomic,
        confirmedAt: r.confirmed_at,
      })),
  });
}
