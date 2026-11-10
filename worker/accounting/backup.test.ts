// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { exportLedgerSql } from "./backup";

describe("financial ledger backup", () => {
  it("restores exact atomic amounts, text, blobs, indexes and append-only protections", () => {
    const source = new DatabaseSync(":memory:");
    const restored = new DatabaseSync(":memory:");
    try {
      source.exec(`CREATE TABLE ledger (id INTEGER PRIMARY KEY, atomic INTEGER, note TEXT, evidence BLOB);
        CREATE TABLE empty_table (id TEXT);
        CREATE UNIQUE INDEX unique_note ON ledger(note);
        CREATE TRIGGER immutable BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        INSERT INTO ledger VALUES (1, 9007199254740993, 'Alice''s reward', X'00ff10');`);
      source
        .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?)")
        .run(2, 10, "null\u0000byte 🛡", null);
      const backup = exportLedgerSql({
        exec<T extends Record<string, SqlStorageValue>>(
          query: string,
          ...bindings: SqlStorageValue[]
        ) {
          const rows = source
            .prepare(query)
            .all(
              ...bindings.map((value) =>
                value instanceof ArrayBuffer ? new Uint8Array(value) : value,
              ),
            ) as T[];
          return {
            toArray: () => rows,
            [Symbol.iterator]: () => rows[Symbol.iterator](),
          };
        },
      });
      expect(backup.counts).toEqual({ empty_table: 0, ledger: 2 });
      restored.exec(backup.sql);
      expect(
        restored
          .prepare(
            "SELECT CAST(atomic AS TEXT) AS atomic, note, hex(evidence) AS evidence FROM ledger ORDER BY id",
          )
          .all(),
      ).toEqual(
        source
          .prepare(
            "SELECT CAST(atomic AS TEXT) AS atomic, note, hex(evidence) AS evidence FROM ledger ORDER BY id",
          )
          .all(),
      );
      expect(
        restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
      expect(() => {
        restored.exec("UPDATE ledger SET atomic = 0");
      }).toThrow("immutable");
      expect(() => {
        restored.exec(
          "INSERT INTO ledger VALUES (3, 1, 'Alice''s reward', NULL)",
        );
      }).toThrow(/UNIQUE/);
    } finally {
      source.close();
      restored.close();
    }
  });
});
