// @vitest-environment node
import { expect, it, vi } from "vitest";
import { LaunchTokenSchema } from "../../shared/launch-contracts";
import { BirdeyeLaunchSupplement } from "./birdeye-launches";

const mint = "So11111111111111111111111111111111111111112";
const now = Date.parse("2026-11-09T12:00:00.000Z");
const interval = 3 * 3600000;
const token = () =>
  LaunchTokenSchema.parse({
    mint,
    name: "Migrated token",
    symbol: "TOKEN",
    eventType: "migration",
    observedAt: new Date(now).toISOString(),
    stage: "migrated",
    progressPercent: 100,
    poolAddress: null,
    logoUrl: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
  });
function store(initial?: unknown) {
  let value = initial;
  return {
    get: () => Promise.resolve(structuredClone(value)),
    put: vi.fn((state: unknown) => {
      value = structuredClone(state);
      return Promise.resolve();
    }),
  };
}
const success = () =>
  Response.json({
    success: true,
    data: {
      address: mint,
      price: 0,
      marketCap: 123,
      liquidity: 456,
      v24hUSD: 789,
      logoURI: "https://example.com/token.png",
      holder: 0,
      trade24h: 0,
      buy24h: 0,
      sell24h: 0,
      extensions: {
        website: "https://example.com",
        twitter: "https://x.com/example",
        telegram: "https://t.me/example",
      },
      name: "Actual",
      symbol: "ACT",
    },
  });

it("fills only missing fields with validated data and persists shared cache across restarts", async () => {
  const storage = store();
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(success()));
  const first = token();
  first.marketCapUsd = 999;
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [first],
    "test-only",
    now,
  );
  expect(first).toMatchObject({
    priceUsd: 0,
    marketCapUsd: 999,
    liquidityUsd: 456,
    name: "Actual",
    stage: "migrated",
    holders: 0,
    transactions24h: 0,
    buys24h: 0,
    sells24h: 0,
    twitterUrl: "https://x.com/example",
  });
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringContaining("/defi/token_overview?address="),
    expect.objectContaining({
      redirect: "manual",
      headers: {
        "X-API-KEY": "test-only",
        "x-chain": "solana",
        accept: "application/json",
      },
    }),
  );
  expect(storage.put.mock.calls[0]?.[0]).toMatchObject({
    attempts: [now],
    nextAt: now + interval,
  });
  const second = token();
  second.stage = "unknown";
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [second],
    "test-only",
    now + 10000,
  );
  expect(second.priceUsd).toBe(0);
  expect(second.stage).toBe("unknown");
  const stale = token();
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [stale],
    "test-only",
    now + 61000,
  );
  expect(stale.priceUsd).toBeNull();
  expect(stale.logoUrl).toBe("https://example.com/token.png");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("caps requests across instances and resumes only after the rolling window expires", async () => {
  const storage = store({
    attempts: Array.from({ length: 1333 }, () => now),
    nextAt: 0,
  });
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(success()));
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [token()],
    "test-only",
    now + interval,
  );
  expect(fetcher).not.toHaveBeenCalled();
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [token()],
    "test-only",
    now + 31 * 86400000,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("charges failed attempts, rejects redirects without forwarding credentials, and backs off denied access", async () => {
  const storage = store();
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com" },
      }),
    ),
  );
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [token()],
    "test-only",
    now,
  );
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [token()],
    "test-only",
    now + 1000,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 403 })),
  );
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [token()],
    "test-only",
    now + interval,
  );
  await new BirdeyeLaunchSupplement(storage, fetcher).enrich(
    [token()],
    "test-only",
    now + interval + 3600000,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await storage.get()).toMatchObject({
    attempts: [now, now + interval],
    nextAt: now + interval + 86400000,
  });
});

it("fails closed on invalid budget state or storage errors without disrupting the board", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await new BirdeyeLaunchSupplement(
    store({ attempts: "corrupt" }),
    fetcher,
  ).enrich([token()], "test-only", now);
  await new BirdeyeLaunchSupplement(
    {
      get: () => Promise.reject(new Error("storage failed")),
      put: () => Promise.resolve(),
    },
    fetcher,
  ).enrich([token()], "test-only", now);
  expect(fetcher).not.toHaveBeenCalled();
});

it("ignores missing keys, invalid mints and mismatched provider identities", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({
        success: true,
        data: { address: "11111111111111111111111111111111", price: 900 },
      }),
    ),
  );
  const supplement = new BirdeyeLaunchSupplement(store(), fetcher);
  await supplement.enrich([token()], undefined, now);
  await supplement.enrich([{ ...token(), mint: "invalid" }], "test-only", now);
  expect(fetcher).not.toHaveBeenCalled();
  const unchanged = token();
  await supplement.enrich([unchanged], "test-only", now);
  expect(unchanged.priceUsd).toBeNull();
});

it("coalesces concurrent snapshots before reserving or sending another request", async () => {
  const storage = store();
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(success()));
  const supplement = new BirdeyeLaunchSupplement(storage, fetcher);
  await Promise.all(
    Array.from({ length: 20 }, () =>
      supplement.enrich([token()], "test-only", now),
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("supports Workers native fetch functions without rebinding their receiver", async () => {
  const nativeLikeFetch: typeof fetch = function (this: unknown) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(success());
  };
  const current = token();
  await new BirdeyeLaunchSupplement(store(), nativeLikeFetch).enrich(
    [current],
    "test-only",
    now,
  );
  expect(current.priceUsd).toBe(0);
});
