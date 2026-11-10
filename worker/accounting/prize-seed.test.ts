// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  applyDailyPrizeSeed,
  PRIZE_SEED_SQL,
  type SeedSql,
} from "./prize-seed";

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => {
    db.close();
  });
});
const start = "2026-10-05T10:52:43.671Z";
function setup(funded = true) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(PRIZE_SEED_SQL);
  db.exec(`CREATE TABLE rounds(round_id TEXT, status TEXT, start_time TEXT, end_time TEXT);
    CREATE TABLE pool_state(singleton INTEGER, active_round_id TEXT, current_balance_microusd TEXT, current_balance_cents INTEGER, treasury_seed_cents INTEGER, updated_at TEXT, chain_id TEXT);
    CREATE TABLE ledger(ledger_entry_id TEXT, round_id TEXT, chain_id TEXT, transaction_hash TEXT, action TEXT, amount_cents INTEGER, idempotency_key TEXT UNIQUE, reason TEXT, created_at TEXT);
    INSERT INTO pool_state VALUES(1,'round-0','250001',25,0,'','solana-mainnet');`);
  db.prepare(
    "INSERT INTO prize_seed_campaign VALUES(1,'treasury','account',?,?,?,?,?)",
  ).run(
    start,
    funded ? start : null,
    funded ? "deposit" : null,
    funded ? start : null,
    funded ? "2026-10-12T10:52:43.671Z" : null,
  );
  const sql: SeedSql = {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: (string | number | null)[]
    ) {
      const rows = db
        .prepare(query)
        .all(...bindings)
        .map((row) => row as T);
      return { toArray: () => rows };
    },
  };
  function round(index: number, duration = 86_400_000) {
    const begins = new Date(
      Date.parse(start) + index * 86_400_000,
    ).toISOString();
    const ends = new Date(Date.parse(begins) + duration).toISOString();
    db.prepare("INSERT INTO rounds VALUES(?,'OPEN',?,?)").run(
      `round-${String(index)}`,
      begins,
      ends,
    );
    db.prepare("UPDATE pool_state SET active_round_id = ?").run(
      `round-${String(index)}`,
    );
  }
  const apply = () => {
    db.exec("BEGIN");
    try {
      const result = applyDailyPrizeSeed(sql, "treasury", start);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return { db, sql, round, apply };
}

it("adds real seeded funds to fees without losing fractions and cannot double-credit retries", () => {
  const { db, round, apply } = setup();
  round(0);
  expect(apply()).toBe(true);
  expect(apply()).toBe(false);
  expect(
    db
      .prepare(
        "SELECT current_balance_microusd,current_balance_cents,treasury_seed_cents FROM pool_state",
      )
      .get(),
  ).toMatchObject({
    current_balance_microusd: "100250001",
    current_balance_cents: 10025,
    treasury_seed_cents: 10000,
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM ledger").get()?.n).toBe(1);
});
it("allocates exactly seven daily seeds and stops without manufacturing an eighth", () => {
  const { db, round, apply } = setup();
  for (let day = 0; day < 9; day++) {
    round(day);
    db.prepare(
      "UPDATE pool_state SET current_balance_microusd='0',current_balance_cents=0",
    ).run();
    expect(apply()).toBe(day < 7);
  }
  expect(
    db.prepare("SELECT treasury_seed_cents FROM pool_state").get()
      ?.treasury_seed_cents,
  ).toBe(70000);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM prize_seed_rounds").get()?.n,
  ).toBe(7);
});
it("does not credit a prepared but unfunded reserve", () => {
  const { round, apply } = setup(false);
  round(0);
  expect(apply()).toBe(false);
});
it("does not seed an earlier round, a partial recovery round or a changed cadence", () => {
  const { round, apply } = setup();
  round(-1);
  expect(apply()).toBe(false);
  round(0.5);
  expect(apply()).toBe(false);
  round(1, 3_600_000);
  expect(apply()).toBe(false);
});
it("prevents a renamed round from taking a second seed for the same day", () => {
  const { db, round, apply } = setup();
  round(0);
  expect(apply()).toBe(true);
  db.exec(
    "UPDATE rounds SET round_id='recovery'; UPDATE pool_state SET active_round_id='recovery'",
  );
  expect(apply()).toBe(false);
});
it("rolls back the reserve and pool if ledger recording fails", () => {
  const { db, round, apply } = setup();
  round(0);
  db.exec(
    "CREATE TRIGGER fail_ledger BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'ledger failed'); END",
  );
  expect(apply).toThrow("ledger failed");
  expect(
    db.prepare("SELECT current_balance_microusd FROM pool_state").get()
      ?.current_balance_microusd,
  ).toBe("250001");
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM prize_seed_rounds").get()?.n,
  ).toBe(0);
});
it("refuses to attribute an existing reserve to a changed treasury", () => {
  const { sql, round } = setup();
  round(0);
  expect(() => applyDailyPrizeSeed(sql, "changed-wallet", start)).toThrow(
    "different distribution wallet",
  );
});
