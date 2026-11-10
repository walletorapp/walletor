import { describe, expect, it } from "vitest";

import type {
  JupiterSwapExecutionEvidence,
  JupiterSwapOrderEvidence,
} from "../../shared/accounting-contracts";
import {
  buildStablecoinRecoveryOrder,
  getFinalizedSolanaTransactionEvidence,
  verifiedReferralFeeFromTransaction,
  type FinalizedSolanaTransactionEvidence,
} from "./solana-referral-verification";

const wallet = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const referral = "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ";
const solMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const order: JupiterSwapOrderEvidence = {
  requestId: "jupiterz-order",
  walletAddress: wallet,
  inputMint: usdcMint,
  outputMint: solMint,
  inputAmountAtomic: "81084332",
  outputAmountAtomic: "782891041",
  feeMint: solMint,
  quotedFeeAmountAtomic: null,
  referralAccount: referral,
  referralFeeBps: 50,
  partnerShareBps: 8000,
  valuationUsdDecimal: "80",
  valuationAmountAtomic: "782891041",
  registeredAt: "2026-08-31T15:40:00.000Z",
  expiresAt: "2026-08-31T15:50:00.000Z",
};

const transaction: FinalizedSolanaTransactionEvidence = {
  transactionHash:
    "5qQ867SmsH9r4E8XNtYkJck41nNAMDfMeGMCRajgH4UBYcq2u9GBuLXFSSZ32SeqvguWaFEojYP5BH1kvcby2uRa",
  confirmedAt: "2026-08-31T15:41:37.000Z",
  signerAddresses: ["Grr9WnZdcetQywtFXog81UhqmnJyvFhb4AT3ipw44mZP", wallet],
  preTokenBalances: [
    { owner: referral, mint: solMint, amount: 20_736_040n },
    { owner: wallet, mint: usdcMint, amount: 81_084_332n },
  ],
  postTokenBalances: [
    { owner: referral, mint: solMint, amount: 24_670_165n },
    { owner: wallet, mint: usdcMint, amount: 0n },
  ],
};

