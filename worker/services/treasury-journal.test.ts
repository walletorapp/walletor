// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomic, transactionResolution } from "./treasury-journal";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(
    readFileSync(
      new URL(
        "../../migrations/0013_treasury_funding_journal.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}
function insert(db: DatabaseSync, id: string, round = "round-1") {
  db.prepare(
    `INSERT INTO treasury_operations (operation_id,round_id,kind,mint,input_amount_atomic,minimum_output_atomic,
    status,signature,signed_transaction,last_valid_block_height,created_at)
    VALUES (?,?,'COLLECT','mint','0','0','SIGNED',?,'payload','100','2026-09-09')`,
  ).run(id, round, id);
}

describe("treasury recovery journal", () => {
  it("uses atomic integers above JavaScript's safe integer range", () => {
    expect(atomic("900719925474099312345")).toBe(900719925474099312345n);
    for (const value of ["-1", "1.2", "01", "1e8", ""])
      expect(() => atomic(value)).toThrow();
  });
  it("prevents two unresolved spends across different rounds", () => {
    const db = database();
    insert(db, "first");
    expect(() => {
      insert(db, "second", "round-2");
    }).toThrow(/UNIQUE/);
  });
  it("keeps signed identities immutable and allows retry only after resolution", () => {
    const db = database();
    insert(db, "first");
    expect(() => {
      db.exec(
        "UPDATE treasury_operations SET signed_transaction = 'different'",
      );
    }).toThrow(/immutable/);
    db.exec("UPDATE treasury_operations SET status = 'EXPIRED'");
    insert(db, "retry");
    expect(() => {
      db.exec("DELETE FROM treasury_operations");
    }).toThrow(/append-only/);
    expect(() => {
      db.exec(
        "UPDATE treasury_operations SET status = 'SIGNED' WHERE operation_id = 'first'",
      );
    }).toThrow(/immutable/);
  });
  it("prevents a second successful operation for the same round and mint", () => {
    const db = database();
    insert(db, "first");
    db.exec(
      "UPDATE treasury_operations SET status = 'FINALIZED', output_amount_atomic = '100'",
    );
    expect(() => {
      insert(db, "second");
    }).toThrow(/UNIQUE/);
  });
  it("makes fee sources and round reservations immutable", () => {
    const db = database();
    db.exec(
      "INSERT INTO round_fee_sources VALUES ('source','round','tx','mint','100')",
    );
    expect(() => {
      db.exec(
        "INSERT INTO round_fee_sources VALUES ('other','round2','tx','mint','100')",
      );
    }).toThrow(/UNIQUE/);
    db.exec(
      "INSERT INTO round_usdc_funding VALUES ('round','authority','100','[]','now')",
    );
    expect(() => {
      db.exec("UPDATE round_usdc_funding SET amount_atomic = '999'");
    }).toThrow(/immutable/);
    expect(() => {
      db.exec(
        "INSERT INTO round_usdc_funding VALUES ('round','authority','100','[]','now')",
      );
    }).toThrow(/UNIQUE/);
  });
  it("waits for finalized height and checks the signature again before expiry", async () => {
    const getSignatureStatuses = vi
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: [null] });
    const getBlockHeight = vi.fn().mockResolvedValue(99);
    const rpc = { getSignatureStatuses, getBlockHeight };
    expect(await transactionResolution(rpc, "tx", "100")).toBe("PENDING");
    getBlockHeight.mockResolvedValue(101);
    expect(await transactionResolution(rpc, "tx", "100")).toBe("EXPIRED");
    expect(getBlockHeight).toHaveBeenCalledWith("finalized");
    expect(getSignatureStatuses).toHaveBeenCalledTimes(3);
  });
  it("does not renew a confirmed transaction or a late-indexed finalized one", async () => {
    const finalized = {
      context: { slot: 1 },
      value: [
        {
          slot: 1,
          confirmations: null,
          err: null,
          confirmationStatus: "finalized",
        },
      ],
    };
    const getSignatureStatuses = vi
      .fn()
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [null] })
      .mockResolvedValue(finalized);
    const getBlockHeight = vi.fn().mockResolvedValue(200);
    expect(
      await transactionResolution(
        { getSignatureStatuses, getBlockHeight },
        "tx",
        "100",
      ),
    ).toBe("FINALIZED");
    getSignatureStatuses.mockResolvedValue({
      context: { slot: 1 },
      value: [
        {
          slot: 1,
          confirmations: 1,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    });
    expect(
      await transactionResolution(
        { getSignatureStatuses, getBlockHeight },
        "tx",
        "100",
      ),
    ).toBe("PENDING");
  });
  it("does not swallow RPC failures as expired transactions", async () => {
    const getSignatureStatuses = vi
      .fn()
      .mockRejectedValue(new Error("RPC unavailable"));
    await expect(
      transactionResolution(
        { getSignatureStatuses, getBlockHeight: vi.fn() },
        "tx",
        "100",
      ),
    ).rejects.toThrow("RPC unavailable");
  });
});
