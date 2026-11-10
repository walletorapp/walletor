// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  assertMagicBlockRequestTransaction,
  drawAddress,
  hexBytes,
  instructionDiscriminator,
  parseDrawAccount,
  requestDrawInstruction,
  roundHash,
  usesMagicBlock,
  WALLETOR_RANDOMNESS_PROGRAM_ID,
} from "../../shared/magicblock-randomness";
import {
  magicBlockStatus,
  verifyMagicBlockRandomness,
} from "./magicblock-randomness";

const authority = Keypair.generate().publicKey.toBase58();
const roundId = "solana:mainnet:prize-pool:2026-09-23T00:00:00.000Z";
const digest = "12".repeat(32);

it("refuses a transaction containing an extra SOL transfer or changed snapshot before wallet signing", () => {
  const blockhash = SystemProgram.programId.toBase58();
  const transaction = new Transaction({
    feePayer: new PublicKey(authority),
    blockhash,
    lastValidBlockHeight: 100,
  }).add(requestDrawInstruction(authority, roundId, digest));
  expect(() => {
    assertMagicBlockRequestTransaction(
      transaction,
      authority,
      roundId,
      digest,
      blockhash,
    );
  }).not.toThrow();
  expect(() => {
    assertMagicBlockRequestTransaction(
      transaction,
      authority,
      roundId,
      "23".repeat(32),
      blockhash,
    );
  }).toThrow();
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(authority),
      toPubkey: SystemProgram.programId,
      lamports: 1,
    }),
  );
  expect(() => {
    assertMagicBlockRequestTransaction(
      transaction,
      authority,
      roundId,
      digest,
      blockhash,
    );
  }).toThrow();
});

const randomness = "00".repeat(32); // Zero is a valid VRF outcome; it must not trigger a reroll.
const requestSignature = bs58.encode(new Uint8Array(64).fill(1));
const callbackSignature = bs58.encode(new Uint8Array(64).fill(2));
const [draw, bump] = drawAddress(authority, roundId);

function account(fulfilled = true, sameSlot = false) {
  const bytes = new Uint8Array(155);
  bytes.set(sha256(new TextEncoder().encode("account:Draw")).slice(0, 8));
  bytes.set(new PublicKey(authority).toBytes(), 8);
  bytes.set(roundHash(roundId), 40);
  bytes.set(hexBytes(digest), 72);
  bytes.set(hexBytes(randomness), 104);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(136, 10n, true);
  view.setBigUint64(144, fulfilled ? (sameSlot ? 10n : 11n) : 0n, true);
  bytes[152] = fulfilled ? 1 : 0;
  bytes[153] = bump;
  bytes[154] = 1;
  return bytes;
}

