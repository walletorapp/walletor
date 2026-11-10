import { sha256 } from "@noble/hashes/sha2";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_SLOT_HASHES_PUBKEY,
  type Transaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { z } from "zod";
import type { PublicPrizeDrawSnapshot } from "./prize-draw-contracts";

// Dedicated Walletor consumer; deployment is required before enabling it.
export const WALLETOR_RANDOMNESS_PROGRAM_ID =
  "DpJmR1usbiC7CaPZsfxqcMosx4ELCtgY9TXC7ijjmoY2";
export const MAGICBLOCK_VRF_PROGRAM_ID =
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz";
export const MAGICBLOCK_QUEUE = "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh";
export function usesMagicBlock(
  roundId: string,
  firstRoundAt: string | null | undefined,
): boolean {
  if (!firstRoundAt) return false;
  if (
    !/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(firstRoundAt) ||
    !Number.isFinite(Date.parse(firstRoundAt)) ||
    new Date(firstRoundAt).toISOString() !== firstRoundAt
  )
    throw new Error(
      "MAGICBLOCK_FIRST_ROUND_AT must be a UTC daily round boundary.",
    );
  const match =
    /^solana:mainnet:prize-pool:(?:rolling:)?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)$/.exec(
      roundId,
    );
  return Boolean(
    match?.[1] &&
    Number.isFinite(Date.parse(match[1])) &&
    new Date(match[1]).toISOString() === match[1] &&
    (roundId.includes(":rolling:") || match[1].endsWith("T00:00:00.000Z")) &&
    Date.parse(match[1]) >= Date.parse(firstRoundAt),
  );
}
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
});
export const MagicBlockEvidenceSchema = z.object({
  provider: z.literal("MAGICBLOCK"),
  programId: z.literal(WALLETOR_RANDOMNESS_PROGRAM_ID),
  snapshotHash: hex,
});
export type MagicBlockEvidence = z.infer<typeof MagicBlockEvidenceSchema>;
export const MagicBlockRoundInputSchema = z
  .object({ roundId: z.string().regex(/^[a-z0-9:.-]{1,160}$/i) })
  .strict();
export const MagicBlockPrepareSchema = z.object({
  roundId: z.string(),
  authorityAddress: address,
  randomnessAccount: address,
  snapshotHash: hex,
  transaction: z.string().min(1).max(12000).nullable(),
  blockhash: z.string().nullable(),
  lastValidBlockHeight: z.number().int().positive().nullable(),
});
export const MagicBlockStatusSchema = z.object({
  roundId: z.string(),
  randomnessAccount: address,
  status: z.enum(["NOT_REQUESTED", "PENDING", "FULFILLED"]),
  randomnessCommitTransactionSignature: z.string().nullable(),
  randomnessRevealTransactionSignature: z.string().nullable(),
});

