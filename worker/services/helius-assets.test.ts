import { describe, expect, it, vi } from "vitest";

import { mint } from "../../tests/fixtures";
import { getHeliusTokenMetadata } from "./helius-assets";

describe("Helius fungible-token metadata", () => {
  it("prefers the Helius CDN image for an exact mint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        jsonrpc: "2.0",
        result: {
          id: mint,
          content: {
            files: [
              {
                uri: "https://origin.example/token.png",
                cdn_uri: "https://cdn.helius-rpc.com/cdn-cgi/image/token.png",
              },
            ],
            metadata: { name: "Fresh token", symbol: "FRESH" },
          },
          token_info: { decimals: 6 },
        },
      }),
    );

    await expect(
      getHeliusTokenMetadata(mint, "server-secret", fetcher),
    ).resolves.toEqual({
      mint,
      logoUrl: "https://cdn.helius-rpc.com/cdn-cgi/image/token.png",
      name: "Fresh token",
      symbol: "FRESH",
      decimals: 6,
    });
    const body = fetcher.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") return;
    const requestBody: unknown = JSON.parse(body);
    expect(requestBody).toMatchObject({
      method: "getAsset",
      params: { id: mint, displayOptions: { showFungible: true } },
    });
  });

  it("returns no metadata when Helius is unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("down"));
    await expect(
      getHeliusTokenMetadata(mint, "server-secret", fetcher),
    ).resolves.toBeNull();
  });
});