function fixture({
  fulfilled = true,
  sameSlot = false,
  wrongOwner = false,
  failedCallback = false,
  wrongInstruction = false,
  network = "mainnet",
  minimumSlot = "9",
} = {}) {
  const binding = {
    round_id: roundId,
    authority_address: authority,
    randomness_account: draw.toBase58(),
    snapshot_hash: digest,
    minimum_request_slot: minimumSlot,
  };
  const statement: D1PreparedStatement = {
    bind: vi.fn(() => statement),
    first: vi.fn().mockResolvedValue(binding),
    all: vi.fn(),
    run: vi.fn(),
    raw: vi.fn(),
  };
  const db: D1Database = {
    prepare: vi.fn(() => statement),
    batch: vi.fn(),
    exec: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required by the D1Database mock interface; never invoked.
    dump: vi.fn(),
    withSession: vi.fn(),
  };
  const env = {
    DB: db,
    PAYOUTS_ENABLED: "true",
    USDC_DISTRIBUTION_FUNDING_ENABLED: "true",
    SOLANA_CLAIM_NETWORK: "mainnet",
    SOLANA_CLAIM_PROGRAM_ID: "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
    SOLANA_CLAIM_AUTHORITY_ADDRESS: authority,
    SOLANA_CLAIM_RPC_URL: "https://rpc.example.test",
    SOLANA_SWITCHBOARD_PROGRAM_ID:
      "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
    SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
      "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w",
    PRIZE_POOL_CLAIM_FEE_BPS: "250",
  };
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    if (typeof init?.body !== "string")
      throw new Error("Expected an RPC JSON string.");
    const body = JSON.parse(init.body) as {
      method: string;
      params: unknown[];
    };
    let result: unknown;
    switch (body.method) {
      case "getGenesisHash":
        result =
          network === "mainnet"
            ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
            : "devnet";
        break;
      case "getAccountInfo":
        expect(body.params[1]).toEqual({
          commitment: "finalized",
          encoding: "base64",
        });
        result = {
          value: {
            owner: wrongOwner ? authority : WALLETOR_RANDOMNESS_PROGRAM_ID,
            executable: false,
            data: [
              Buffer.from(account(fulfilled, sameSlot)).toString("base64"),
              "base64",
            ],
          },
        };
        break;
      case "getSignaturesForAddress":
        result = [
          ...(fulfilled
            ? [
                {
                  signature: callbackSignature,
                  slot: sameSlot ? 10 : 11,
                  err: null,
                },
              ]
            : []),
          { signature: requestSignature, slot: 10, err: null },
        ];
        break;
      case "getTransaction": {
        const callback = body.params[0] === callbackSignature;
        expect(body.params[1]).toMatchObject({ commitment: "finalized" });
        const data = callback
          ? Uint8Array.from([
              ...instructionDiscriminator("consume_draw"),
              ...hexBytes(randomness),
              ...roundHash(roundId),
              ...hexBytes(digest),
            ])
          : requestDrawInstruction(authority, roundId, digest).data;
        const ix = {
          programIdIndex: 2,
          accounts: [0, 1],
          data: bs58.encode(wrongInstruction ? new Uint8Array(72) : data),
        };
        result = {
          slot: callback && !sameSlot ? 11 : 10,
          meta: {
            err:
              callback && failedCallback
                ? { InstructionError: [0, "failed"] }
                : null,
            innerInstructions: callback ? [{ instructions: [ix] }] : [],
          },
          transaction: {
            signatures: [body.params[0]],
            message: {
              header: { numRequiredSignatures: 1 },
              accountKeys: [
                authority,
                draw.toBase58(),
                WALLETOR_RANDOMNESS_PROGRAM_ID,
              ],
              instructions: callback ? [] : [ix],
            },
          },
        };
        break;
      }
      default:
        throw new Error(`Unexpected RPC ${body.method}`);
    }
    return Promise.resolve(Response.json({ jsonrpc: "2.0", id: 1, result }));
  });
  return { env, fetcher };
}
const input = {
  roundId,
  randomnessAccount: draw.toBase58(),
  randomnessCommitTransactionSignature: requestSignature,
  randomnessRevealTransactionSignature: callbackSignature,
};

