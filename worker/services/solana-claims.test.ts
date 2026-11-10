// @vitest-environment node

import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";

import {
  buildSolanaClaimTransaction,
  getSolanaClaimState,
  submitSolanaClaimTransaction,
} from "./solana-claims";

const PROGRAM_ID = "9kqhszKGiX4XgP7WNM3i6mzdkvQJjfN3e7uhSzqMGbg7";
const SWITCHBOARD_ID = "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2";
const MAINNET_SWITCHBOARD_ID = "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";
const AUTHORITY_ADDRESS = "9JaZ9rCJG9w87GegKLAExgzDKcYpMVsg5roimCu5VeUR";
const COORDINATOR_ADDRESS = "Dwdvu9menqNpEa57ewoU8Y8w1RfhfGguLCPtBrg5HT4t";
const FEE_RECIPIENT_ADDRESS = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const CONFIG_DISCRIMINATOR = Uint8Array.from([
  155, 12, 170, 224, 30, 250, 204, 130,
]);
const WINNER_DISCRIMINATOR = Uint8Array.from([
  126, 74, 200, 186, 228, 1, 36, 23,
]);
const ROUND_DISCRIMINATOR = Uint8Array.from([
  87, 127, 165, 51, 73, 78, 116, 174,
]);

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function signedTransactionSignature(transaction: VersionedTransaction): string {
  const signature = transaction.signatures[0];
  if (!signature) throw new Error("Test transaction has no signature.");
  return bs58.encode(signature);
}

function writeU64(bytes: Uint8Array, offset: number, value: bigint): void {
  new DataView(bytes.buffer).setBigUint64(offset, value, true);
}

function writeI64(bytes: Uint8Array, offset: number, value: bigint): void {
  new DataView(bytes.buffer).setBigInt64(offset, value, true);
}

function account(
  data: Uint8Array,
  options: { executable?: boolean; owner?: string } = {},
) {
  return {
    data: [base64(data), "base64"],
    executable: options.executable ?? false,
    lamports: 1,
    owner: options.owner ?? PROGRAM_ID,
    rentEpoch: 0,
  };
}

function fixture(claimed = false) {
  const wallet = Keypair.fromSeed(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  );
  const round = Keypair.fromSeed(
    Uint8Array.from({ length: 32 }, (_, index) => index + 2),
  );
  const feeRecipient = Keypair.fromSeed(
    Uint8Array.from({ length: 32 }, (_, index) => index + 3),
  ).publicKey;
  const programId = new PublicKey(PROGRAM_ID);
  const [winner] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("winner"),
      round.publicKey.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    programId,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), round.publicKey.toBuffer()],
    programId,
  );

  const winnerData = new Uint8Array(112);
  winnerData.set(WINNER_DISCRIMINATOR, 0);
  winnerData.set(round.publicKey.toBytes(), 8);
  winnerData.set(wallet.publicKey.toBytes(), 40);
  new DataView(winnerData.buffer).setUint16(72, 1, true);
  writeU64(winnerData, 86, 100_000_000n);
  writeU64(winnerData, 94, 500_000n);
  writeU64(winnerData, 102, 99_500_000n);
  winnerData[110] = claimed ? 1 : 0;

  const roundData = new Uint8Array(318);
  roundData.set(ROUND_DISCRIMINATOR, 0);
  roundData[73] = claimed ? 6 : 5;
  roundData.set(feeRecipient.toBytes(), 162);

  return {
    wallet,
    round: round.publicKey,
    winner,
    vault,
    feeRecipient,
    winnerData,
    roundData,
  };
}

function environment(network: "disabled" | "devnet" = "devnet") {
  return {
    PAYOUTS_ENABLED: "false",
    SOLANA_CLAIM_NETWORK: network,
    SOLANA_CLAIM_PROGRAM_ID: PROGRAM_ID,
    SOLANA_SWITCHBOARD_PROGRAM_ID: SWITCHBOARD_ID,
    SOLANA_CLAIM_RPC_URL: "https://api.devnet.solana.com",
  };
}

function rpcResult(result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: "test", result });
}

function finalizedSignatureStatus(): Response {
  return rpcResult({
    context: { slot: 2 },
    value: [
      {
        slot: 2,
        confirmations: null,
        err: null,
        status: { Ok: null },
        confirmationStatus: "finalized",
      },
    ],
  });
}

function confirmedSignatureStatus(): Response {
  return rpcResult({
    context: { slot: 2 },
    value: [
      {
        slot: 2,
        confirmations: 1,
        err: null,
        status: { Ok: null },
        confirmationStatus: "confirmed",
      },
    ],
  });
}

