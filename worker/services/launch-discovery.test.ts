// @vitest-environment node
import { expect, it, vi } from "vitest";
import { LaunchTokenSchema } from "../../shared/launch-contracts";
import { LaunchDiscovery } from "./launch-discovery";

const now = Date.parse("2026-11-09T20:00:00Z");
const mint = "7owLEuw5JpXDMdiqRb1aq3ZEx6HbuZwzDUS2HwQ6pump";
const item = {
  address: mint,
  name: "Example",
  symbol: "EX",
  market_cap: 45000,
  price: 0,
  liquidity: 0,
  volume_24h_usd: 0,
  holder: 0,
  trade_24h_count: 0,
  logo_uri: "https://example.com/logo.png",
  extensions: { twitter: "https://x.com/example" },
  stage: "almost",
  progressPercent: 99,
};
const reply = () => Response.json({ success: true, data: { items: [item] } });
function storage(initial?: unknown, overview?: unknown) {
  let state = initial;
  return {
    get: () => Promise.resolve(structuredClone(state)),
    put: vi.fn((value: unknown) => {
      state = structuredClone(value);
      return Promise.resolve();
    }),
    overviewBudget: () => Promise.resolve(overview),
  };
}
const emptyState = () => ({
  attempts: [],
  nextAt: 0,
  candidates: [],
  checkedAt: null,
  available: false,
});
const unknown = () =>
  LaunchTokenSchema.parse({
    mint,
    name: "Migrated token",
    symbol: "TOKEN",
    eventType: "create",
    observedAt: new Date(now).toISOString(),
    stage: "unknown",
    progressPercent: null,
    poolAddress: null,
    logoUrl: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
  });

it("discovers older Pump.fun candidates without trusting market cap or an upstream stage claim", async () => {
  const store = storage();
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(reply()));
  const discovery = new LaunchDiscovery(store, fetcher);
  const result = await discovery.snapshot("test-only", now);
  expect(result).toMatchObject({
    available: true,
    events: [{ mint, name: "Example", eventType: "create" }],
  });
  expect(result.events[0]).not.toHaveProperty("stage");
  const state = await store.get();
  expect(state).toMatchObject({
    attempts: [now],
    nextAt: now + 2 * 3600000,
    candidates: [{ stage: "unknown", progressPercent: null }],
  });
  expect(fetcher.mock.calls[0]?.[0]).toContain("platform_name=pump.fun");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: "manual",
    headers: { "X-API-KEY": "test-only" },
  });
  const token = unknown();
  discovery.apply([token], now + 1000);
  expect(token).toMatchObject({
    stage: "unknown",
    progressPercent: null,
    priceUsd: 0,
    holders: 0,
    name: "Example",
    twitterUrl: "https://x.com/example",
  });
  const later = unknown();
  discovery.apply([later], now + 61000);
  expect(later.priceUsd).toBeNull();
  expect(later.logoUrl).toBe("https://example.com/logo.png");
});

it("shares the cached candidate pool across restarts and preserves first observation times", async () => {
  const store = storage();
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(reply()));
  await new LaunchDiscovery(store, fetcher).snapshot("test-only", now);
  const restarted = new LaunchDiscovery(store, fetcher);
  expect(
    (await restarted.snapshot("test-only", now + 10000)).events,
  ).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const refreshed = await restarted.snapshot("test-only", now + 2 * 3600000);
  expect(refreshed.events[0]?.observedAt).toBe(new Date(now).toISOString());
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("counts failed requests and backs off access errors rather than resetting the budget", async () => {
  const store = storage();
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 403 })),
  );
  const result = await new LaunchDiscovery(store, fetcher).snapshot(
    "test-only",
    now,
  );
  expect(result).toMatchObject({ available: false, events: [] });
  expect(await store.get()).toMatchObject({
    attempts: [now],
    nextAt: now + 86400000,
  });
  await new LaunchDiscovery(store, fetcher).snapshot(
    "test-only",
    now + 3 * 3600000,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("caps discovery and accounts for existing overview usage without resetting either budget", async () => {
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(reply()));
  const maxed = storage({
    ...emptyState(),
    attempts: Array.from({ length: 380 }, () => now),
  });
  await new LaunchDiscovery(maxed, fetcher).snapshot("test-only", now);
  expect(fetcher).not.toHaveBeenCalled();
  const legacy = storage(undefined, {
    attempts: Array.from({ length: 1333 }, () => now),
    nextAt: 0,
  });
  await new LaunchDiscovery(legacy, fetcher).snapshot("test-only", now);
  expect(fetcher).not.toHaveBeenCalled();
  await new LaunchDiscovery(maxed, fetcher).snapshot(
    "test-only",
    now + 31 * 86400000,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("fails closed on damaged budget records and rejects missing credentials and invalid mints", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({
        success: true,
        data: { items: [{ ...item, address: "invalid" }] },
      }),
    ),
  );
  await new LaunchDiscovery(storage({ bad: true }), fetcher).snapshot(
    "test-only",
    now,
  );
  await new LaunchDiscovery(
    storage(undefined, { bad: true }),
    fetcher,
  ).snapshot("test-only", now);
  await new LaunchDiscovery(storage(), fetcher).snapshot(undefined, now);
  expect(fetcher).not.toHaveBeenCalled();
  const result = await new LaunchDiscovery(storage(), fetcher).snapshot(
    "test-only",
    now,
  );
  expect(result.available).toBe(false);
  expect(result.events).toHaveLength(0);
});

it("never follows redirects with the credential and coalesces concurrent calls", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com" },
      }),
    ),
  );
  const discovery = new LaunchDiscovery(storage(), fetcher);
  await Promise.all(
    Array.from({ length: 10 }, () => discovery.snapshot("test-only", now)),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
});

it("distinguishes a successful empty screener response from an unavailable provider", async () => {
  const result = await new LaunchDiscovery(storage(), () =>
    Promise.resolve(Response.json({ success: true, data: { items: [] } })),
  ).snapshot("test-only", now);
  expect(result).toMatchObject({
    events: [],
    available: true,
    checkedAt: new Date(now).toISOString(),
  });
});

it("supports Workers native fetch functions that reject an incorrect receiver", async () => {
  const nativeLikeFetch: typeof fetch = function (this: unknown) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(reply());
  };
  const result = await new LaunchDiscovery(storage(), nativeLikeFetch).snapshot(
    "test-only",
    now,
  );
  expect(result.available).toBe(true);
  expect(result.events).toHaveLength(1);
});

it("retries the corrected request version once without erasing earlier reserved usage", async () => {
  const store = storage({
    ...emptyState(),
    attempts: [now],
    nextAt: now + 86400000,
    requestVersion: 2,
    failure: "request-type-error",
  });
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(reply()));
  await new LaunchDiscovery(store, fetcher).snapshot("test-only", now + 1000);
  await new LaunchDiscovery(store, fetcher).snapshot("test-only", now + 2000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await store.get()).toMatchObject({
    attempts: [now, now + 1000],
    available: true,
  });
});
