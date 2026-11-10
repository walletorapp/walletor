// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ZEALY_SCHEMA_SQL,
  verifyZealyDailySwap,
  zealyDayWindow,
  type ZealySql,
  type ZealyVerification,
} from "./zealy";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const input: ZealyVerification = {
  userId: "user",
  communityId: "community",
  subdomain: "walletor-6650",
  questId: "quest",
  requestId: "request",
  accounts: { wallet: "11111111111111111111111111111111" },
};
const start = "2026-09-30T20:10:00.000Z";
const now = "2026-09-30T21:00:00.000Z";
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE referral_fee_ledger (wallet_address TEXT, created_at TEXT, transaction_hash TEXT);
  CREATE TABLE processed_swaps (transaction_hash TEXT, chain_id TEXT, result_json TEXT, created_at TEXT);
  CREATE TABLE jupiter_swap_orders (transaction_hash TEXT, created_at TEXT, status TEXT);`);
  db.exec(ZEALY_SCHEMA_SQL);
  const sql: ZealySql = {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...values: string[]
    ) {
      const rows = db
        .prepare(query)
        .all(...values)
        .map((row) => row as T);
      return { toArray: () => rows };
    },
  };
  function swap({
    wallet = input.accounts.wallet,
    date = "2026-09-30T20:30:00.000Z",
    ordered = date,
    eligible = true,
    points = "2",
    status = "CREDITED",
    chain = "solana-mainnet",
    fee = true,
  }: {
    wallet?: string;
    date?: string;
    ordered?: string;
    eligible?: boolean;
    points?: string;
    status?: string;
    chain?: string;
    fee?: boolean;
  } = {}) {
    const tx = crypto.randomUUID();
    if (fee)
      db.prepare("INSERT INTO referral_fee_ledger VALUES (?, ?, ?)").run(
        wallet,
        date,
        tx,
      );
    db.prepare("INSERT INTO processed_swaps VALUES (?, ?, ?, ?)").run(
      tx,
      chain,
      JSON.stringify({ rewardEligible: eligible, wltPointsCredited: points }),
      date,
    );
    db.prepare("INSERT INTO jupiter_swap_orders VALUES (?, ?, ?)").run(
      tx,
      ordered,
      status,
    );
  }
  return { db, sql, swap };
}
describe("Zealy daily swap accounting", () => {
  it("resets at UTC midnight and applies the campaign cutoff", () => {
    expect(zealyDayWindow(now, start)).toMatchObject({
      day: "2026-09-30",
      start,
      active: true,
    });
    expect(zealyDayWindow("2026-10-01T00:00:00.000Z", start).start).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(zealyDayWindow(start, now).active).toBe(false);
  });
  it("requires a new eligible swap each day, independent of prize-pool round boundaries", () => {
    const { sql, swap } = setup();
    expect(verifyZealyDailySwap(sql, input, start, now)).toBe("NO_SWAP");
    swap();
    expect(verifyZealyDailySwap(sql, input, start, now)).toBe("VERIFIED");
    expect(
      verifyZealyDailySwap(sql, input, start, "2026-10-01T00:00:00.000Z"),
    ).toBe("NO_SWAP");
    swap({ date: "2026-10-01T00:00:00.000Z" });
    expect(
      verifyZealyDailySwap(sql, input, start, "2026-10-01T00:01:00.000Z"),
    ).toBe("VERIFIED");
  });
  it.each([
    { date: "2026-09-30T20:09:59.999Z" },
    { ordered: "2026-09-30T20:09:59.999Z" },
    { date: "2026-10-01T00:00:00.000Z" },
    { eligible: false },
    { points: "0" },
    { status: "PENDING" },
    { chain: "solana-devnet" },
    { fee: false },
    { wallet: "other" },
  ])("rejects ineligible evidence %j", (options) => {
    const { sql, swap } = setup();
    swap(options);
    expect(verifyZealyDailySwap(sql, input, start, now)).toBe("NO_SWAP");
  });
  it("makes retries idempotent and prevents wallet sharing, wallet switching, and duplicate daily quests", () => {
    const { sql, swap, db } = setup();
    swap();
    expect(verifyZealyDailySwap(sql, input, start, now)).toBe("VERIFIED");
    expect(
      verifyZealyDailySwap(sql, { ...input, requestId: "retry" }, start, now),
    ).toBe("VERIFIED");
    expect(
      verifyZealyDailySwap(sql, { ...input, userId: "second" }, start, now),
    ).toBe("WALLET_BOUND");
    expect(
      verifyZealyDailySwap(
        sql,
        { ...input, accounts: { wallet: "other" } },
        start,
        now,
      ),
    ).toBe("WALLET_BOUND");
    expect(
      verifyZealyDailySwap(sql, { ...input, questId: "second" }, start, now),
    ).toBe("OTHER_QUEST");
    expect(
      db.prepare("SELECT COUNT(*) n FROM zealy_daily_verifications").get()?.n,
    ).toBe(1);
  });
});