describe("finalized Solana referral verification", () => {
  it.each([
    { preLamports: 119972709, postLamports: 120937248, expected: 964539n },
    { preLamports: 120937248, postLamports: 120937248, expected: 0n },
  ])(
    "excludes earlier unsynchronized SOL with pre-balance $preLamports",
    async ({ preLamports, postLamports, expected }) => {
      // Real Sept 24 failure: syncNative raised token units by 1,331,668,
      // although this transaction transferred only 964,539 lamports.
      const evidence = await getFinalizedSolanaTransactionEvidence(
        transaction.transactionHash,
        "test-key",
        () =>
          Promise.resolve(
            Response.json({
              result: {
                blockTime: Date.parse(transaction.confirmedAt) / 1000,
                meta: {
                  err: null,
                  preBalances: [preLamports],
                  postBalances: [postLamports],
                  preTokenBalances: [
                    {
                      accountIndex: 0,
                      owner: referral,
                      mint: solMint,
                      uiTokenAmount: { amount: "118117140" },
                    },
                  ],
                  postTokenBalances: [
                    {
                      accountIndex: 0,
                      owner: referral,
                      mint: solMint,
                      uiTokenAmount: { amount: "119448808" },
                    },
                  ],
                },
                transaction: {
                  message: { accountKeys: [{ pubkey: wallet, signer: true }] },
                },
              },
            }),
          ),
      );
      expect(evidence).not.toBeNull();
      if (!evidence) throw new Error("Expected finalized transaction evidence");
      const reportedOrder = { ...order, quotedFeeAmountAtomic: "964539" };
      if (expected > 0n) {
        expect(
          verifiedReferralFeeFromTransaction(evidence, reportedOrder),
        ).toBe(expected);
        expect(() =>
          verifiedReferralFeeFromTransaction(evidence, {
            ...reportedOrder,
            quotedFeeAmountAtomic: "1331668",
          }),
        ).toThrow("does not match");
      } else {
        expect(() =>
          verifiedReferralFeeFromTransaction(evidence, reportedOrder),
        ).toThrow("did not credit");
      }
    },
  );

  const movedOrder: JupiterSwapOrderEvidence = {
    ...order,
    inputAmountAtomic: "122070715117",
    outputAmountAtomic: "100347980",
    quotedFeeAmountAtomic: "504261",
    valuationAmountAtomic: "100347980",
  };
  const movedTransaction: FinalizedSolanaTransactionEvidence = {
    ...transaction,
    preTokenBalances: [{ owner: referral, mint: solMint, amount: 0n }],
    postTokenBalances: [{ owner: referral, mint: solMint, amount: 473560n }],
  };
  const execution: JupiterSwapExecutionEvidence = {
    requestId: movedOrder.requestId,
    transactionHash: movedTransaction.transactionHash,
    inputAmountResult: "122070715117",
    outputAmountResult: "94238496",
    totalInputAmount: null,
    totalOutputAmount: null,
    verifiedReferralFeeAmountAtomic: null,
    verificationSource: "JUPITER_EXECUTE",
    confirmedAt: movedTransaction.confirmedAt,
  };

  it("reconciles the reported price movement against the linked execution and exact chain fee", () => {
    expect(() =>
      verifiedReferralFeeFromTransaction(movedTransaction, movedOrder, {
        maxQuoteVariationBps: 500,
      }),
    ).toThrow("does not match");
    expect(
      verifiedReferralFeeFromTransaction(movedTransaction, movedOrder, {
        maxQuoteVariationBps: 500,
        execution,
      }),
    ).toBe(473560n);
  });

  it.each([
    { requestId: "another-order" },
    { transactionHash: "another-transaction" },
    { inputAmountResult: "1" },
    { outputAmountResult: "100347980" },
    { outputAmountResult: null },
    { verificationSource: "SOLANA_FINALIZED_TRANSACTION" as const },
  ])("rejects mismatched execution evidence %j", (overrides) => {
    expect(() =>
      verifiedReferralFeeFromTransaction(movedTransaction, movedOrder, {
        execution: { ...execution, ...overrides },
      }),
    ).toThrow("does not match");
  });

  it("extracts the exact referral fee from finalized token balance deltas", () => {
    expect(verifiedReferralFeeFromTransaction(transaction, order)).toBe(
      3_934_125n,
    );
  });

  it("rejects a transaction that the registered wallet did not sign", () => {
    expect(() =>
      verifiedReferralFeeFromTransaction(
        {
          ...transaction,
          signerAddresses: [transaction.signerAddresses[0] ?? ""],
        },
        order,
      ),
    ).toThrow("did not sign");
  });

  it("builds a strict stablecoin recovery order from finalized chain deltas", () => {
    expect(
      buildStablecoinRecoveryOrder(transaction, {
        referralAccount: referral,
        referralFeeBps: 50,
        partnerShareBps: 8000,
      }),
    ).toMatchObject({
      requestId: `finalized-recovery:${transaction.transactionHash}`,
      walletAddress: wallet,
      inputMint: usdcMint,
      inputAmountAtomic: "81084332",
      outputMint: solMint,
      feeMint: solMint,
      quotedFeeAmountAtomic: "3934125",
      referralFeeBps: 50,
      partnerShareBps: 8000,
      valuationUsdDecimal: "81.084332",
      valuationAmountAtomic: "786825000",
    });
  });

  it("allows small quote-to-finalized fee movement for a linked execution", () => {
    const reportedWallet = "9JaZ9rCJG9w87GegKLAExgzDKcYpMVsg5roimCu5VeUR";
    const reportedTransaction: FinalizedSolanaTransactionEvidence = {
      transactionHash:
        "2zPxkaBCPACss2nYwgGxxftmosHvBCewKFZ5eH9mQgQca6jhHBQ1R1aTokyBN9BAd7bBHnHEDxrG5gXqY9xV86jV",
      confirmedAt: "2026-09-03T18:28:55.000Z",
      signerAddresses: [
        "Grr9WnZdcetQywtFXog81UhqmnJyvFhb4AT3ipw44mZP",
        reportedWallet,
      ],
      preTokenBalances: [
        { owner: referral, mint: solMint, amount: 1_091_891n },
        { owner: reportedWallet, mint: usdcMint, amount: 2_475_784n },
      ],
      postTokenBalances: [
        { owner: referral, mint: solMint, amount: 1_437_944n },
        { owner: reportedWallet, mint: usdcMint, amount: 9_694_122n },
      ],
    };
    expect(
      verifiedReferralFeeFromTransaction(
        reportedTransaction,
        {
          ...order,
          walletAddress: reportedWallet,
          inputMint: solMint,
          outputMint: usdcMint,
          inputAmountAtomic: "69210600",
          outputAmountAtomic: "7218338",
          feeMint: solMint,
          quotedFeeAmountAtomic: "350000",
          valuationUsdDecimal: "7.218338",
          valuationAmountAtomic: "69210600",
          registeredAt: "2026-09-03T18:28:00.000Z",
          expiresAt: "2026-09-03T18:38:00.000Z",
        },
        { maxQuoteVariationBps: 500 },
      ),
    ).toBe(346_053n);
  });
});
