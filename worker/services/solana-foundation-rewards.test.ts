// @vitest-environment node

import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  type UsdcClaimDistributionManifest,
} from "../../shared/usdc-claim-contracts";
import {
  SOLANA_REWARDS_SOURCE_REVISION,
  buildUsdcMerkleAllocationBundle,
  bytesToHex,
  createMerkleClaimInstruction,
  deriveAssociatedTokenAddress,
  deriveClaimAddress,
  deriveDistributionAddress,
  deriveEventAuthorityAddress,
  hexToBytes,
  parseMerkleClaimAmount,
  parseMerkleDistributionAccount,
  validateUsdcClaimManifest,
  verifyMerkleProof,
} from "../../shared/solana-foundation-rewards";

const WINNER_ONE = "So11111111111111111111111111111111111111112";
const WINNER_TWO = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const AUTHORITY = "9JaZ9rCJG9w87GegKLAExgzDKcYpMVsg5roimCu5VeUR";
const SEED = "D5ZxUNUZvn5vJn4ivFRNTzMTwYbgCYYEE1Arzesde5ra";

function u64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function i64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function manifestFixture(): UsdcClaimDistributionManifest {
  const bundle = buildUsdcMerkleAllocationBundle(100_000_000n, [
    { rank: 1, winnerAddress: WINNER_ONE },
    { rank: 2, winnerAddress: WINNER_TWO },
  ]);
  const distribution = deriveDistributionAddress(AUTHORITY, SEED)[0].toBase58();
  return {
    version: 1,
    roundId: "solana:mainnet:prize-pool:2026-09-05",
    sourceRevision: SOLANA_REWARDS_SOURCE_REVISION,
    prizeDrawAlgorithmVersion: "SWITCHBOARD_WEIGHTED_UNIQUE_V2",
    randomnessAccount: WINNER_TWO,
    randomnessValue: "ab".repeat(32),
    randomnessCommitTransactionSignature: "1".repeat(64),
    randomnessRevealTransactionSignature: "2".repeat(64),
    network: "MAINNET",
    provider: "SOLANA_FOUNDATION_REWARDS",
    programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    mintAddress: SOLANA_MAINNET_USDC_MINT,
    mintSymbol: "USDC",
    mintDecimals: 6,
    authorityAddress: AUTHORITY,
    seedAddress: SEED,
    distributionAddress: distribution,
    distributionVaultAddress:
      deriveAssociatedTokenAddress(distribution).toBase58(),
    merkleRoot: bundle.merkleRoot,
    grossPrizeAmountAtomic: bundle.grossPrizeAmountAtomic,
    claimFeeAmountAtomic: bundle.claimFeeAmountAtomic,
    netDistributionAmountAtomic: bundle.netDistributionAmountAtomic,
    claimFeeBps: 250,
    clawbackUnixTimestamp: "1800000000",
    createTransactionSignature: "3".repeat(64),
    entitlements: bundle.entitlements,
  };
}

