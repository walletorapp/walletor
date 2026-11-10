import { Hono } from "hono";
import {
  LeaderboardQuerySchema,
  LeaderboardResponseSchema,
  WinnersResponseSchema,
} from "../shared/leaderboard-contracts";
import { getPublicRankings } from "./accounting/runtime";
import { readPublicLaunchAt } from "./lib/launch-config";
import { ApiFailure } from "./lib/http";
import { PUBLIC_WINNERS_SQL, publicWinner } from "./services/public-winners";

export const leaderboardRoutes = new Hono<{ Bindings: Partial<Env> }>();
leaderboardRoutes.get("/:view", async (c) => {
  const view = c.req.param("view");
  if (view !== "winners" && view !== "rankings") return c.notFound();
  const parsed = LeaderboardQuerySchema.safeParse(c.req.query());
  if (!parsed.success)
    throw new ApiFailure(
      400,
      "INVALID_LEADERBOARD_QUERY",
      "Enter a valid wallet search or page.",
      false,
    );
  const db = c.env.DB;
  if (!db)
    throw new ApiFailure(
      503,
      "LEADERBOARD_UNAVAILABLE",
      "Leaderboard records are temporarily unavailable.",
      true,
    );
  const query = parsed.data;
  const launchAt = readPublicLaunchAt(c.env);
  const now = new Date();
  c.header(
    "Cache-Control",
    query.wallet ? "private, no-store" : "public, max-age=15",
  );
  if (view === "rankings") {
    const ranks = await getPublicRankings(c.env, query);
    const wallets = [
      ...new Set([
        ...ranks.entries.map((entry) => entry.walletAddress),
        ...(ranks.yourPosition ? [ranks.yourPosition.walletAddress] : []),
      ]),
    ];
    const totals = wallets.length
      ? await db
          .prepare(
            `${PUBLIC_WINNERS_SQL}
      SELECT walletAddress, CAST(SUM(CAST(netAmountAtomic AS INTEGER)) AS TEXT) AS amount
      FROM winners WHERE walletAddress IN (SELECT value FROM json_each(?)) GROUP BY walletAddress`,
          )
          .bind(launchAt, launchAt, JSON.stringify(wallets))
          .all<{ walletAddress: string; amount: string }>()
      : { results: [] };
    const won = new Map(
      totals.results.map((row) => [row.walletAddress, row.amount]),
    );
    return c.json(
      LeaderboardResponseSchema.parse({
        ...ranks,
        entries: ranks.entries.map((entry) => ({
          ...entry,
          totalWonAtomic: won.get(entry.walletAddress) ?? "0",
        })),
        yourPosition: ranks.yourPosition
          ? {
              ...ranks.yourPosition,
              totalWonAtomic: won.get(ranks.yourPosition.walletAddress) ?? "0",
            }
          : null,
      }),
    );
  }
  const results = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `${PUBLIC_WINNERS_SQL} SELECT * FROM winners WHERE instr(walletAddress, ?) > 0 ORDER BY date DESC, roundId, rank LIMIT 25 OFFSET ?`,
      )
      .bind(launchAt, launchAt, query.search, query.offset),
    db
      .prepare(
        `${PUBLIC_WINNERS_SQL} SELECT COUNT(*) AS total FROM winners WHERE instr(walletAddress, ?) > 0`,
      )
      .bind(launchAt, launchAt, query.search),
    db
      .prepare(
        `${PUBLIC_WINNERS_SQL} SELECT
      CAST(COALESCE(SUM(CASE WHEN status = 'CLAIMED' THEN CAST(netAmountAtomic AS INTEGER) ELSE 0 END), 0) AS TEXT) AS claimedAtomic,
      CAST(COALESCE(SUM(CAST(netAmountAtomic AS INTEGER)), 0) AS TEXT) AS awardedAtomic,
      COUNT(DISTINCT walletAddress) AS winningWallets, COUNT(DISTINCT roundId) AS fundedDraws FROM winners`,
      )
      .bind(launchAt, launchAt),
  ]);
  const [rows, count, totals] = results;
  if (!rows || !count || !totals) throw new Error("Winner records unavailable");
  const total = Number(count.results[0]?.total ?? 0);
  return c.json(
    WinnersResponseSchema.parse({
      entries: rows.results.map((row) => publicWinner(row, now)),
      pagination: {
        offset: query.offset,
        total,
        nextOffset: query.offset + 25 < total ? query.offset + 25 : null,
      },
      totals: totals.results[0],
      serverTime: now.toISOString(),
    }),
  );
});
