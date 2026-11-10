import { describe, expect, it } from "vitest";

import type { SwapOrder } from "../../../shared/swap-contracts";
import {
  additionalExecutionFeeLabel,
  platformFeeLabel,
  quotedSwapFeeAmounts,
  swapFeeBreakdown,
} from "./fees";
import { SOL_TOKEN, USDC_TOKEN } from "./tokens";

const order: SwapOrder = {
  requestId: "fee-display-test",
  transaction: null,
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "1000000000",
  outAmount: "98750000",
  otherAmountThreshold: null,
  priceImpactPct: null,
  inUsdValue: null,
  outUsdValue: null,
  inUsdValueDecimal: null,
  outUsdValueDecimal: null,
  router: "metis",
  mode: "manual",
  referralAccount: "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
  walletorPartnerShareBps: 8000,
  feeBps: 50,
  feeMint: "So11111111111111111111111111111111111111112",
  platformFee: {
    amount: "5000000",
    feeBps: 50,
    feeMint: "So11111111111111111111111111111111111111112",
  },
  routePlan: [],
  gasless: false,
  signatureFeePayer: null,
  prioritizationFeePayer: null,
  rentFeePayer: null,
  signatureFeeLamports: null,
  prioritizationFeeLamports: null,
  rentFeeLamports: null,
  slippageBps: null,
  totalTimeMs: null,
  errorCode: null,
  errorMessage: null,
  lastValidBlockHeight: null,
};

describe("swap fee disclosure", () => {
  it("discloses the total rather than presenting the net Walletor share as the total", () => {
    expect(platformFeeLabel(order)).toBe("0.5% total swap fee");
    expect(swapFeeBreakdown(order)).toEqual({
      referral: "0.5%",
      walletor: "0.4%",
      jupiter: "0.1%",
    });
    expect(additionalExecutionFeeLabel(order)).toBeNull();
    expect(quotedSwapFeeAmounts(order, SOL_TOKEN, USDC_TOKEN)).toEqual({
      feeTokenSymbol: "SOL",
      total: "0.005 SOL",
      walletor: "0.004 SOL",
      jupiter: "0.001 SOL",
    });
  });

  it("discloses extra execution costs without attributing them to the pool", () => {
    const withExtraCosts = { ...order, feeBps: 75 };
    expect(platformFeeLabel(withExtraCosts)).toBe("0.75% total swap fee");
    expect(swapFeeBreakdown(withExtraCosts)?.walletor).toBe("0.4%");
    expect(additionalExecutionFeeLabel(withExtraCosts)).toBe("0.25%");
  });

  it("never guesses the split from a total that might contain extra costs", () => {
    expect(swapFeeBreakdown({ ...order, platformFee: null })).toBeNull();
    expect(
      swapFeeBreakdown({ ...order, walletorPartnerShareBps: null }),
    ).toBeNull();
    expect(swapFeeBreakdown({ ...order, referralAccount: null })).toBeNull();
    expect(platformFeeLabel({ ...order, feeBps: null })).toBe(
      "Total swap fee unavailable",
    );
    expect(
      quotedSwapFeeAmounts(
        { ...order, platformFee: null },
        SOL_TOKEN,
        USDC_TOKEN,
      ),
    ).toBeNull();
  });

  it("labels non-referral orders as platform fees, not Prize Pool contributions", () => {
    const withoutReferral = { ...order, referralAccount: null };
    expect(platformFeeLabel(withoutReferral)).toBe("0.5% platform fee");
    expect(platformFeeLabel({ ...withoutReferral, feeBps: 75 })).toBe(
      "0.5% platform · 0.75% total",
    );
  });
});