function mainnetEnvironment() {
  return {
    PAYOUTS_ENABLED: "true",
    SOLANA_CLAIM_NETWORK: "mainnet",
    SOLANA_CLAIM_PROGRAM_ID: PROGRAM_ID,
    SOLANA_CLAIM_AUTHORITY_ADDRESS: AUTHORITY_ADDRESS,
    SOLANA_CLAIM_COORDINATOR_ADDRESS: COORDINATOR_ADDRESS,
    SOLANA_CLAIM_FEE_RECIPIENT_ADDRESS: FEE_RECIPIENT_ADDRESS,
    SOLANA_SWITCHBOARD_PROGRAM_ID: MAINNET_SWITCHBOARD_ID,
    SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
  };
}

function mainnetConfigData(): Uint8Array {
  const data = new Uint8Array(139);
  data.set(CONFIG_DISCRIMINATOR, 0);
  data[8] = 1;
  data.set(new PublicKey(AUTHORITY_ADDRESS).toBytes(), 9);
  data.set(new PublicKey(COORDINATOR_ADDRESS).toBytes(), 41);
  data.set(new PublicKey(FEE_RECIPIENT_ADDRESS).toBytes(), 73);
  data.set(new PublicKey(MAINNET_SWITCHBOARD_ID).toBytes(), 105);
  return data;
}

function stateResponses(data = fixture()): [Response, Response] {
  return [
    rpcResult([
      { pubkey: data.winner.toBase58(), account: account(data.winnerData) },
    ]),
    rpcResult({ context: { slot: 1 }, value: [account(data.roundData)] }),
  ];
}

async function preparedSignedClaim() {
  const data = fixture();
  const responses = stateResponses(data);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const buildFetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(responses[0])
    .mockResolvedValueOnce(responses[1])
    .mockResolvedValueOnce(
      rpcResult({
        context: { slot: 1 },
        value: { blockhash, lastValidBlockHeight: 1234 },
      }),
    );
  const prepared = await buildSolanaClaimTransaction(
    environment(),
    data.wallet.publicKey.toBase58(),
    data.winner.toBase58(),
    buildFetcher,
  );
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(prepared.transaction, "base64"),
  );
  transaction.sign([data.wallet]);
  return { data, prepared, transaction };
}

