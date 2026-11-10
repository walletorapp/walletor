import { describe, expect, it } from "vitest";

import {
  buildPrizeDrawSnapshot,
  buildPrizeDrawMerkleProof,
  calculateWinnerClaimAmounts,
  selectPrizeDrawWinners,
  verifyPrizeDrawMerkleProof,
  type PrizeDrawParticipantInput,
} from "./draw";

const BASE58_SUFFIX =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function participants(count: number): PrizeDrawParticipantInput[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = BASE58_SUFFIX[index];
    if (!suffix) throw new Error("Test wallet suffix is missing.");
    return {
      walletAddress: `${"1".repeat(31)}${suffix}`,
      eligibleSwapCount: index % 4 === 0 ? 10 : index % 3 === 0 ? 5 : 1,
      eligibleVolumeCents: BigInt((index + 1) * 10_000),
      eligibleFeeContributionMicroUsd: BigInt((index + 1) * 50_000),
      multiplierBps:
        index % 4 === 0 ? 15_000 : index % 3 === 0 ? 12_500 : 10_000,
    };
  });
}

describe("Switchboard hybrid prize draw", () => {
  it("selects the only participant as the volume leader", async () => {
    const snapshot = await buildPrizeDrawSnapshot("round:2026-09-02", 1, [
      {
        walletAddress: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
        eligibleSwapCount: 3,
        eligibleVolumeCents: 100_000n,
        eligibleFeeContributionMicroUsd: 500_000n,
        multiplierBps: 11_000,
      },
    ]);
    const winners = await selectPrizeDrawWinners(snapshot, "ab".repeat(32));

    expect(snapshot.algorithmVersion).toBe("SWITCHBOARD_HYBRID_FEE_VOLUME_V3");
    expect(snapshot.totalWeight).toBe(0n);
    expect(winners[0]?.winningTicket).toBe(0n);
  });

  it("locks a canonical weighted participant snapshot with valid proofs", async () => {
    const input = participants(3).reverse();
    const snapshot = await buildPrizeDrawSnapshot(
      "round:2026-09-02",
      20,
      input,
    );

    expect(snapshot.configuredWinnerCount).toBe(20);
    expect(snapshot.winnerCount).toBe(3);
    expect(
      snapshot.participants.map(({ walletAddress }) => walletAddress),
    ).toEqual(
      [...input]
        .sort((left, right) =>
          left.walletAddress < right.walletAddress ? -1 : 1,
        )
        .map(({ walletAddress }) => walletAddress),
    );
    expect(snapshot.totalWeight).toBe(
      snapshot.participants.reduce(
        (total, participant) => total + participant.weight,
        0n,
      ),
    );
    await Promise.all(
      snapshot.participants.map(async (participant) => {
        const proof = await buildPrizeDrawMerkleProof(
          snapshot,
          participant.participantIndex,
        );
        await expect(
          verifyPrizeDrawMerkleProof(
            participant.leafHash,
            proof,
            snapshot.participantMerkleRoot,
          ),
        ).resolves.toBe(true);
      }),
    );
  });

  it("selects 20 unique deterministic winners", async () => {
    const snapshot = await buildPrizeDrawSnapshot(
      "round:2026-09-02",
      20,
      participants(30),
    );
    const randomness = "ab".repeat(32);
    const first = await selectPrizeDrawWinners(snapshot, randomness);
    const repeated = await selectPrizeDrawWinners(snapshot, randomness);

    expect(first).toEqual(repeated);
    expect(first).toHaveLength(20);
    expect(new Set(first.map(({ walletAddress }) => walletAddress)).size).toBe(
      20,
    );
    expect(
      first.slice(0, 2).every(({ attempts }) => attempts.length === 0),
    ).toBe(true);
    expect(first.slice(2).every(({ attempts }) => attempts.length >= 1)).toBe(
      true,
    );
  });

  it("records duplicate attempts before choosing the next unique wallet", async () => {
    const snapshot = await buildPrizeDrawSnapshot(
      "round:2026-09-02",
      20,
      participants(20),
    );
    const winners = await selectPrizeDrawWinners(snapshot, "cd".repeat(32));

    expect(winners).toHaveLength(20);
    expect(
      winners.some(({ attempts }) =>
        attempts.some(({ duplicate }) => duplicate),
      ),
    ).toBe(true);
  });

  it("ranks the two highest verified fee contributors before the lucky draw", async () => {
    const input = participants(30);
    const snapshot = await buildPrizeDrawSnapshot(
      "round:2026-09-03",
      22,
      input,
    );
    const winners = await selectPrizeDrawWinners(snapshot, "ef".repeat(32));

    const ranked = [...input].sort((left, right) =>
      left.eligibleFeeContributionMicroUsd >
      right.eligibleFeeContributionMicroUsd
        ? -1
        : 1,
    );
    expect(winners).toHaveLength(22);
    expect(winners[0]?.walletAddress).toBe(ranked[0]?.walletAddress);
    expect(winners[1]?.walletAddress).toBe(ranked[1]?.walletAddress);
    expect(
      winners
        .slice(2)
        .some(({ walletAddress }) =>
          [ranked[0]?.walletAddress, ranked[1]?.walletAddress].includes(
            walletAddress,
          ),
        ),
    ).toBe(false);
  });

  it("splits an exact pool across winners and deducts 250 bps", () => {
    const claims = calculateWinnerClaimAmounts(1_000_019n, 20, 250);

    expect(claims).toHaveLength(20);
    expect(
      claims.reduce((total, claim) => total + claim.grossLamports, 0n),
    ).toBe(1_000_019n);
    expect(claims[0]).toEqual({
      rank: 1,
      grossLamports: 50_001n,
      claimFeeLamports: 1_250n,
      netLamports: 48_751n,
    });
    expect(claims.at(-1)?.grossLamports).toBe(50_000n);
  });

  it("rejects duplicate wallets and unverified randomness shapes", async () => {
    const duplicate = participants(1)[0];
    if (!duplicate) throw new Error("Test participant is missing.");
    await expect(
      buildPrizeDrawSnapshot("round:2026-09-02", 20, [duplicate, duplicate]),
    ).rejects.toThrow("must be unique");

    const snapshot = await buildPrizeDrawSnapshot(
      "round:2026-09-02",
      20,
      participants(1),
    );
    await expect(
      selectPrizeDrawWinners(snapshot, "not-randomness"),
    ).rejects.toThrow("exactly 32 bytes");
  });
});
