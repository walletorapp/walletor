import { describe, expect, it, vi } from "vitest";

import { mint } from "../../tests/fixtures";
import {
  executeSwap,
  getSwapOrder,
  getSwapOrderWithSubMinimumFallback,
} from "./jupiter-swap";

const referralAccount = "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function referralOrder(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "walletor-referral-order",
    transaction: null,
    inputMint: mint,
    outputMint: usdcMint,
    inAmount: "1000000000",
    outAmount: "145000000",
    otherAmountThreshold: "144000000",
    priceImpactPct: "0.01",
    inUsdValue: 150,
    outUsdValue: 145,
    router: "metis",
    mode: "manual",
    referralAccount,
    feeBps: 50,
    feeMint: usdcMint,
    platformFee: {
      amount: "750000",
      feeBps: 50,
      feeMint: usdcMint,
    },
    routePlan: [],
    ...overrides,
  };
}

describe("Jupiter Swap V2 referrals", () => {
  it("normalizes current JupiterZ RFQ identity and expiration fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        referralOrder({
          router: "jupiterz",
          priceImpact: 0,
          quoteId: "rfq-quote-1",
          maker: mint,
          expireAt: "2026-09-04T18:00:00.000Z",
        }),
      ),
    );

    const order = await getSwapOrder(
      {
        market: "rwa",
        inputMint: mint,
        outputMint: usdcMint,
        amount: "1000000000",
      },
      "test-only",
      fetcher,
    );

    expect(order).toMatchObject({
      market: "rwa",
      router: "jupiterz",
      priceImpact: 0,
      priceImpactPct: "0",
      quoteId: "rfq-quote-1",
      maker: mint,
      expireAt: "2026-09-04T18:00:00.000Z",
    });
  });

  it("keeps Walletor's risk-gate wallet field out of Jupiter's execute payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "Success",
        signature: "confirmed-signature",
        code: 0,
        inputAmountResult: "100",
        outputAmountResult: "99",
        totalInputAmount: "100",
        totalOutputAmount: "99",
      }),
    );

    await executeSwap(
      {
        signedTransaction: "a".repeat(200),
        requestId: "order-123",
        taker: mint,
        lastValidBlockHeight: "300000000",
      },
      "test-only",
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.body).toBe(
      JSON.stringify({
        signedTransaction: "a".repeat(200),
        requestId: "order-123",
        lastValidBlockHeight: "300000000",
      }),
    );
  });

  it("sends and verifies Walletor's 50-bps referral fee", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(referralOrder()));

    const order = await getSwapOrder(
      {
        inputMint: mint,
        outputMint: usdcMint,
        amount: "1000000000",
        referral: {
          account: referralAccount,
          feeBps: 50,
          partnerShareBps: 8000,
        },
      },
      "test-only",
      fetcher,
    );

    const requestInput = fetcher.mock.calls[0]?.[0];
    expect(typeof requestInput).toBe("string");
    if (typeof requestInput !== "string") return;
    const requestUrl = new URL(requestInput);
    expect(requestUrl.searchParams.get("referralAccount")).toBe(
      referralAccount,
    );
    expect(requestUrl.searchParams.get("referralFee")).toBe("50");
    expect(order).toMatchObject({
      referralAccount,
      feeBps: 50,
      walletorPartnerShareBps: 8000,
      feeMint: usdcMint,
      platformFee: { feeBps: 50 },
    });
  });

  it("fails closed when Jupiter cannot apply the configured fee", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        referralOrder({
          referralAccount: null,
          feeBps: 2,
          platformFee: { amount: "30000", feeBps: 2, feeMint: usdcMint },
        }),
      ),
    );

    await expect(
      getSwapOrder(
        {
          inputMint: mint,
          outputMint: usdcMint,
          amount: "1000000000",
          referral: {
            account: referralAccount,
            feeBps: 50,
            partnerShareBps: 8000,
          },
        },
        "test-only",
        fetcher,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "JUPITER_REFERRAL_FEE_UNAVAILABLE",
      feeMint: usdcMint,
      retryable: false,
    });
  });

  it.each([100, 200])(
    "rejects a different returned referral rate of %i bps",
    async (feeBps) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          referralOrder({
            feeBps,
            platformFee: { amount: "1000000", feeBps, feeMint: usdcMint },
          }),
        ),
      );
      await expect(
        getSwapOrder(
          {
            inputMint: mint,
            outputMint: usdcMint,
            amount: "1000000000",
            referral: {
              account: referralAccount,
              feeBps: 50,
              partnerShareBps: 8000,
            },
          },
          "test-only",
          fetcher,
        ),
      ).rejects.toMatchObject({
        code: "JUPITER_REFERRAL_FEE_UNAVAILABLE",
      });
    },
  );

  it("accepts any Solana fee mint when Jupiter proves the referral fee", async () => {
    const newPumpMint = mint;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        referralOrder({
          inputMint: newPumpMint,
          feeMint: newPumpMint,
          platformFee: {
            amount: "5000000",
            feeBps: 50,
            feeMint: newPumpMint,
          },
        }),
      ),
    );

    await expect(
      getSwapOrder(
        {
          inputMint: newPumpMint,
          outputMint: usdcMint,
          amount: "1000000000",
          referral: {
            account: referralAccount,
            feeBps: 50,
            partnerShareBps: 8000,
          },
        },
        "test-only",
        fetcher,
      ),
    ).resolves.toMatchObject({ feeMint: newPumpMint });
  });

  it("uses Jupiter's standard executable route when a referral blocks a sub-minimum swap", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "Failed to get quotes" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          referralOrder({
            requestId: "standard-sub-minimum-order",
            transaction: "unsigned-transaction",
            inUsdValue: 0.52,
            inUsdValueDecimal: "0.52",
            outUsdValue: 0.51,
            referralAccount: null,
            feeBps: 42,
            platformFee: {
              amount: "10000",
              feeBps: 2,
              feeMint: usdcMint,
            },
          }),
        ),
      );

    const resolution = await getSwapOrderWithSubMinimumFallback(
      {
        inputMint: mint,
        outputMint: usdcMint,
        amount: "4944533",
        taker: mint,
        referral: {
          account: referralAccount,
          feeBps: 50,
          partnerShareBps: 8000,
        },
      },
      500n,
      "test-only",
      fetcher,
    );

    expect(resolution).toMatchObject({
      usedSubMinimumFallback: true,
      order: {
        requestId: "standard-sub-minimum-order",
        referralAccount: null,
        walletorPartnerShareBps: null,
      },
    });
    const fallbackInput = fetcher.mock.calls[1]?.[0];
    expect(typeof fallbackInput).toBe("string");
    if (typeof fallbackInput !== "string") return;
    const fallbackUrl = new URL(fallbackInput);
    expect(fallbackUrl.searchParams.has("referralAccount")).toBe(false);
    expect(fallbackUrl.searchParams.has("referralFee")).toBe(false);
  });

  it("does not bypass Walletor's verified referral route for a reward-eligible swap", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "Failed to get quotes" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          referralOrder({
            requestId: "standard-eligible-order",
            transaction: "unsigned-transaction",
            inUsdValue: 5,
            inUsdValueDecimal: "5.00",
            referralAccount: null,
            feeBps: 2,
            platformFee: {
              amount: "10000",
              feeBps: 2,
              feeMint: usdcMint,
            },
          }),
        ),
      );

    await expect(
      getSwapOrderWithSubMinimumFallback(
        {
          inputMint: mint,
          outputMint: usdcMint,
          amount: "5000000",
          taker: mint,
          referral: {
            account: referralAccount,
            feeBps: 50,
            partnerShareBps: 8000,
          },
        },
        500n,
        "test-only",
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "JUPITER_SWAP_REJECTED" });
  });
});
