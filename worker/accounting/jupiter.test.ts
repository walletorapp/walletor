import { describe, expect, it } from "vitest";

import type {
  JupiterSwapExecutionEvidence,
  JupiterSwapOrderEvidence,
} from "../../shared/accounting-contracts";
import { deriveExecutedReferralFee, microUsdToCents } from "./jupiter";

const solMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const order: JupiterSwapOrderEvidence = {
  requestId: "order-1",
  walletAddress: solMint,
  inputMint: solMint,
  outputMint: usdcMint,
  inputAmountAtomic: "1000000000",
  outputAmountAtomic: "150000000",
  feeMint: usdcMint,
  quotedFeeAmountAtomic: "3000000",
  referralAccount: "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
  referralFeeBps: 200,
  partnerShareBps: 8000,
  valuationUsdDecimal: "150",
  valuationAmountAtomic: "150000000",
  registeredAt: "2026-08-07T12:00:00.000Z",
  expiresAt: "2026-08-07T12:10:00.000Z",
};

const execution: JupiterSwapExecutionEvidence = {
  requestId: "order-1",
  transactionHash:
    "5vP3dHkNQ3S5uTnY8MqNc4n6fL7xR2kJ9aB1cD4eF6gH7iJ8kL9mN2pQ3rS4tU5v",
  inputAmountResult: "1000000000",
  outputAmountResult: "150000000",
  totalInputAmount: "1000000000",
  totalOutputAmount: "147000000",
  verifiedReferralFeeAmountAtomic: null,
  verificationSource: "JUPITER_EXECUTE",
  confirmedAt: "2026-08-07T12:00:05.000Z",
};

describe("Jupiter referral accounting", () => {
  it("credits $0.40 to Walletor from a $100 swap with a 50-bps fee", () => {
    const fees = deriveExecutedReferralFee(
      {
        ...order,
        referralFeeBps: 50,
        outputAmountAtomic: "100000000",
        quotedFeeAmountAtomic: "500000",
        valuationUsdDecimal: "100",
        valuationAmountAtomic: "100000000",
      },
      {
        ...execution,
        outputAmountResult: "100000000",
        totalOutputAmount: "99500000",
      },
    );

    expect(fees).toEqual({
      totalFeeAmountAtomic: 500_000n,
      walletorFeeAmountAtomic: 400_000n,
      totalFeeEstimatedMicroUsd: 500_000n,
      walletorFeeEstimatedMicroUsd: 400_000n,
      swapEstimatedUsdCents: 10_000n,
    });
    expect(fees.totalFeeAmountAtomic - fees.walletorFeeAmountAtomic).toBe(
      100_000n,
    );
  });

  it("derives the exact output fee, Walletor share, and USD estimate", () => {
    expect(deriveExecutedReferralFee(order, execution)).toEqual({
      totalFeeAmountAtomic: 3_000_000n,
      walletorFeeAmountAtomic: 2_400_000n,
      totalFeeEstimatedMicroUsd: 3_000_000n,
      walletorFeeEstimatedMicroUsd: 2_400_000n,
      swapEstimatedUsdCents: 15_000n,
    });
    expect(microUsdToCents(2_400_000n)).toBe(240n);
  });

  it("uses sell-side value for rewards when output value falls below $5", () => {
    expect(
      deriveExecutedReferralFee(
        {
          ...order,
          valuationUsdDecimal: "4.98",
          rewardValuationUsdDecimal: "5.009548",
        },
        execution,
      ),
    ).toMatchObject({ swapEstimatedUsdCents: 500n });
  });

  it("uses a finalized referral transfer when a router omits execute totals", () => {
    expect(
      deriveExecutedReferralFee(
        {
          ...order,
          referralFeeBps: 50,
          partnerShareBps: 8000,
          quotedFeeAmountAtomic: null,
          outputAmountAtomic: "782891041",
          valuationUsdDecimal: "80",
          valuationAmountAtomic: "782891041",
        },
        {
          ...execution,
          inputAmountResult: null,
          outputAmountResult: null,
          totalInputAmount: null,
          totalOutputAmount: null,
          verifiedReferralFeeAmountAtomic: "3934125",
          verificationSource: "SOLANA_FINALIZED_TRANSACTION",
        },
      ),
    ).toMatchObject({
      totalFeeAmountAtomic: 3_934_125n,
      walletorFeeAmountAtomic: 3_147_300n,
      swapEstimatedUsdCents: 8_000n,
    });
  });

  it("treats finalized Solana fee evidence as authoritative", () => {
    expect(
      deriveExecutedReferralFee(
        {
          ...order,
          referralFeeBps: 50,
          partnerShareBps: 8000,
          feeMint: solMint,
          inputAmountAtomic: "69210600",
          quotedFeeAmountAtomic: "346053",
          outputAmountAtomic: "7218338",
          valuationUsdDecimal: "7.218338",
          valuationAmountAtomic: "69210600",
        },
        {
          ...execution,
          inputAmountResult: "69210600",
          totalInputAmount: "69210600",
          outputAmountResult: "7218338",
          totalOutputAmount: "7218338",
          verifiedReferralFeeAmountAtomic: "346053",
          verificationSource: "SOLANA_FINALIZED_TRANSACTION",
        },
      ),
    ).toMatchObject({
      totalFeeAmountAtomic: 346_053n,
      walletorFeeAmountAtomic: 276_842n,
      swapEstimatedUsdCents: 721n,
    });
  });

  it("rejects a confirmation that does not match its order", () => {
    expect(() =>
      deriveExecutedReferralFee(order, {
        ...execution,
        requestId: "another-order",
      }),
    ).toThrow("does not match");
  });

  it("rejects a successful execution that collected no referral fee", () => {
    expect(() =>
      deriveExecutedReferralFee(order, {
        ...execution,
        totalOutputAmount: execution.outputAmountResult,
      }),
    ).toThrow("did not collect a fee");
  });
});
