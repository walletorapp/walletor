// @vitest-environment node
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { leaderboardRoutes } from "./leaderboard-routes";
import { ApiFailure } from "./lib/http";
import { getPublicRankings } from "./accounting/runtime";
vi.mock("./accounting/runtime", () => ({ getPublicRankings: vi.fn() }));
const wallet = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const statement = {
  bind: vi.fn<D1PreparedStatement["bind"]>(),
  all: vi.fn(),
  first: vi.fn(),
  run: vi.fn(),
  raw: vi.fn(),
} satisfies D1PreparedStatement;
const db = {
  prepare: vi.fn(() => statement),
  batch: vi.fn(),
  exec: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required by the D1Database mock interface; never invoked.
  dump: vi.fn(),
  withSession: vi.fn(),
} satisfies D1Database;
const app = new Hono<{ Bindings: Partial<Env> }>();
app.route("/", leaderboardRoutes);
app.onError((error, c) =>
  c.json(
    { error: error.message },
    error instanceof ApiFailure ? error.status : 500,
  ),
);
beforeEach(() => {
  vi.resetAllMocks();
  statement.bind.mockReturnValue(statement);
  db.prepare.mockReturnValue(statement);
});
it("rejects invalid filters before touching either data store", async () => {
  for (const suffix of [
    "offset=-1",
    "offset=100001",
    "search=%25",
    "period=month",
    "wallet=not-a-wallet",
  ]) {
    const response = await app.request(
      `http://localhost/rankings?${suffix}`,
      undefined,
      { DB: db },
    );
    expect(response.status).toBe(400);
  }
  expect(db.prepare).not.toHaveBeenCalled();
  expect(getPublicRankings).not.toHaveBeenCalled();
});
it("includes a connected wallet outside the current page and keeps its response private", async () => {
  vi.mocked(getPublicRankings).mockResolvedValue({
    entries: [],
    yourPosition: {
      rank: 101,
      walletAddress: wallet,
      points: "2",
      eligibleSwaps: 1,
    },
    pagination: { offset: 0, total: 101, nextOffset: 25 },
    roundId: "round",
    roundEndsAt: "2026-09-29T00:00:00.000Z",
    serverTime: "2026-09-28T00:00:00.000Z",
  });
  statement.all.mockResolvedValue({
    results: [{ walletAddress: wallet, amount: "975000" }],
  });
  const response = await app.request(
    `http://localhost/rankings?wallet=${wallet}`,
    undefined,
    { DB: db, WALLETOR_PUBLIC_LAUNCH_AT: "2026-09-06T00:00:00.000Z" },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    yourPosition: { rank: 101, totalWonAtomic: "975000" },
  });
  expect(statement.bind).toHaveBeenCalledWith(
    "2026-09-06T00:00:00.000Z",
    "2026-09-06T00:00:00.000Z",
    JSON.stringify([wallet]),
  );
});
it("returns an honest unavailable response when storage is missing", async () => {
  const response = await app.request("http://localhost/winners", undefined, {});
  expect(response.status).toBe(503);
});
it("returns empty winner history with exact totals, without inventing entries", async () => {
  db.batch.mockResolvedValue([
    { results: [] },
    { results: [{ total: 0 }] },
    {
      results: [
        {
          claimedAtomic: "0",
          awardedAtomic: "0",
          winningWallets: 0,
          fundedDraws: 0,
        },
      ],
    },
  ]);
  const response = await app.request(
    "http://localhost/winners?offset=25",
    undefined,
    { DB: db },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    entries: [],
    pagination: { offset: 25, total: 0, nextOffset: null },
    totals: { claimedAtomic: "0" },
  });
});
