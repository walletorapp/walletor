// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { RANKINGS_SQL } from "./leaderboard";
import { PUBLIC_WINNERS_SQL, publicWinner } from "../services/public-winners";

describe("public leaderboard records", () => {
  it("ranks points before filtering, preserves ties, and scopes round activity", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE wlt_balances (wallet_address TEXT, lifetime_points INTEGER);
        CREATE TABLE wlt_ledger (wallet_address TEXT, round_id TEXT, delta INTEGER);
        CREATE TABLE participants (wallet_address TEXT, round_id TEXT, eligible_swap_count INTEGER);
        INSERT INTO wlt_balances VALUES ('A', 102), ('B', 4), ('C', 4), ('D', 0);
        INSERT INTO wlt_ledger VALUES ('A', 'old', 102), ('B', 'now', 2), ('C', 'now', 4);
        INSERT INTO participants VALUES ('A', 'old', 1), ('B', 'old', 1), ('B', 'now', 1), ('C', 'now', 2);`);
      const all = db
        .prepare(
          `${RANKINGS_SQL} SELECT * FROM ranked ORDER BY rank, walletAddress`,
        )
        .all("all", "all", "now", "all", "now");
      expect(
        all.map((row) => [
          row.walletAddress,
          row.rank,
          row.points,
          row.eligibleSwaps,
        ]),
      ).toEqual([
        ["A", 1, "102", 1],
        ["B", 2, "4", 2],
        ["C", 2, "4", 2],
      ]);
      expect(
        db
          .prepare(
            `${RANKINGS_SQL} SELECT rank FROM ranked WHERE walletAddress = ?`,
          )
          .get("all", "all", "now", "all", "now", "C")?.rank,
      ).toBe(2);
      const round = db
        .prepare(`${RANKINGS_SQL} SELECT * FROM ranked ORDER BY rank`)
        .all("round", "round", "now", "round", "now");
      expect(
        round.map((row) => [row.walletAddress, row.points, row.eligibleSwaps]),
      ).toEqual([
        ["C", "4", 2],
        ["B", "2", 1],
      ]);
    } finally {
      db.close();
    }
  });

  it("excludes unactivated, failed and prelaunch awards, preserves exact amounts", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE usdc_claim_distributions (round_id TEXT, status TEXT, activated_at TEXT, staged_at TEXT,
        gross_prize_amount_atomic TEXT, clawback_unix_timestamp TEXT, create_transaction_signature TEXT,
        randomness_commit_transaction_signature TEXT, randomness_reveal_transaction_signature TEXT,
        randomness_account TEXT, magicblock_evidence_json TEXT, merkle_root TEXT);
        CREATE TABLE usdc_claim_entitlements (entitlement_id TEXT, round_id TEXT, winner_address TEXT, winner_rank INTEGER,
        net_amount_atomic TEXT, status TEXT, claim_transaction_signature TEXT);`);
      const insert = db.prepare(
        "INSERT INTO usdc_claim_distributions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const sig = "2".repeat(88),
        wallet = "3".repeat(44);
      for (const [id, state, date, activated] of [
        [
          "live",
          "ACTIVE",
          "2026-09-27T00:00:00.000Z",
          "2026-09-27T01:00:00.000Z",
        ],
        [
          "closed",
          "CLOSED",
          "2026-09-27T00:00:00.000Z",
          "2026-09-27T01:00:00.000Z",
        ],
        ["staged", "STAGED", "2026-09-27T00:00:00.000Z", null],
        ["failed", "FAILED", "2026-09-27T00:00:00.000Z", null],
        ["unactivated", "ACTIVE", "2026-09-27T00:00:00.000Z", null],
        [
          "prelaunch",
          "ACTIVE",
          "2026-09-01T00:00:00.000Z",
          "2026-09-01T01:00:00.000Z",
        ],
      ] as const) {
        insert.run(
          id,
          state,
          activated,
          date,
          "9007199254740993",
          "1800000000",
          sig,
          sig,
          sig,
          wallet,
          id === "live" ? "{}" : null,
          "a".repeat(64),
        );
        db.prepare(
          "INSERT INTO usdc_claim_entitlements VALUES (?, ?, ?, 1, ?, ?, ?)",
        ).run(
          id,
          id,
          wallet,
          "9007199254740993",
          id === "live" ? "CLAIMED" : "CLAIMABLE",
          id === "live" ? sig : null,
        );
      }
      const rows = db
        .prepare(`${PUBLIC_WINNERS_SQL} SELECT * FROM winners ORDER BY roundId`)
        .all("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
      expect(rows.map((row) => row.roundId)).toEqual(["closed", "live"]);
      expect(
        publicWinner(rows[0] ?? {}, new Date("2026-09-28T00:00:00Z")).status,
      ).toBe("EXPIRED");
      const live = publicWinner(
        rows[1] ?? {},
        new Date("2030-01-01T00:00:00Z"),
      );
      expect(live.status).toBe("CLAIMED");
      expect(live.netAmountAtomic).toBe("9007199254740993");
      expect(live.randomnessProvider).toBe("MagicBlock");
      expect(
        publicWinner(
          { ...rows[1], status: "CLAIMABLE" },
          new Date("2030-01-01T00:00:00Z"),
        ).status,
      ).toBe("EXPIRED");
      expect(
        publicWinner(rows[0] ?? {}, new Date("2026-09-28T00:00:00Z"))
          .randomnessProvider,
      ).toBe("Switchboard");
    } finally {
      db.close();
    }
  });
});