describe("Solana Foundation Rewards USDC integration", () => {
  it("derives the deployed program's canonical event authority", () => {
    expect(deriveEventAuthorityAddress().toBase58()).toBe(
      "8LZgvUJZE3RvMbNUxRuGw5AzKnTRuFisAWiRmS26od7J",
    );
  });

  it("builds deterministic immediate-vesting proofs and an exact 250 bps split", () => {
    const bundle = buildUsdcMerkleAllocationBundle(100_000_000n, [
      { rank: 1, winnerAddress: WINNER_ONE },
      { rank: 2, winnerAddress: WINNER_TWO },
    ]);

    expect(bundle).toMatchObject({
      merkleRoot:
        "f90d0699ceb3493775ad06659e7aac4d679386faeeee254723ffcf4049984c32",
      grossPrizeAmountAtomic: "100000000",
      claimFeeAmountAtomic: "2500000",
      netDistributionAmountAtomic: "97500000",
    });
    for (const entitlement of bundle.entitlements) {
      expect(
        verifyMerkleProof(
          hexToBytes(entitlement.leafHash),
          entitlement.proof.map(hexToBytes),
          hexToBytes(bundle.merkleRoot),
        ),
      ).toBe(true);
    }
  });

  it("allocates 20%, 10%, and the remaining 70% across 20 lucky winners", () => {
    const winners = Array.from({ length: 22 }, (_, index) => ({
      rank: index + 1,
      winnerAddress: new PublicKey(
        Uint8Array.from({ length: 32 }, () => index + 1),
      ).toBase58(),
    }));
    const bundle = buildUsdcMerkleAllocationBundle(
      100_000_000n,
      winners,
      "HYBRID_20_10_70",
    );

    expect(bundle.entitlements[0]?.grossAmountAtomic).toBe("20000000");
    expect(bundle.entitlements[1]?.grossAmountAtomic).toBe("10000000");
    expect(
      bundle.entitlements
        .slice(2)
        .every(({ grossAmountAtomic }) => grossAmountAtomic === "3500000"),
    ).toBe(true);
    expect(
      bundle.entitlements.reduce(
        (total, entitlement) => total + BigInt(entitlement.grossAmountAtomic),
        0n,
      ),
    ).toBe(100_000_000n);
  });

  it("renormalizes the leader split when fewer than three wallets qualify", () => {
    const bundle = buildUsdcMerkleAllocationBundle(
      100n,
      [
        { rank: 1, winnerAddress: WINNER_ONE },
        { rank: 2, winnerAddress: WINNER_TWO },
      ],
      "HYBRID_20_10_70",
    );

    expect(
      bundle.entitlements.map(({ grossAmountAtomic }) => grossAmountAtomic),
    ).toEqual(["66", "34"]);
  });

  it("rejects a manifest whose fee or proof does not reconcile", () => {
    const manifest = manifestFixture();
    expect(() => {
      validateUsdcClaimManifest(manifest);
    }).not.toThrow();
    const first = manifest.entitlements[0];
    if (!first) throw new Error("Fixture needs a first entitlement.");
    expect(() => {
      validateUsdcClaimManifest({
        ...manifest,
        entitlements: [
          { ...first, claimFeeAmountAtomic: "1" },
          ...manifest.entitlements.slice(1),
        ],
      });
    }).toThrow(/250 bps fee split/);
  });

  it("encodes the official claim instruction tag, proof, and account order", () => {
    const manifest = manifestFixture();
    const entitlement = manifest.entitlements[0];
    if (!entitlement) throw new Error("Fixture needs a first entitlement.");
    const instruction = createMerkleClaimInstruction({
      distributionAddress: manifest.distributionAddress,
      distributionVaultAddress: manifest.distributionVaultAddress,
      winnerAddress: entitlement.winnerAddress,
      netAmountAtomic: BigInt(entitlement.netAmountAtomic),
      proof: entitlement.proof,
    });

    expect(instruction.programId.toBase58()).toBe(
      SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    );
    expect(instruction.data[0]).toBe(6);
    expect(instruction.keys).toHaveLength(12);
    expect(instruction.keys[0]?.pubkey.toBase58()).toBe(WINNER_ONE);
    expect(instruction.keys[1]?.pubkey.toBase58()).toBe(WINNER_ONE);
    expect(instruction.keys[2]?.pubkey.toBase58()).toBe(
      manifest.distributionAddress,
    );
    expect(instruction.keys[3]?.pubkey.toBase58()).toBe(
      deriveClaimAddress(
        manifest.distributionAddress,
        WINNER_ONE,
      )[0].toBase58(),
    );
    expect(instruction.data.byteLength).toBe(55);
  });

  it("parses current Merkle distribution and claim account layouts", () => {
    const manifest = manifestFixture();
    const [distribution, bump] = deriveDistributionAddress(AUTHORITY, SEED);
    const distributionData = new Uint8Array(162);
    distributionData.set([2, 1, bump, 0], 0);
    distributionData.set(new PublicKey(AUTHORITY).toBytes(), 10);
    distributionData.set(new PublicKey(SOLANA_MAINNET_USDC_MINT).toBytes(), 42);
    distributionData.set(new PublicKey(SEED).toBytes(), 74);
    distributionData.set(hexToBytes(manifest.merkleRoot), 106);
    distributionData.set(u64Le(97_500_000n), 138);
    distributionData.set(u64Le(48_750_000n), 146);
    distributionData.set(i64Le(1_800_000_000n), 154);

    expect(parseMerkleDistributionAccount(distributionData)).toEqual({
      bump,
      revocable: 0,
      authorityAddress: AUTHORITY,
      mintAddress: SOLANA_MAINNET_USDC_MINT,
      seedAddress: SEED,
      merkleRoot: manifest.merkleRoot,
      totalAmountAtomic: 97_500_000n,
      totalClaimedAtomic: 48_750_000n,
      clawbackUnixTimestamp: 1_800_000_000n,
    });
    expect(distribution.toBase58()).toBe(manifest.distributionAddress);

    const claimData = new Uint8Array(18);
    claimData.set([3, 1, 254], 0);
    claimData.set(u64Le(48_750_000n), 10);
    expect(parseMerkleClaimAmount(claimData)).toBe(48_750_000n);
    expect(bytesToHex(claimData.slice(10))).toBe("b0dde70200000000");
  });
});
