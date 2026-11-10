// @vitest-environment node
import { expect, it, vi } from "vitest";
import { LaunchTokenSchema } from "../../shared/launch-contracts";
import { LaunchLogos, launchImageUrl, launchMetadataUrl } from "./launch-logos";
import { parseLaunchEvent } from "./launch-board";

const mint = "So11111111111111111111111111111111111111112";
const cid = "Qm" + "a".repeat(44);
const uri = `ipfs://${cid}`;
const now = Date.parse("2026-11-09T12:00:00Z");
const image = "https://example.com/token.webp";
const token = () =>
  LaunchTokenSchema.parse({
    mint,
    name: "Example",
    symbol: "EX",
    eventType: "create",
    metadataUri: uri,
    observedAt: new Date(now).toISOString(),
    stage: "new",
    progressPercent: 12,
    poolAddress: null,
    logoUrl: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
  });
function store() {
  let value: unknown;
  return {
    get: () => Promise.resolve(structuredClone(value)),
    put: vi.fn((entries: unknown) => {
      value = structuredClone(entries);
      return Promise.resolve();
    }),
  };
}

it("preserves launch metadata URI independently of market measurements", () => {
  expect(
    parseLaunchEvent(
      {
        mint,
        name: "Example",
        symbol: "EX",
        pool: "pump",
        txType: "create",
        uri,
      },
      new Date(now).toISOString(),
    ),
  ).toMatchObject({ metadataUri: uri });
});

it("maps IPFS addresses to fixed public gateways and rejects arbitrary metadata fetches", () => {
  expect(launchMetadataUrl(uri)).toBe(`https://ipfs.io/ipfs/${cid}`);
  expect(launchMetadataUrl(`https://gateway.pinata.cloud/ipfs/${cid}`)).toBe(
    `https://ipfs.io/ipfs/${cid}`,
  );
  expect(launchMetadataUrl(`https://127.0.0.1/ipfs/${cid}`)).toBe(
    `https://ipfs.io/ipfs/${cid}`,
  );
  expect(launchMetadataUrl("https://127.0.0.1/secrets")).toBeNull();
  expect(launchMetadataUrl("https://example.com/metadata.json")).toBeNull();
  expect(launchMetadataUrl(`ipfs://${cid}/../secrets`)).toBeNull();
  expect(launchImageUrl("https://127.0.0.1/logo.png")).toBeNull();
  expect(launchImageUrl("data:image/svg+xml,test")).toBeNull();
  expect(
    launchImageUrl("https://user:password@example.com/logo.png"),
  ).toBeNull();
  expect(launchImageUrl(uri)).toBe(`https://ipfs.io/ipfs/${cid}`);
});

it("keeps identity images through market refreshes and restarts without retaining prices or stages", async () => {
  const storage = store();
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({
        image,
        website: "https://example.com",
        twitter: "https://x.com/example",
        telegram: "javascript:alert(1)",
      }),
    ),
  );
  const logos = new LaunchLogos(storage, fetcher);
  await logos.load();
  await logos.refresh([token()], now);
  const restarted = new LaunchLogos(storage, fetcher);
  await restarted.load();
  const fresh = token();
  fresh.stage = "unknown";
  restarted.apply([fresh], now + 600000);
  expect(fresh).toMatchObject({
    logoUrl: image,
    priceUsd: null,
    stage: "unknown",
    websiteUrl: "https://example.com/",
    twitterUrl: "https://x.com/example",
    telegramUrl: null,
  });
  await restarted.refresh([fresh], now + 600000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const expired = token();
  restarted.apply([expired], now + 86400001);
  expect(expired.logoUrl).toBeNull();
});

it("does not follow metadata redirects or accept unbounded responses, and caches failures", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://localhost/private" },
      }),
    ),
  );
  const logos = new LaunchLogos(store(), fetcher);
  await logos.refresh([token()], now);
  await logos.refresh([token()], now + 1000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  const missing = token();
  logos.apply([missing], now + 1000);
  expect(missing.logoUrl).toBeNull();
  fetcher.mockImplementation(() =>
    Promise.resolve(Response.json({ image, padding: "x".repeat(70000) })),
  );
  await logos.refresh([token()], now + 300000);
  logos.apply([missing], now + 300001);
  expect(missing.logoUrl).toBeNull();
});

it("bounds each background pass and never requests metadata without a validated mint and URI", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ image })),
  );
  const logos = new LaunchLogos(store(), fetcher);
  await logos.refresh(
    [
      { ...token(), mint: "invalid" },
      { ...token(), metadataUri: "https://internal.local" },
    ],
    now,
  );
  expect(fetcher).not.toHaveBeenCalled();
  await logos.refresh(Array.from({ length: 25 }, token), now);
  expect(fetcher).toHaveBeenCalledTimes(20);
});

it("uses indexed metadata for old events and respects the shared fallback reservation", async () => {
  const storage = store();
  const reserve = vi.fn(() => Promise.resolve(true));
  const fetcher = vi.fn<typeof fetch>((url) =>
    Promise.resolve(
      typeof url === "string" && url.includes("helius-rpc.com")
        ? Response.json({
            result: [
              {
                id: mint,
                content: {
                  files: [{ uri: null, cdn_uri: image }],
                  links: null,
                },
              },
              {
                id: "11111111111111111111111111111111",
                content: { links: { image: "https://example.com/wrong.png" } },
              },
            ],
          })
        : new Response(null, { status: 403 }),
    ),
  );
  const logos = new LaunchLogos(storage, fetcher, {
    apiKey: "test-only",
    reserve,
  });
  const legacy = { ...token(), metadataUri: undefined };
  await logos.refresh([legacy], now);
  const fresh = { ...legacy };
  logos.apply([fresh], now + 1000);
  expect(fresh.logoUrl).toBe(image);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  expect(JSON.parse(body)).toMatchObject({
    method: "getAssetBatch",
    params: { ids: [mint], options: { showFungible: true } },
  });
  const newer = new LaunchLogos(store(), fetcher, {
    apiKey: "test-only",
    reserve: () => Promise.resolve(false),
  });
  await newer.refresh([token()], now);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("supports Workers native metadata fetch without binding a class instance", async () => {
  const nativeLikeFetch: typeof fetch = function (this: unknown) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(Response.json({ image }));
  };
  const logos = new LaunchLogos(store(), nativeLikeFetch);
  await logos.refresh([token()], now);
  const current = token();
  logos.apply([current], now + 1000);
  expect(current.logoUrl).toBe(image);
});