export function hexBytes(value: string): Uint8Array {
  hex.parse(value);
  return Uint8Array.from(value.match(/../g) ?? [], (byte) =>
    parseInt(byte, 16),
  );
}
export function bytesHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
export function roundHash(roundId: string): Uint8Array {
  return sha256(new TextEncoder().encode(`walletor:draw:v1:${roundId}`));
}
export function snapshotHash(
  snapshot: Pick<
    PublicPrizeDrawSnapshot,
    | "roundId"
    | "algorithmVersion"
    | "configuredWinnerCount"
    | "winnerCount"
    | "participantCount"
    | "totalWeight"
    | "grossPoolCents"
    | "participantChecksum"
    | "participantMerkleRoot"
    | "claimFeeBps"
  >,
): string {
  return bytesHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          "walletor:magicblock:snapshot:v1",
          snapshot.roundId,
          snapshot.algorithmVersion,
          snapshot.configuredWinnerCount,
          snapshot.winnerCount,
          snapshot.participantCount,
          snapshot.totalWeight,
          snapshot.grossPoolCents,
          snapshot.participantChecksum,
          snapshot.participantMerkleRoot,
          snapshot.claimFeeBps,
        ]),
      ),
    ),
  );
}
export function drawAddress(
  authorityAddress: string,
  roundId: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("draw"),
      new PublicKey(authorityAddress).toBuffer(),
      Buffer.from(roundHash(roundId)),
    ],
    new PublicKey(WALLETOR_RANDOMNESS_PROGRAM_ID),
  );
}
export function instructionDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
}
export function requestDrawInstruction(
  authorityAddress: string,
  roundId: string,
  digest: string,
): TransactionInstruction {
  const programId = new PublicKey(WALLETOR_RANDOMNESS_PROGRAM_ID);
  const identity = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    programId,
  )[0];
  return new TransactionInstruction({
    programId,
    keys: [
      {
        pubkey: new PublicKey(authorityAddress),
        isSigner: true,
        isWritable: true,
      },
      {
        pubkey: drawAddress(authorityAddress, roundId)[0],
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(MAGICBLOCK_QUEUE),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: identity, isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey(MAGICBLOCK_VRF_PROGRAM_ID),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(instructionDiscriminator("request_draw")),
      Buffer.from(roundHash(roundId)),
      Buffer.from(hexBytes(digest)),
    ]),
  });
}

export function parseDrawAccount(
  data: Uint8Array,
  owner: string,
  executable: boolean,
  authorityAddress: string,
  roundId: string,
  digest: string,
) {
  const expectedDiscriminator = sha256(
    new TextEncoder().encode("account:Draw"),
  ).slice(0, 8);
  if (
    owner !== WALLETOR_RANDOMNESS_PROGRAM_ID ||
    executable ||
    data.length !== 155 ||
    bytesHex(data.slice(0, 8)) !== bytesHex(expectedDiscriminator) ||
    new PublicKey(data.slice(8, 40)).toBase58() !== authorityAddress ||
    bytesHex(data.slice(40, 72)) !== bytesHex(roundHash(roundId)) ||
    bytesHex(data.slice(72, 104)) !== digest ||
    data[153] !== drawAddress(authorityAddress, roundId)[1] ||
    data[154] !== 1 ||
    ![0, 1].includes(data[152] ?? -1)
  ) {
    throw new Error(
      "MagicBlock draw account does not match the locked Walletor round.",
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const requestedSlot = view.getBigUint64(136, true);
  const fulfilledSlot = view.getBigUint64(144, true);
  if (
    requestedSlot === 0n ||
    (data[152] === 0 &&
      (fulfilledSlot !== 0n ||
        data.slice(104, 136).some((byte) => byte !== 0))) ||
    (data[152] === 1 && fulfilledSlot < requestedSlot)
  )
    throw new Error("Invalid MagicBlock draw state.");
  return {
    fulfilled: data[152] === 1,
    requestedSlot,
    fulfilledSlot,
    randomnessValue: bytesHex(data.slice(104, 136)),
  };
}

export function assertMagicBlockRequestTransaction(
  transaction: Transaction,
  authority: string,
  roundId: string,
  digest: string,
  blockhash: string,
): void {
  const expected = requestDrawInstruction(authority, roundId, digest);
  const actual = transaction.instructions[0];
  if (
    transaction.feePayer?.toBase58() !== authority ||
    transaction.recentBlockhash !== blockhash ||
    transaction.instructions.length !== 1 ||
    !actual ||
    !actual.programId.equals(expected.programId) ||
    bytesHex(actual.data) !== bytesHex(expected.data) ||
    actual.keys.length !== expected.keys.length ||
    actual.keys.some((key, index) => {
      const match = expected.keys[index];
      return (
        !match ||
        !key.pubkey.equals(match.pubkey) ||
        key.isSigner !== match.isSigner ||
        key.isWritable !== match.isWritable
      );
    }) ||
    transaction.compileMessage().header.numRequiredSignatures !== 1
  )
    throw new Error(
      "The MagicBlock request transaction does not match this locked round. Nothing was signed.",
    );
}