describe("MagicBlock funding proof", () => {
  it("accepts a finalized callback linked to the one immutable request, including zero randomness", async () => {
    const { env, fetcher } = fixture();
    expect(
      await verifyMagicBlockRandomness(env, input, undefined, fetcher),
    ).toMatchObject({
      randomnessValue: randomness,
      magicblock: { provider: "MAGICBLOCK", snapshotHash: digest },
    });
  });
  it.each([
    { wrongOwner: true },
    { failedCallback: true },
    { wrongInstruction: true },
    { network: "devnet" },
  ])(
    "rejects forged, failed, unrelated and wrong-network evidence %j",
    async (options) => {
      const { env, fetcher } = fixture(options);
      await expect(
        verifyMagicBlockRandomness(env, input, undefined, fetcher),
      ).rejects.toThrow();
    },
  );
  it("never funds a pending request", async () => {
    const { env, fetcher } = fixture({ fulfilled: false });
    await expect(
      verifyMagicBlockRandomness(env, input, undefined, fetcher),
    ).rejects.toMatchObject({ code: "MAGICBLOCK_PENDING" });
  });
  it("rejects randomness requested before the snapshot was reserved", async () => {
    const { env, fetcher } = fixture({ minimumSlot: "11" });
    await expect(
      verifyMagicBlockRandomness(env, input, undefined, fetcher),
    ).rejects.toThrow("predates");
  });
  it("rejects result substitution and account substitution", async () => {
    const { env, fetcher } = fixture();
    await expect(
      verifyMagicBlockRandomness(
        env,
        { ...input, randomnessAccount: authority },
        undefined,
        fetcher,
      ),
    ).rejects.toThrow();
    await expect(
      verifyMagicBlockRandomness(
        env,
        input,
        {
          randomnessValue: "11".repeat(32),
          magicblock: {
            provider: "MAGICBLOCK",
            programId: WALLETOR_RANDOMNESS_PROGRAM_ID,
            snapshotHash: digest,
          },
        },
        fetcher,
      ),
    ).rejects.toThrow();
  });
  it.each([false, true])(
    "recovers both signatures after refresh (same-slot=%s)",
    async (sameSlot) => {
      const { env, fetcher } = fixture({ sameSlot });
      expect(await magicBlockStatus(env, roundId, fetcher)).toEqual({
        ...input,
        status: "FULFILLED",
      });
    },
  );
  it("reports unavailable RPC without generating a replacement request", async () => {
    const { env } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("maintenance", { status: 503 }));
    await expect(magicBlockStatus(env, roundId, fetcher)).rejects.toMatchObject(
      { code: "MAGICBLOCK_RPC_UNAVAILABLE", retryable: true },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it("binds account decoding to owner, authority, round, snapshot and version", () => {
  const bytes = account();
  expect(
    parseDrawAccount(
      bytes,
      WALLETOR_RANDOMNESS_PROGRAM_ID,
      false,
      authority,
      roundId,
      digest,
    ).fulfilled,
  ).toBe(true);
  expect(() =>
    parseDrawAccount(
      bytes,
      WALLETOR_RANDOMNESS_PROGRAM_ID,
      false,
      authority,
      roundId + "x",
      digest,
    ),
  ).toThrow();
  expect(() =>
    parseDrawAccount(
      bytes,
      WALLETOR_RANDOMNESS_PROGRAM_ID,
      false,
      authority,
      roundId,
      "11".repeat(32),
    ),
  ).toThrow();
  bytes[154] = 2;
  expect(() =>
    parseDrawAccount(
      bytes,
      WALLETOR_RANDOMNESS_PROGRAM_ID,
      false,
      authority,
      roundId,
      digest,
    ),
  ).toThrow();
});
it("leaves historical and recovery rounds on their original provider", () => {
  expect(usesMagicBlock(roundId, null)).toBe(false);
  expect(usesMagicBlock(roundId, "2026-09-24T00:00:00.000Z")).toBe(false);
  expect(usesMagicBlock(roundId, "2026-09-23T00:00:00.000Z")).toBe(true);
  expect(
    usesMagicBlock(
      "solana:mainnet:prize-pool:recovery:2026-09-25T00:00:00.000Z",
      "2026-09-23T00:00:00.000Z",
    ),
  ).toBe(false);
});

it("accepts new rolling daily rounds while rejecting historical continuations and invalid timestamps", () => {
  const cutoff = "2026-09-22T00:00:00.000Z";
  expect(
    usesMagicBlock(
      "solana:mainnet:prize-pool:rolling:2026-09-22T11:12:13.456Z",
      cutoff,
    ),
  ).toBe(true);
  expect(
    usesMagicBlock(
      "solana:mainnet:prize-pool:rolling:2026-09-21T11:12:13.456Z",
      cutoff,
    ),
  ).toBe(false);
  expect(
    usesMagicBlock(
      "solana:mainnet:prize-pool:2026-09-22T00:00:00.000Z:continuation:2026-09-22T11:12:13.456Z",
      cutoff,
    ),
  ).toBe(false);
  expect(
    usesMagicBlock(
      "solana:mainnet:prize-pool:2026-09-22T11:12:13.456Z",
      cutoff,
    ),
  ).toBe(false);
  expect(
    usesMagicBlock(
      "solana:mainnet:prize-pool:rolling:2026-09-32T11:12:13.456Z",
      cutoff,
    ),
  ).toBe(false);
});