describe("Solana claims service", () => {
  it("does not contact Solana while claims are disabled", async () => {
    const fetcher = vi.fn();
    const data = fixture();
    await expect(
      getSolanaClaimState(
        environment("disabled"),
        data.wallet.publicKey.toBase58(),
        fetcher,
      ),
    ).resolves.toMatchObject({ availability: "DISABLED", entitlements: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads exact claim amounts from program-owned winner accounts", async () => {
    const data = fixture();
    const responses = stateResponses(data);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1]);

    await expect(
      getSolanaClaimState(
        environment(),
        data.wallet.publicKey.toBase58(),
        fetcher,
      ),
    ).resolves.toMatchObject({
      availability: "DEVNET_LIVE",
      entitlements: [
        {
          winnerAddress: data.winner.toBase58(),
          roundAddress: data.round.toBase58(),
          vaultAddress: data.vault.toBase58(),
          feeRecipient: data.feeRecipient.toBase58(),
          grossLamports: "100000000",
          claimFeeLamports: "500000",
          netLamports: "99500000",
          claimDeadline: null,
          status: "CLAIMABLE",
        },
      ],
    });
  });

  it("does not offer an unclaimed entitlement after its on-chain deadline", async () => {
    const data = fixture();
    const expiredRoundData = new Uint8Array(358);
    expiredRoundData.set(data.roundData);
    writeI64(expiredRoundData, 318, 1n);
    data.roundData = expiredRoundData;
    const responses = stateResponses(data);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1]);

    await expect(
      getSolanaClaimState(
        environment(),
        data.wallet.publicKey.toBase58(),
        fetcher,
      ),
    ).resolves.toMatchObject({ entitlements: [] });
  });

  it("fails closed when the configured mainnet program is not deployed", async () => {
    const data = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        rpcResult({ context: { slot: 1 }, value: [null, null] }),
      );
    await expect(
      getSolanaClaimState(
        mainnetEnvironment(),
        data.wallet.publicKey.toBase58(),
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "SOLANA_CLAIM_STATE_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports mainnet live only after the executable and config match", async () => {
    const data = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        rpcResult({
          context: { slot: 1 },
          value: [
            account(new Uint8Array(), { executable: true }),
            account(mainnetConfigData()),
          ],
        }),
      )
      .mockResolvedValueOnce(rpcResult([]));
    await expect(
      getSolanaClaimState(
        mainnetEnvironment(),
        data.wallet.publicKey.toBase58(),
        fetcher,
      ),
    ).resolves.toMatchObject({ availability: "MAINNET_LIVE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("builds only the wallet-signed Walletor claim instruction", async () => {
    const data = fixture();
    const responses = stateResponses(data);
    const blockhash = Keypair.generate().publicKey.toBase58();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1])
      .mockResolvedValueOnce(
        rpcResult({
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 1234 },
        }),
      );

    const result = await buildSolanaClaimTransaction(
      environment(),
      data.wallet.publicKey.toBase58(),
      data.winner.toBase58(),
      fetcher,
    );
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(result.transaction, "base64"),
    );
    expect(result.lastValidBlockHeight).toBe("1234");
    expect(transaction.message.compiledInstructions).toHaveLength(1);
    expect(transaction.message.staticAccountKeys[0]?.toBase58()).toBe(
      data.wallet.publicKey.toBase58(),
    );
  });

  it("revalidates and relays an exact signed claim transaction", async () => {
    const data = fixture();
    const buildResponses = stateResponses(data);
    const blockhash = Keypair.generate().publicKey.toBase58();
    const buildFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(buildResponses[0])
      .mockResolvedValueOnce(buildResponses[1])
      .mockResolvedValueOnce(
        rpcResult({
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 1234 },
        }),
      );
    const prepared = await buildSolanaClaimTransaction(
      environment(),
      data.wallet.publicKey.toBase58(),
      data.winner.toBase58(),
      buildFetcher,
    );
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(prepared.transaction, "base64"),
    );
    transaction.sign([data.wallet]);

    const submitResponses = stateResponses(data);
    const signature = signedTransactionSignature(transaction);
    const submitFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(submitResponses[0])
      .mockResolvedValueOnce(submitResponses[1])
      .mockResolvedValueOnce(rpcResult({ context: { slot: 2 }, value: true }))
      .mockResolvedValueOnce(rpcResult(signature))
      .mockResolvedValueOnce(finalizedSignatureStatus());
    await expect(
      submitSolanaClaimTransaction(
        environment(),
        {
          walletAddress: data.wallet.publicKey.toBase58(),
          winnerAddress: data.winner.toBase58(),
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        submitFetcher,
      ),
    ).resolves.toEqual({
      network: "DEVNET",
      transactionSignature: signature,
      status: "CONFIRMED",
    });
    expect(submitFetcher).toHaveBeenCalledTimes(5);
  });

  it("does not report success before the claim is finalized", async () => {
    const { data, prepared, transaction } = await preparedSignedClaim();
    const submitResponses = stateResponses(data);
    const signature = signedTransactionSignature(transaction);
    const submitFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(submitResponses[0])
      .mockResolvedValueOnce(submitResponses[1])
      .mockResolvedValueOnce(rpcResult({ context: { slot: 2 }, value: true }))
      .mockResolvedValueOnce(rpcResult(signature))
      .mockImplementation(() => Promise.resolve(confirmedSignatureStatus()));

    await expect(
      submitSolanaClaimTransaction(
        environment(),
        {
          walletAddress: data.wallet.publicKey.toBase58(),
          winnerAddress: data.winner.toBase58(),
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        submitFetcher,
      ),
    ).resolves.toEqual({
      network: "DEVNET",
      transactionSignature: signature,
      status: "SUBMITTED",
    });
    expect(submitFetcher).toHaveBeenCalledTimes(12);
  }, 10_000);

  it("rejects a signed claim after its blockhash expires", async () => {
    const { data, prepared, transaction } = await preparedSignedClaim();
    const submitResponses = stateResponses(data);
    const submitFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(submitResponses[0])
      .mockResolvedValueOnce(submitResponses[1])
      .mockResolvedValueOnce(rpcResult({ context: { slot: 2 }, value: false }));

    await expect(
      submitSolanaClaimTransaction(
        environment(),
        {
          walletAddress: data.wallet.publicKey.toBase58(),
          winnerAddress: data.winner.toBase58(),
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        submitFetcher,
      ),
    ).rejects.toMatchObject({ code: "SOLANA_CLAIM_TRANSACTION_EXPIRED" });
    expect(submitFetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a different signature returned by the RPC", async () => {
    const { data, prepared, transaction } = await preparedSignedClaim();
    const submitResponses = stateResponses(data);
    const differentSignature = bs58.encode(new Uint8Array(64).fill(7));
    const submitFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(submitResponses[0])
      .mockResolvedValueOnce(submitResponses[1])
      .mockResolvedValueOnce(rpcResult({ context: { slot: 2 }, value: true }))
      .mockResolvedValueOnce(rpcResult(differentSignature));

    await expect(
      submitSolanaClaimTransaction(
        environment(),
        {
          walletAddress: data.wallet.publicKey.toBase58(),
          winnerAddress: data.winner.toBase58(),
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        submitFetcher,
      ),
    ).rejects.toMatchObject({ code: "SOLANA_CLAIM_SIGNATURE_MISMATCH" });
    expect(submitFetcher).toHaveBeenCalledTimes(4);
  });

  it("accepts bounded compute-budget instructions added by a wallet", async () => {
    const data = fixture();
    const buildResponses = stateResponses(data);
    const blockhash = Keypair.generate().publicKey.toBase58();
    const buildFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(buildResponses[0])
      .mockResolvedValueOnce(buildResponses[1])
      .mockResolvedValueOnce(
        rpcResult({
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 1234 },
        }),
      );
    const prepared = await buildSolanaClaimTransaction(
      environment(),
      data.wallet.publicKey.toBase58(),
      data.winner.toBase58(),
      buildFetcher,
    );
    const original = VersionedTransaction.deserialize(
      Buffer.from(prepared.transaction, "base64"),
    );
    const message = TransactionMessage.decompile(original.message);
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: message.payerKey,
        recentBlockhash: message.recentBlockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          ...message.instructions,
        ],
      }).compileToV0Message(),
    );
    transaction.sign([data.wallet]);

    const submitResponses = stateResponses(data);
    const signature = signedTransactionSignature(transaction);
    const submitFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(submitResponses[0])
      .mockResolvedValueOnce(submitResponses[1])
      .mockResolvedValueOnce(rpcResult({ context: { slot: 2 }, value: true }))
      .mockResolvedValueOnce(rpcResult(signature))
      .mockResolvedValueOnce(finalizedSignatureStatus());
    await expect(
      submitSolanaClaimTransaction(
        environment(),
        {
          walletAddress: data.wallet.publicKey.toBase58(),
          winnerAddress: data.winner.toBase58(),
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        submitFetcher,
      ),
    ).resolves.toMatchObject({ transactionSignature: signature });
    expect(submitFetcher).toHaveBeenCalledTimes(5);
  });

  it("rejects additional instructions that could transfer wallet funds", async () => {
    const data = fixture();
    const buildResponses = stateResponses(data);
    const blockhash = Keypair.generate().publicKey.toBase58();
    const buildFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(buildResponses[0])
      .mockResolvedValueOnce(buildResponses[1])
      .mockResolvedValueOnce(
        rpcResult({
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 1234 },
        }),
      );
    const prepared = await buildSolanaClaimTransaction(
      environment(),
      data.wallet.publicKey.toBase58(),
      data.winner.toBase58(),
      buildFetcher,
    );
    const original = VersionedTransaction.deserialize(
      Buffer.from(prepared.transaction, "base64"),
    );
    const message = TransactionMessage.decompile(original.message);
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: message.payerKey,
        recentBlockhash: message.recentBlockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: data.wallet.publicKey,
            toPubkey: data.feeRecipient,
            lamports: 1,
          }),
          ...message.instructions,
        ],
      }).compileToV0Message(),
    );
    transaction.sign([data.wallet]);

    const submitResponses = stateResponses(data);
    const submitFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(submitResponses[0])
      .mockResolvedValueOnce(submitResponses[1]);
    await expect(
      submitSolanaClaimTransaction(
        environment(),
        {
          walletAddress: data.wallet.publicKey.toBase58(),
          winnerAddress: data.winner.toBase58(),
          signedTransaction: Buffer.from(transaction.serialize()).toString(
            "base64",
          ),
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        submitFetcher,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SIGNED_CLAIM" });
    expect(submitFetcher).toHaveBeenCalledTimes(2);
  });

  it("never rebuilds a claim for an already claimed winner", async () => {
    const data = fixture(true);
    const responses = stateResponses(data);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1]);
    await expect(
      buildSolanaClaimTransaction(
        environment(),
        data.wallet.publicKey.toBase58(),
        data.winner.toBase58(),
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "SOLANA_CLAIM_ALREADY_COMPLETED" });
  });
});
