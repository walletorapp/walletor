// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { ADMIN_UNFUNDED_DRAWS_SQL } from "./admin-draws";

it("keeps earlier unpaid and staged rounds visible after an empty latest hour", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE rounds (round_id TEXT, total_pool_cents INTEGER,
      start_time TEXT, end_time TEXT);
      CREATE TABLE prize_draws (round_id TEXT, participant_count INTEGER);`);
    const round = db.prepare("INSERT INTO rounds VALUES (?, ?, ?, ?)");
    const draw = db.prepare("INSERT INTO prize_draws VALUES (?, ?)");
    const paid: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = `paid-${String(i)}`;
      round.run(
        id,
        180,
        "2026-09-09T09:00:00.000Z",
        "2026-09-09T10:00:00.000Z",
      );
      draw.run(id, 1);
      paid.push(id);
    }
    for (const [id, cents, participants, end] of [
      ["earlier-unpaid", 180, 1, "2026-09-10T10:00:00.000Z"],
      ["staged-recovery", 200, 2, "2026-09-10T11:00:00.000Z"],
      ["latest-empty", 0, 0, "2026-09-10T13:00:00.000Z"],
      ["no-participants", 200, 0, "2026-09-10T13:00:00.000Z"],
      ["still-open", 200, 1, "2026-09-10T15:00:00.000Z"],
    ] as const) {
      round.run(id, cents, "2026-09-10T09:00:00.000Z", end);
      draw.run(id, participants);
    }
    const rows = db
      .prepare(ADMIN_UNFUNDED_DRAWS_SQL)
      .all("2026-09-10T14:00:00.000Z", JSON.stringify(paid));
    expect(rows.map((row) => [row.round_id, row.total_pool_cents])).toEqual([
      ["earlier-unpaid", 180],
      ["staged-recovery", 200],
    ]);
  } finally {
    db.close();
  }
});
