// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { PRIZE_DRAW_ALGORITHM_VERSION } from "../../shared/prize-draw-contracts";

import {
  canExpireUnfundedClaimPreparation,
  buildUsdcClaimTransaction,
  hasValidSwitchboardCommitRevealSlots,
  launchEntitlementFilter,
  prepareUsdcClaimDistribution,
  matchesPreparedDistributionTransaction,
} from "./usdc-claims";

it("recovers only the exact prepared funding message and matching transaction signature", () => {
  const payer = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const blockhash = Keypair.generate().publicKey.toBase58();
  const make = (lamports: number) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: recipient,
            lamports,
          }),
        ],
      }).compileToV0Message(),
    );
  const prepared = make(1000).serialize();
  const funded = make(1000);
  funded.sign([payer]);
  const firstSignature = funded.signatures[0];
  if (!firstSignature)
    throw new Error("Signed test transaction has no signature.");
  const signature = bs58.encode(firstSignature);
  expect(
    matchesPreparedDistributionTransaction(
      prepared,
      funded.serialize(),
      signature,
    ),
  ).toBe(true);
  expect(
    matchesPreparedDistributionTransaction(
      make(2000).serialize(),
      funded.serialize(),
      signature,
    ),
  ).toBe(false);
  expect(
    matchesPreparedDistributionTransaction(
      prepared,
      funded.serialize(),
      bs58.encode(new Uint8Array(64)),
    ),
  ).toBe(false);
});

it.each([
  ["false", "USDC_DISTRIBUTION_FUNDING_DISABLED"],
  ["true", "USDC_CLAIM_PROGRAM_CHANGED"],
] as const)(
  "refuses funding before database access: %s / %s",
  async (fundingEnabled, code) => {
    const prepare = vi.fn<D1Database["prepare"]>();
    const batch = vi.fn();
    const db: D1Database = {
      prepare,
      batch,
      exec: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required by the D1Database mock interface; never invoked.
      dump: vi.fn(),
      withSession: vi.fn(),
    };
    const rpc = vi.fn<typeof fetch>();
    rpc
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: [null, null] },
        }),
      );
    const wallet = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
    await expect(
      prepareUsdcClaimDistribution(
        db,
        {
          PAYOUTS_ENABLED: "true",
          SANCTIONS_SCREENING_ENABLED: "true",
          USDC_DISTRIBUTION_FUNDING_ENABLED: fundingEnabled,
          SOLANA_CLAIM_NETWORK: "mainnet",
          SOLANA_CLAIM_PROGRAM_ID:
            "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
          SOLANA_CLAIM_AUTHORITY_ADDRESS: wallet,
          SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
          SOLANA_SWITCHBOARD_PROGRAM_ID:
            "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
          SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
            "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w",
          PRIZE_POOL_CLAIM_FEE_BPS: "250",
        },
        {
          roundId: "test-round",
          randomnessAccount: wallet,
          seedAddress: wallet,
          randomnessCommitTransactionSignature: "1".repeat(88),
          randomnessRevealTransactionSignature: "2".repeat(88),
        },
        {
          grossPrizeAmountAtomic: "1000000",
          winners: [{ rank: 1, winnerAddress: wallet }],
          randomnessValue: "00".repeat(32),
          algorithmVersion: PRIZE_DRAW_ALGORITHM_VERSION,
        },
        "operator@example.com",
        "funding-gate-test",
        rpc,
      ),
    ).rejects.toMatchObject({ code });
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(fundingEnabled === "true" ? 2 : 0);
    if (fundingEnabled === "true") {
      const request = rpc.mock.calls[1]?.[1]?.body;
      expect(
        typeof request === "string" ? JSON.parse(request) : null,
      ).toMatchObject({
        method: "getMultipleAccounts",
        params: [
          expect.any(Array),
          { commitment: "finalized", encoding: "base64" },
        ],
      });
    }
  },
);

it("does not require screening data when building a claim", async () => {
  await expect(
    buildUsdcClaimTransaction(
      {
        SANCTIONS_SCREENING_ENABLED: "true",
        PAYOUTS_ENABLED: "true",
        SOLANA_CLAIM_NETWORK: "mainnet",
        SOLANA_CLAIM_PROGRAM_ID: "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
        SOLANA_CLAIM_AUTHORITY_ADDRESS:
          "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
        SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
        SOLANA_SWITCHBOARD_PROGRAM_ID:
          "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
        SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
          "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w",
        PRIZE_POOL_CLAIM_FEE_BPS: "250",
      },
      "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
      "test-entitlement",
    ),
  ).rejects.toMatchObject({ code: "USDC_CLAIM_DATABASE_UNAVAILABLE" });
});

describe("public launch claim history", () => {
  it("limits public claims to distributions staged after launch", () => {
    expect(
      launchEntitlementFilter(
        { WALLETOR_PUBLIC_LAUNCH_AT: "2026-09-06T00:00:00.000Z" },
        "e.winner_address = ? AND d.status = 'ACTIVE'",
      ),
    ).toEqual({
      where:
        "e.winner_address = ? AND d.status = 'ACTIVE' AND d.staged_at >= ?",
      launchAt: "2026-09-06T00:00:00.000Z",
    });
  });
});

describe("Switchboard commit/reveal slot verification", () => {
  it("accepts the mainnet slot relationship emitted by RandomnessCommit", () => {
    expect(
      hasValidSwitchboardCommitRevealSlots({
        seedSlot: 444_801_231n,
        commitTransactionSlot: 444_801_232n,
        revealSlot: 444_801_261n,
        revealTransactionSlot: 444_801_261n,
      }),
    ).toBe(true);
  });

  it("rejects a commit that does not immediately follow the recorded seed slot", () => {
    expect(
      hasValidSwitchboardCommitRevealSlots({
        seedSlot: 444_801_231n,
        commitTransactionSlot: 444_801_233n,
        revealSlot: 444_801_261n,
        revealTransactionSlot: 444_801_261n,
      }),
    ).toBe(false);
  });

  it("rejects a reveal signature from a different slot", () => {
    expect(
      hasValidSwitchboardCommitRevealSlots({
        seedSlot: 444_801_231n,
        commitTransactionSlot: 444_801_232n,
        revealSlot: 444_801_261n,
        revealTransactionSlot: 444_801_262n,
      }),
    ).toBe(false);
  });
});

describe("expired claim preparation recovery", () => {
  it("allows recovery only after expiry when no distribution exists", () => {
    expect(
      canExpireUnfundedClaimPreparation({
        currentBlockHeight: 101n,
        lastValidBlockHeight: 100n,
        distributionExists: false,
      }),
    ).toBe(true);
  });

  it("does not recover at the last valid block height", () => {
    expect(
      canExpireUnfundedClaimPreparation({
        currentBlockHeight: 100n,
        lastValidBlockHeight: 100n,
        distributionExists: false,
      }),
    ).toBe(false);
  });

  it("does not recover when the distribution exists on-chain", () => {
    expect(
      canExpireUnfundedClaimPreparation({
        currentBlockHeight: 101n,
        lastValidBlockHeight: 100n,
        distributionExists: true,
      }),
    ).toBe(false);
  });
});
