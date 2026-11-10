import { afterEach, describe, expect, it, vi } from "vitest";

import { mint } from "../../tests/fixtures";
import {
  assertVerifiedRwaPair,
  listRwaAssets,
  readRwaFeatureConfig,
  verifiedRwaAsset,
} from "./rwa-registry";

const appleMint = "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const unapprovedMint = "11111111111111111111111111111111";

describe("Walletor RWA registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps discovery and trading behind separate feature flags", () => {
    expect(
      readRwaFeatureConfig({
        ENABLE_STOCKS: "true",
        ENABLE_RWA_TRADING: "false",
        ENABLE_JUPITERZ_ROUTE_BADGE: "true",
      }),
    ).toMatchObject({
      stocksEnabled: true,
      tradingEnabled: false,
      jupiterzRouteBadgeEnabled: true,
      rewardsEnabled: false,
    });
  });

  it("recognizes an RWA only by its exact approved mint", () => {
    expect(verifiedRwaAsset(appleMint)).toMatchObject({
      ticker: "AAPL",
      tokenSymbol: "AAPLon",
      issuer: "Ondo Finance",
    });
    expect(verifiedRwaAsset(mint)).toBeNull();
  });

  it("rejects arbitrary ticker-copy tokens from the RWA market", () => {
    const enabled = {
      ENABLE_STOCKS: "true",
      ENABLE_RWA_TRADING: "true",
    };
    expect(() => {
      assertVerifiedRwaPair(enabled, appleMint, unapprovedMint);
    }).toThrow(expect.objectContaining({ code: "UNSUPPORTED_RWA_PAIR" }));
    expect(() => {
      assertVerifiedRwaPair(enabled, appleMint, usdcMint);
    }).not.toThrow();
  });

  it("enriches the fixed registry with current Jupiter prices", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const ids = new URL(url).searchParams.get("ids")?.split(",") ?? [];
        return Promise.resolve(
          Response.json(
            Object.fromEntries(
              ids.map((id, index) => [
                id,
                {
                  usdPrice: index === 0 ? 250.25 : 100 + index,
                  priceChange24h: index === 0 ? 1.5 : -0.5,
                  decimals: 9,
                  blockId: 400_000_000,
                },
              ]),
            ),
          ),
        );
      });
    vi.stubGlobal("fetch", fetcher);

    const assets = await listRwaAssets({
      ENABLE_STOCKS: "true",
      ENABLE_RWA_TRADING: "false",
      JUPITER_API_KEY: "test-only",
    });

    expect(assets).toHaveLength(7);
    expect(assets[0]).toMatchObject({
      mint: appleMint,
      priceUsd: 250.25,
      priceChange24hPercent: 1.5,
      tradingAvailability: "discovery_only",
      verified: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/price/v3?ids="),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "test-only" }),
      }),
    );
  });
});
