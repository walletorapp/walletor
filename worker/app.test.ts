// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import { mint } from "../tests/fixtures";
import { app } from "./app";

describe("Walletor API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns health without an upstream secret", async () => {
    const response = await app.request("/api/health", undefined, {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "ok", service: "walletor-api" },
    });
  });

  it("keeps the RWA registry closed when Stocks are disabled", async () => {
    const response = await app.request("/api/rwa/assets", undefined, {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        stocksEnabled: false,
        tradingEnabled: false,
        assets: [],
      },
      meta: { source: "walletor-rwa-registry" },
    });
  });

  it("blocks the RWA registry for requests from the United States", async () => {
    const response = await app.request(
      "/api/rwa/assets",
      { headers: { "CF-IPCountry": "US" } },
      { ENABLE_STOCKS: "true", ENABLE_RWA_TRADING: "true" },
    );

    expect(response.status).toBe(451);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "RWA_UNAVAILABLE_IN_JURISDICTION",
        retryable: false,
      },
      meta: { country: "US" },
    });
  });

  it("blocks RWA quote creation in the United States before calling Jupiter", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.request(
      "/api/swap/order?market=rwa&inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo&amount=10000000",
      { headers: { "CF-IPCountry": "US" } },
      {
        JUPITER_API_KEY: "test-only",
        ENABLE_STOCKS: "true",
        ENABLE_RWA_TRADING: "true",
      },
    );

    expect(response.status).toBe(451);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RWA_UNAVAILABLE_IN_JURISDICTION" },
    });
  });

  it("cannot bypass the U.S. RWA block by labeling an approved stock as crypto", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.request(
      "/api/swap/order?market=crypto&inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo&amount=10000000",
      { headers: { "CF-IPCountry": "US" } },
      { JUPITER_API_KEY: "test-only" },
    );

    expect(response.status).toBe(451);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RWA_UNAVAILABLE_IN_JURISDICTION" },
    });
  });

  it("requires approved stock mints to use the protected RWA market", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.request(
      "/api/swap/order?market=crypto&inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo&amount=10000000",
      { headers: { "CF-IPCountry": "GB" } },
      { JUPITER_API_KEY: "test-only" },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RWA_MARKET_REQUIRED" },
    });
  });

  it("blocks RWA execution in the United States before submission", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.request(
      "/api/swap/execute",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "CF-IPCountry": "US",
        },
        body: JSON.stringify({
          signedTransaction: "a".repeat(200),
          requestId: "us-rwa-order",
          market: "rwa",
        }),
      },
      {
        JUPITER_API_KEY: "test-only",
        ENABLE_STOCKS: "true",
        ENABLE_RWA_TRADING: "true",
      },
    );

    expect(response.status).toBe(451);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RWA_UNAVAILABLE_IN_JURISDICTION" },
    });
  });

  it("keeps Walletor Admin fail-closed before Cloudflare Access is configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request("/admin/api/bootstrap", undefined, {});

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_ACCESS_NOT_CONFIGURED" },
    });
  });

  it.each([
    "/admin/api/bootstrap",
    "/admin/api/affiliates/segmento/preview",
    "/admin/api/influencers/report",
  ])("requires a signed Access assertion before reading %s", async (path) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request(path, undefined, {
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: "walletor.cloudflareaccess.com",
      CLOUDFLARE_ACCESS_AUD: "test-audience",
      ADMIN_ALLOWED_EMAILS: "admin@walletor.com",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_ACCESS_REQUIRED" },
    });
  });

  it("keeps fee-mint operations private when the admin secret is absent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request(
      "/api/internal/referral-fee-mints",
      undefined,
      {},
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REFERRAL_ADMIN_NOT_CONFIGURED" },
    });
  });

  it("rejects an invalid fee-mint operations bearer secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request(
      "/api/internal/referral-fee-mints",
      { headers: { authorization: "Bearer wrong" } },
      { REFERRAL_ADMIN_SECRET: "correct" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REFERRAL_ADMIN_UNAUTHORIZED" },
    });
  });

  it("rejects an invalid wallet claim lookup before reading the ledger", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request(
      "/api/wallets/not-a-solana-wallet/claims",
      undefined,
      {},
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SOLANA_ADDRESS" },
    });
  });

  it("rejects invalid public distribution pagination", async () => {
    const response = await app.request(
      "/api/prize-pool/distributions/solana:mainnet:prize-pool:2026-08-15?limit=101",
      undefined,
      {},
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_PAGINATION" },
    });
  });

  it("rejects invalid public Prize Draw pagination", async () => {
    const response = await app.request(
      "/api/prize-pool/draws/solana:mainnet:prize-pool:2026-09-02?limit=101",
      undefined,
      {},
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_PAGINATION" },
    });
  });

  it("rejects an invalid public distribution calendar month", async () => {
    const response = await app.request(
      "/api/prize-pool/distributions?month=16-2026",
      undefined,
      {},
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_DISTRIBUTION_MONTH" },
    });
  });

  it("returns a normalized connected-wallet SOL balance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { context: { slot: 1 }, value: 1_250_000_000 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const solMint = "So11111111111111111111111111111111111111112";
    const response = await app.request(
      `/api/wallet/balance?owner=${mint}&inputMint=${solMint}`,
      undefined,
      {},
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        owner: mint,
        inputMint: solMint,
        inputAmount: "1250000000",
        solAmount: "1250000000",
      },
      meta: { source: "solana" },
    });
  });

  it("sums every token account for the selected wallet mint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: 20_000_000 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            context: { slot: 1 },
            value: [
              {
                account: {
                  data: ["gE8SAAAAAAA=", "base64"],
                },
              },
              {
                account: {
                  data: ["4JMEAAAAAAA=", "base64"],
                },
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/wallet/balance?owner=${mint}&inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
      undefined,
      {},
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { inputAmount: "1500000", solAmount: "20000000" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the Helius RPC key on the Worker and uses it before public RPCs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: 20_000_000 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: [] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/wallet/balance?owner=${mint}&inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
      undefined,
      { HELIUS_API_KEY: "rpc-test-key" },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://mainnet.helius-rpc.com/?api-key=rpc-test-key",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://mainnet.helius-rpc.com/?api-key=rpc-test-key",
    );
  });

  it("returns exact connected-wallet holdings enriched by Helius", async () => {
    const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: 1_000_000_000 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            context: { slot: 1 },
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: usdcMint,
                        tokenAmount: { amount: "1250000", decimals: 6 },
                      },
                    },
                  },
                },
              },
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: usdcMint,
                        tokenAmount: { amount: "750000", decimals: 6 },
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: [] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            items: [
              {
                interface: "FungibleToken",
                id: usdcMint,
                content: {
                  metadata: { name: "USD Coin", symbol: "USDC" },
                  files: [
                    {
                      cdn_uri: "https://cdn.helius.example/usdc.png",
                    },
                  ],
                },
                token_info: {
                  symbol: "USDC",
                  decimals: 6,
                  price_info: { price_per_token: 1 },
                },
              },
            ],
            nativeBalance: {
              lamports: 1_000_000_000,
              price_per_sol: 100,
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/wallet/holdings?owner=${mint}`,
      undefined,
      { HELIUS_API_KEY: "holdings-test-key" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        owner: mint,
        holdings: [
          {
            mint: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
            amount: "1000000000",
            priceUsd: 100,
          },
          {
            mint: usdcMint,
            symbol: "USDC",
            name: "USD Coin",
            logoUrl: "https://cdn.helius.example/usdc.png",
            amount: "2000000",
            priceUsd: 1,
          },
        ],
      },
      meta: { source: "solana-helius" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(
        "https://mainnet.helius-rpc.com/?api-key=holdings-test-key",
      );
    }
  });

  it("rejects invalid connected-wallet holdings owners", async () => {
    const response = await app.request(
      "/api/wallet/holdings?owner=not-a-wallet",
      undefined,
      { HELIUS_API_KEY: "holdings-test-key" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SOLANA_ADDRESS" },
    });
  });

  it("normalizes trending tokens and sets shared cache policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            id: mint,
            symbol: "SOL",
            name: "Wrapped SOL",
            usdPrice: 150,
            liquidity: 1000,
            stats24h: { buyVolume: 600, sellVolume: 400 },
          },
        ]),
      ),
    );
    const response = await app.request("/api/tokens/trending", undefined, {
      JUPITER_API_KEY: "test-only",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=20");
    await expect(response.json()).resolves.toMatchObject({
      data: [{ address: mint, symbol: "SOL", priceUsd: 150 }],
    });
  });

  it("uses Jupiter's recent first-pool endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.request("/api/tokens/new", undefined, {
      JUPITER_API_KEY: "test-only",
    });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tokens/v2/recent"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "test-only" }),
      }),
    );
  });

  it("serves recent Jupiter tokens to the swap discovery picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            id: mint,
            symbol: "SOL",
            name: "Wrapped SOL",
            decimals: 9,
            firstPool: { createdAt: "2026-08-16T00:00:00.000Z" },
          },
        ]),
      ),
    );

    const response = await app.request(
      "/api/tokens/discovery?source=all",
      undefined,
      { JUPITER_API_KEY: "test-only" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          address: mint,
          source: "jupiter",
          discoveredAt: "2026-08-16T00:00:00.000Z",
        },
      ],
      meta: { source: "walletor-token-index" },
    });
  });

  it("keeps the Pump.fun ingestion endpoint disabled without its secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request(
      "/api/internal/tokens/pumpfun",
      { method: "POST", body: "[]" },
      {},
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TOKEN_INGEST_NOT_CONFIGURED" },
    });
  });

  it("searches Jupiter tokens for the swap selector", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        {
          id: mint,
          symbol: "SOL",
          name: "Wrapped SOL",
          decimals: 9,
          icon: "https://example.com/sol.png",
          isVerified: true,
          organicScore: 99,
          organicScoreLabel: "high",
          liquidity: 500_000,
          holderCount: 42,
          audit: {
            mintAuthorityDisabled: true,
            freezeAuthorityDisabled: true,
            topHoldersPercentage: 12.5,
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request("/api/tokens/search?q=SOL", undefined, {
      JUPITER_API_KEY: "test-only",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tokens/v2/search?query=SOL"),
      expect.any(Object),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          address: mint,
          symbol: "SOL",
          decimals: 9,
          isVerified: true,
          organicScore: 99,
          organicScoreLabel: "high",
          liquidityUsd: 500_000,
          holders: 42,
          mintAuthorityDisabled: true,
          freezeAuthorityDisabled: true,
          topHoldersPercent: 12.5,
        },
      ],
    });
  });

  it("rejects an empty swap-token search before calling Jupiter", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await app.request("/api/tokens/search?q=", undefined, {
      JUPITER_API_KEY: "test-only",
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enriches an exact-mint search with the Helius CDN logo", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://api.jup.ag/")) {
        return Promise.resolve(
          Response.json([
            {
              id: mint,
              symbol: "FRESH",
              name: "Fresh token",
              decimals: 6,
              icon: "https://origin.example/stale.png",
            },
          ]),
        );
      }
      if (url.startsWith("https://mainnet.helius-rpc.com/")) {
        return Promise.resolve(
          Response.json({
            result: {
              id: mint,
              content: {
                files: [
                  {
                    uri: "https://origin.example/token.png",
                    cdn_uri:
                      "https://cdn.helius-rpc.com/cdn-cgi/image/token.png",
                  },
                ],
                metadata: { name: "Fresh token", symbol: "FRESH" },
              },
              token_info: { decimals: 6 },
            },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/tokens/search?q=${mint}`,
      undefined,
      {
        JUPITER_API_KEY: "test-only",
        HELIUS_API_KEY: "helius-test-only",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          address: mint,
          logoUrl: "https://cdn.helius-rpc.com/cdn-cgi/image/token.png",
        },
      ],
    });
  });

  it("returns Helius metadata when an exact mint is not indexed by Jupiter", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://api.jup.ag/")) {
        return Promise.resolve(Response.json([]));
      }
      if (url.startsWith("https://mainnet.helius-rpc.com/")) {
        return Promise.resolve(
          Response.json({
            result: {
              id: mint,
              content: {
                metadata: { name: "Very New Token", symbol: "NEW" },
              },
              token_info: { decimals: 6 },
            },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/tokens/search?q=${mint}`,
      undefined,
      {
        JUPITER_API_KEY: "test-only",
        HELIUS_API_KEY: "helius-test-only",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          address: mint,
          symbol: "NEW",
          name: "Very New Token",
          source: "helius",
          isVerified: false,
          priceUsd: null,
          liquidityUsd: null,
        },
      ],
    });
  });

  it("normalizes Jupiter Price V3 data for validated mints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          [mint]: {
            usdPrice: 73.25,
            liquidity: 600_000_000,
            priceChange24h: 1.25,
            blockId: 400_000_000,
            decimals: 9,
          },
        }),
      ),
    );

    const response = await app.request(`/api/prices?ids=${mint}`, undefined, {
      JUPITER_API_KEY: "test-only",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=10");
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          address: mint,
          priceUsd: 73.25,
          priceChange24hPercent: 1.25,
        },
      ],
    });
  });

  it("maps Jupiter search data into token detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        {
          id: mint,
          symbol: "SOL",
          name: "Wrapped SOL",
          decimals: 9,
          totalSupply: "12345678901234567890",
          usdPrice: 150,
          mcap: 100_000,
          holderCount: 42,
          stats24h: {
            buyVolume: 600,
            sellVolume: 400,
            numBuys: 7,
            numSells: 3,
            numTraders: 8,
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(`/api/tokens/${mint}`, undefined, {
      JUPITER_API_KEY: "test-only",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/tokens/v2/search?query=${mint}`),
      expect.any(Object),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        address: mint,
        supply: "12345678901234567890",
        volume24hUsd: 1000,
        trades24h: 10,
        buys24h: 7,
        sells24h: 3,
        uniqueWallets24h: 8,
      },
      meta: { source: "jupiter" },
    });
  });

  it("reports rejected Jupiter credentials without exposing them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await app.request("/api/tokens/trending", undefined, {
      JUPITER_API_KEY: "test-only",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MARKET_DATA_AUTH_FAILED", retryable: false },
    });
  });

  it("rejects invalid token addresses before calling Jupiter", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request("/api/tokens/not-a-mint", undefined, {
      JUPITER_API_KEY: "test-only",
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SOLANA_ADDRESS", retryable: false },
    });
  });

  it("does not leak missing-secret details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request("/api/tokens/trending", undefined, {});
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MARKET_DATA_NOT_CONFIGURED" },
    });
  });

  it("proxies a validated Jupiter Swap V2 quote without caching it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        requestId: "order-123",
        transaction: null,
        inputMint: mint,
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "1000000000",
        outAmount: "150000000",
        otherAmountThreshold: "149000000",
        priceImpactPct: "0.01",
        inUsdValue: 150,
        outUsdValue: 149.9,
        router: "iris",
        mode: "ultra",
        feeBps: 2,
        feeMint: mint,
        platformFee: { feeBps: 2, feeMint: mint },
        gasless: false,
        signatureFeeLamports: 5_000,
        prioritizationFeeLamports: 20_000,
        routePlan: [
          {
            percent: 100,
            bps: 10_000,
            swapInfo: {
              label: "Orca Whirlpool",
              inputMint: mint,
              outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              inAmount: "1000000000",
              outAmount: "150000000",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/swap/order?inputMint=${mint}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`,
      undefined,
      { JUPITER_API_KEY: "test-only" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/swap/v2/order?"),
      expect.objectContaining({ method: "GET" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requestId: "order-123",
        outAmount: "150000000",
        errorCode: null,
        errorMessage: null,
        platformFee: { amount: null, feeBps: 2, feeMint: mint },
        routePlan: [{ label: "Orca Whirlpool" }],
        gasless: false,
        signatureFeeLamports: "5000",
        prioritizationFeeLamports: "20000",
      },
      meta: { source: "jupiter" },
    });
  });

  it("never adds Walletor referral fees to Stocks (RWA) orders", async () => {
    const appleMint = "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo";
    const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const referralAccount = "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        requestId: "rwa-order-no-walletor-fee",
        transaction: null,
        inputMint: usdcMint,
        outputMint: appleMint,
        inAmount: "100000000",
        outAmount: "400000000",
        otherAmountThreshold: "396000000",
        priceImpactPct: "0.01",
        inUsdValue: 100,
        outUsdValue: 99.9,
        router: "jupiterz",
        mode: "ultra",
        feeBps: 2,
        feeMint: usdcMint,
        platformFee: { amount: "2000", feeBps: 2, feeMint: usdcMint },
        gasless: false,
        routePlan: [],
        errorCode: null,
        errorMessage: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/swap/order?market=rwa&inputMint=${usdcMint}&outputMint=${appleMint}&amount=100000000`,
      undefined,
      {
        JUPITER_API_KEY: "test-only",
        JUPITER_REFERRAL_FEE_ENABLED: "true",
        JUPITER_REFERRAL_ACCOUNT: referralAccount,
        JUPITER_REFERRAL_FEE_BPS: "50",
        ENABLE_STOCKS: "true",
        ENABLE_RWA_TRADING: "true",
      },
    );

    expect(response.status).toBe(200);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("market")).toBeNull();
    expect(requestUrl.searchParams.get("referralAccount")).toBeNull();
    expect(requestUrl.searchParams.get("referralFee")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requestId: "rwa-order-no-walletor-fee",
        router: "jupiterz",
      },
    });
  });

  it("falls back from an unbuildable JupiterZ order to a fresh executable route", async () => {
    const orderBase = {
      inputMint: mint,
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inAmount: "1000000000",
      outAmount: "150000000",
      otherAmountThreshold: "149000000",
      priceImpactPct: "0.01",
      inUsdValue: 150,
      outUsdValue: 149.9,
      mode: "ultra",
      feeBps: 2,
      feeMint: mint,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...orderBase,
          requestId: "jupiterz-order",
          transaction: "",
          router: "jupiterz",
          errorCode: 3,
          errorMessage: "Quote could not be built into a transaction",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...orderBase,
          requestId: "metis-order",
          transaction: "base64-transaction",
          router: "metis",
          errorCode: null,
          errorMessage: null,
          lastValidBlockHeight: "300000000",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/swap/order?inputMint=${mint}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&taker=${mint}`,
      undefined,
      { JUPITER_API_KEY: "test-only" },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("excludeRouters=jupiterz");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requestId: "metis-order",
        transaction: "base64-transaction",
        router: "metis",
        lastValidBlockHeight: "300000000",
      },
    });
  });

  it("uses a standard Jupiter route when referral parameters block a sub-$5 swap", async () => {
    const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const referralAccount = "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "Failed to get quotes" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          requestId: "standard-sub-minimum-order",
          transaction: "base64-transaction",
          inputMint: mint,
          outputMint,
          inAmount: "4944533",
          outAmount: "518025",
          otherAmountThreshold: "515000",
          priceImpactPct: "0.01",
          inUsdValue: 0.52,
          outUsdValue: 0.51,
          router: "metis",
          mode: "ultra",
          referralAccount: null,
          feeBps: 42,
          feeMint: outputMint,
          platformFee: { amount: "100", feeBps: 2, feeMint: outputMint },
          gasless: true,
          signatureFeePayer: "jupiter",
          prioritizationFeePayer: "jupiter",
          rentFeePayer: "jupiter",
          routePlan: [],
          errorCode: null,
          errorMessage: null,
          lastValidBlockHeight: "300000000",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/swap/order?inputMint=${mint}&outputMint=${outputMint}&amount=4944533&taker=${mint}`,
      undefined,
      {
        JUPITER_API_KEY: "test-only",
        JUPITER_REFERRAL_FEE_ENABLED: "true",
        JUPITER_REFERRAL_ACCOUNT: referralAccount,
        JUPITER_REFERRAL_FEE_BPS: "50",
        JUPITER_PARTNER_SHARE_BPS: "8000",
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `referralAccount=${referralAccount}`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).not.toContain("referralAccount=");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requestId: "standard-sub-minimum-order",
        transaction: "base64-transaction",
        referralAccount: null,
      },
    });
  });

  it("only reports a swap as successful from Jupiter execute", async () => {
    const signer = Keypair.generate();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: SystemProgram.programId.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: signer.publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    transaction.sign([signer]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "Success",
          signature: "confirmed-signature",
          code: 0,
          inputAmountResult: "1000000000",
          outputAmountResult: "150000000",
          totalInputAmount: "1000000000",
          totalOutputAmount: "149900000",
        }),
      ),
    );
    const response = await app.request(
      "/api/swap/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          taker: signer.publicKey.toBase58(),
          requestId: "order-123",
        }),
      },
      { JUPITER_API_KEY: "test-only", SANCTIONS_SCREENING_ENABLED: "true" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "Success",
        signature: "confirmed-signature",
        code: 0,
        totalOutputAmount: "149900000",
      },
    });
  });
});
