import { afterEach, describe, expect, it, vi } from "vitest";

import { retrySwapAccounting } from "./swap";

describe("swap accounting recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the verified Prize Pool and WLT receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          status: "CREDITED",
          walletorAccounting: {
            duplicate: false,
            swapId: "swap-verified",
            roundId: "solana:mainnet:prize-pool:2026-08-28",
            rewardEligible: true,
            eligibilityReason: "ELIGIBLE",
            prizePoolContributionMicroUsd: "100000",
            prizePoolContributionCents: "10",
            platformRevenueCents: "0",
            wltPointsCredited: "2",
            resultingPrizePoolMicroUsd: "110000",
            resultingPrizePoolCents: "11",
          },
        },
        meta: {
          source: "walletor-ledger",
          fetchedAt: "2026-08-28T17:40:00.000Z",
          requestId: "request-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await retrySwapAccounting("confirmed-signature");

    expect(result).toMatchObject({
      status: "CREDITED",
      walletorAccounting: {
        rewardEligible: true,
        wltPointsCredited: "2",
        resultingPrizePoolMicroUsd: "110000",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/swap/accounting/confirmed-signature",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
