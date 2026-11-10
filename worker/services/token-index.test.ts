import { describe, expect, it } from "vitest";

import type { SwapTokenSearchResult } from "../../shared/contracts";
import { mint } from "../../tests/fixtures";
import { mergeTokenResults } from "./token-index";

function token(
  overrides: Partial<SwapTokenSearchResult>,
): SwapTokenSearchResult {
  return {
    address: mint,
    symbol: "TOKEN",
    name: "Token",
    logoUrl: null,
    decimals: 6,
    isVerified: false,
    organicScore: null,
    organicScoreLabel: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    holders: null,
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    topHoldersPercent: null,
    source: "jupiter",
    discoveredAt: null,
    ...overrides,
  };
}

describe("mergeTokenResults", () => {
  it("preserves a webhook-resolved logo when Jupiter has no icon", () => {
    const [merged] = mergeTokenResults(
      [token({ source: "jupiter", logoUrl: null, isVerified: true })],
      [
        token({
          source: "pumpfun",
          logoUrl: "https://cdn.example/token.png",
        }),
      ],
    );

    expect(merged).toMatchObject({
      logoUrl: "https://cdn.example/token.png",
      source: "pumpfun",
      isVerified: true,
    });
  });

  it("keeps Pump.fun provenance while the compact index replaces legacy fields", () => {
    const [merged] = mergeTokenResults(
      [],
      [
        token({
          source: "pumpfun",
          logoUrl: "https://cdn.example/token.png",
          isVerified: true,
        }),
        token({ source: "jupiter", logoUrl: null, isVerified: false }),
      ],
    );

    expect(merged).toMatchObject({
      logoUrl: "https://cdn.example/token.png",
      source: "pumpfun",
      isVerified: true,
    });
  });
});
