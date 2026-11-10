// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  QuestlineLedger,
  recordQuestlineSwap,
  type QuestlineSql,
  type QuestlineSwap,
} from "./questline";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const config = { questId: 89, startsAt: "2026-10-20T10:00:00.000Z" };
const now = "2026-10-20T12:00:00.000Z";
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  const sql: QuestlineSql = {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...values: (string | number | null)[]
    ) {
      if (!values.length && !/^\s*(SELECT|WITH|PRAGMA)/i.test(query)) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const statement = db.prepare(query);
      const rows = statement.columns().length
        ? statement.all(...values).map((row) => row as T)
        : (statement.run(...values), []);
      return { toArray: () => rows };
    },
  };
  const ledger = new QuestlineLedger(sql);
  ledger.initialize();
  ledger.configure(config);
  const swap = (overrides: Partial<QuestlineSwap> = {}) => {
    recordQuestlineSwap(sql, {
      chainId: "solana-mainnet",
      wallet: "wallet",
      signature: crypto.randomUUID(),
      confirmedAt: "2026-10-20T11:00:00.000Z",
      orderStartedAt: "2026-10-20T10:59:00.000Z",
      valueCents: 500n,
      eligible: true,
      questId: 89,
      ...overrides,
    });
  };
  return { db, sql, ledger, swap };
}

describe("Questline verified daily completions", () => {
  it("requires an opted-in, confirmed eligible mainnet swap worth at least $5", () => {
    const { ledger, swap } = setup();
    swap({ questId: undefined });
    swap({ questId: 88 });
    swap({ eligible: false });
    swap({ chainId: "solana-devnet" });
    swap({ valueCents: 499n });
    ledger.enqueue(config, now);
    expect(ledger.claim(89, now)).toBeNull();
    swap();
    ledger.enqueue(config, now);
    expect(ledger.claim(89, now)).toMatchObject({
      quest_id: 89,
      wallet_address: "wallet",
      utc_day: "2026-10-20",
    });
  });
  it("excludes old quotes, earlier days and future receipts", () => {
    const { ledger, swap } = setup();
    swap({ orderStartedAt: "2026-10-20T09:59:59.999Z" });
    swap({
      orderStartedAt: "2026-10-19T12:00:00.000Z",
      confirmedAt: "2026-10-19T12:01:00.000Z",
    });
    swap({ confirmedAt: "2026-10-20T12:01:00.000Z" });
    ledger.enqueue(config, now);
    expect(ledger.claim(89, now)).toBeNull();
    expect(() =>
      ledger.configure({ ...config, startsAt: "2026-10-01T00:00:00.000Z" }),
    ).toThrow("cannot change");
  });
  it("collapses repeated swaps and retries to one completion per wallet/day", () => {
    const { ledger, swap } = setup();
    swap({ signature: "first" });
    swap({ signature: "first" });
    swap({ signature: "second" });
    ledger.enqueue(config, now);
    ledger.enqueue(config, now);
    const job = ledger.claim(89, now);
    expect(job).not.toBeNull();
    expect(ledger.claim(89, now)).toBeNull();
    if (!job) throw new Error("Missing job");
    ledger.settle(job, { status: "ACCEPTED", code: "HTTP_200" }, now);
    ledger.enqueue(config, "2026-10-20T13:00:00.000Z");
    expect(ledger.claim(89, "2026-10-20T13:00:00.000Z")).toBeNull();
    expect(ledger.summary(89)).toEqual([{ status: "ACCEPTED", count: 1 }]);
  });
  it("recovers after a worker restart and ignores a stale acknowledgement", () => {
    const { ledger, sql, swap } = setup();
    swap();
    ledger.enqueue(config, now);
    const old = ledger.claim(89, now);
    if (!old) throw new Error("Missing job");
    const recovered = new QuestlineLedger(sql);
    const job = recovered.claim(89, "2026-10-20T12:01:00.000Z");
    if (!job) throw new Error("Missing recovered job");
    expect(job.lease).not.toBe(old.lease);
    expect(job.attempts).toBe(2);
    recovered.settle(old, { status: "ACCEPTED", code: "LATE_ACK" }, now);
    expect(recovered.summary(89)).toEqual([{ status: "IN_FLIGHT", count: 1 }]);
    recovered.settle(
      job,
      { status: "ACCEPTED", code: "HTTP_200" },
      "2026-10-20T12:01:01.000Z",
    );
    expect(recovered.summary(89)).toEqual([{ status: "ACCEPTED", count: 1 }]);
  });
  it("backs off failures, expires old days and requires a fresh swap tomorrow", () => {
    const { ledger, swap } = setup();
    swap();
    ledger.enqueue(config, now);
    const job = ledger.claim(89, now);
    if (!job) throw new Error("Missing job");
    ledger.settle(
      job,
      { status: "PENDING", code: "HTTP_429", retryAfterMs: 120_000 },
      now,
    );
    expect(ledger.claim(89, "2026-10-20T12:01:00.000Z")).toBeNull();
    expect(ledger.claim(89, "2026-10-20T12:02:00.000Z")?.attempts).toBe(2);
    const tomorrow = "2026-10-21T00:01:00.000Z";
    ledger.enqueue(config, tomorrow);
    expect(ledger.claim(89, tomorrow)).toBeNull();
    expect(ledger.summary(89)).toEqual([{ status: "EXPIRED", count: 1 }]);
    swap({
      orderStartedAt: "2026-10-21T00:00:00.000Z",
      confirmedAt: "2026-10-21T00:00:30.000Z",
    });
    ledger.enqueue(config, tomorrow);
    expect(ledger.claim(89, tomorrow)?.utc_day).toBe("2026-10-21");
  });
  it("rolls back quest evidence when the containing swap-credit transaction fails", () => {
    const { db, ledger, swap } = setup();
    db.exec("BEGIN");
    swap();
    db.exec("ROLLBACK");
    ledger.enqueue(config, now);
    expect(ledger.claim(89, now)).toBeNull();
  });
});
