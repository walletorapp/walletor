// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { app } from "../app";
import { getTokenChartMarket } from "./token-chart-market";

const mint = "So11111111111111111111111111111111111111112";
const first = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const second = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const pair = (pairAddress: string, usd: number) => ({
  chainId: "solana",
  pairAddress,
  baseToken: { address: mint },
  liquidity: { usd },
});
afterEach(() => vi.restoreAllMocks());

it("selects the most liquid valid Solana base-token pool and ignores quote-only matches", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json([
        pair(first, 10),
        pair(second, 20),
        {
          ...pair(first, 10000),
          baseToken: { address: first },
          quoteToken: { address: mint },
        },
        { ...pair(first, 10000), chainId: "ethereum" },
        pair("https://evil.example/", 10000),
      ]),
    ),
  );
  await expect(getTokenChartMarket(mint, fetcher)).resolves.toEqual({
    mint,
    pairAddress: second,
  });
  expect(fetcher).toHaveBeenCalledWith(
    `https://api.dexscreener.com/tokens/v1/solana/${mint}`,
    expect.objectContaining({ redirect: "manual" }),
  );
});

it("returns no chart rather than substituting an unrelated token", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json([{ ...pair(first, 1), baseToken: { address: first } }]),
    ),
  );
  await expect(getTokenChartMarket(mint, fetcher)).resolves.toEqual({
    mint,
    pairAddress: null,
  });
});

it.each([302, 429, 500])(
  "rejects upstream HTTP %s without following redirects",
  async (status) => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status })),
    );
    await expect(getTokenChartMarket(mint, fetcher)).rejects.toMatchObject({
      code: "CHART_MARKET_UNAVAILABLE",
      status: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("rejects malformed responses and invalid user addresses", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ invalid: true })),
  );
  await expect(getTokenChartMarket(mint, fetcher)).rejects.toMatchObject({
    code: "CHART_MARKET_UNAVAILABLE",
  });
  fetcher.mockClear();
  await expect(
    getTokenChartMarket("../private", fetcher),
  ).rejects.toMatchObject({ code: "INVALID_SOLANA_ADDRESS" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("exposes only the normalized public chart market through the Worker", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json([pair(first, 10)]),
  );
  const response = await app.request(
    `/api/tokens/${mint}/chart-market`,
    undefined,
    {},
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("s-maxage=30");
  await expect(response.json()).resolves.toMatchObject({
    data: { mint, pairAddress: first },
    meta: { source: "dexscreener" },
  });
});
