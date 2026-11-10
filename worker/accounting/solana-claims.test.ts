import { describe, expect, it } from "vitest";

import { buildPrizeDrawSnapshot } from "./draw";
import {
  buildSolanaRoundManifest,
  readSolanaClaimConfig,
} from "./solana-claims";

const PROGRAM_ID = "9kqhszKGiX4XgP7WNM3i6mzdkvQJjfN3e7uhSzqMGbg7";
const DEVNET_SWITCHBOARD = "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2";

describe("Solana claim coordination boundary", () => {
  it("keeps the checked-in environment disabled", () => {
    expect(
      readSolanaClaimConfig({
        PAYOUTS_ENABLED: "false",
        SOLANA_CLAIM_NETWORK: "disabled",
        SOLANA_CLAIM_PROGRAM_ID: PROGRAM_ID,
        SOLANA_SWITCHBOARD_PROGRAM_ID: DEVNET_SWITCHBOARD,
        SOLANA_CLAIM_RPC_URL: "https://api.devnet.solana.com",
      }),
    ).toEqual({
      network: "DISABLED",
      executionEnabled: false,
      programId: PROGRAM_ID,
      authorityAddress: null,
      coordinatorAddress: null,
      feeRecipientAddress: null,
      switchboardProgramId: DEVNET_SWITCHBOARD,
      rpcUrl: "https://api.devnet.solana.com",
    });
  });

  it("does not allow mainnet execution behind the disabled payout gate", () => {
    expect(() =>
      readSolanaClaimConfig({
        PAYOUTS_ENABLED: "false",
        SOLANA_CLAIM_NETWORK: "mainnet",
        SOLANA_CLAIM_PROGRAM_ID: PROGRAM_ID,
        SOLANA_CLAIM_AUTHORITY_ADDRESS: PROGRAM_ID,
        SOLANA_CLAIM_COORDINATOR_ADDRESS: PROGRAM_ID,
        SOLANA_CLAIM_FEE_RECIPIENT_ADDRESS: PROGRAM_ID,
        SOLANA_SWITCHBOARD_PROGRAM_ID:
          "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
        SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
      }),
    ).toThrow("PAYOUTS_ENABLED is false");
  });

  it("uses the Worker-only RPC binding instead of the public fallback", () => {
    expect(
      readSolanaClaimConfig({
        PAYOUTS_ENABLED: "false",
        SOLANA_CLAIM_NETWORK: "devnet",
        SOLANA_CLAIM_PROGRAM_ID: PROGRAM_ID,
        SOLANA_SWITCHBOARD_PROGRAM_ID: DEVNET_SWITCHBOARD,
        SOLANA_CLAIM_RPC_URL: "https://api.devnet.solana.com",
        SOLANA_CLAIM_RPC_URL_PRIVATE: "https://private.example/rpc",
      }).rpcUrl,
    ).toBe("https://private.example/rpc");
  });

  it("creates an exact-integer manifest for the on-chain round", async () => {
    const draft = await buildPrizeDrawSnapshot("round:2026-09-02", 1, [
      {
        walletAddress: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
        eligibleSwapCount: 3,
        eligibleVolumeCents: 100_000n,
        eligibleFeeContributionMicroUsd: 500_000n,
        multiplierBps: 11_000,
      },
    ]);
    const manifest = await buildSolanaRoundManifest(
      {
        ...draft,
        grossPoolCents: "100",
        totalWeight: draft.totalWeight.toString(),
        participants: draft.participants.map((participant) => ({
          ...participant,
          eligibleVolumeCents: participant.eligibleVolumeCents.toString(),
          eligibleFeeContributionMicroUsd:
            participant.eligibleFeeContributionMicroUsd.toString(),
          weight: participant.weight.toString(),
          rangeStart: participant.rangeStart.toString(),
          rangeEnd: participant.rangeEnd.toString(),
        })),
        status: "SNAPSHOT_LOCKED",
        claimFeeBps: 50,
        randomnessAccount: null,
        commitTransactionSignature: null,
        revealTransactionSignature: null,
        settlementTransactionSignature: null,
        pagination: {
          offset: 0,
          limit: 1,
          totalParticipants: 1,
          nextOffset: null,
        },
        payoutExecutionStatus: "LOCKED_BETA",
        transparencyNote: "Test snapshot.",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-03T00:00:00.000Z",
        serverTime: "2026-09-03T00:00:00.000Z",
      },
      1_000_019n,
      {
        claimDeadlineUnixTimestamp: 1_780_000_000n,
        recoveryRecipient: PROGRAM_ID,
      },
    );

    expect(manifest.roundIdHash).toBe(
      "2f3617f018b0ef29a7bc5db8c2d6b33dda0130cb33b6cf6418c73201e8b94d68",
    );
    expect(manifest.claimDeadlineUnixTimestamp).toBe("1780000000");
    expect(manifest.recoveryRecipient).toBe(PROGRAM_ID);
    expect(manifest.claims).toEqual([
      {
        rank: 1,
        grossLamports: "1000019",
        claimFeeLamports: "5000",
        netLamports: "995019",
      },
    ]);
  });
});
