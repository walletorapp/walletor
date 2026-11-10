import bs58 from "bs58";
import { z } from "zod";

import type { PumpTokenIngestItem } from "../../shared/contracts";
import { PumpTokenIngestItemSchema } from "../../shared/contracts";
import { authorizeBearer } from "../lib/auth";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress, isSolanaSignature } from "../lib/solana";

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const CREATE_DISCRIMINATOR = Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]);
const CREATE_V2_DISCRIMINATOR = Uint8Array.from([
  214, 144, 76, 236, 95, 139, 49, 180,
]);
const rawInstructionSchema = z.object({
  accounts: z.array(z.number().int().nonnegative()).max(64),
  data: z.string().min(1).max(2_000),
  programIdIndex: z.number().int().nonnegative(),
});
const heliusRawWebhookSchema = z
  .array(
    z.object({
      blockTime: z.number().int().nonnegative().nullable(),
      meta: z.object({
        err: z.unknown().nullable(),
        innerInstructions: z
          .array(
            z.object({
              instructions: z.array(rawInstructionSchema).max(100),
            }),
          )
          .nullable()
          .optional(),
        loadedAddresses: z
          .object({
            writable: z.array(z.string()).max(256),
            readonly: z.array(z.string()).max(256),
          })
          .optional(),
      }),
      transaction: z.object({
        message: z.object({
          accountKeys: z.array(z.string()).max(256),
          instructions: z.array(rawInstructionSchema).max(100),
        }),
        signatures: z.array(z.string()).min(1).max(16),
      }),
    }),
  )
  .max(100);

export async function authorizeTokenIngest(
  authorization: string | undefined,
  secret: string | undefined,
): Promise<void> {
  await authorizeBearer(authorization, secret, {
    notConfiguredCode: "TOKEN_INGEST_NOT_CONFIGURED",
    notConfiguredMessage: "Real-time token ingestion is not configured.",
    unauthorizedCode: "TOKEN_INGEST_UNAUTHORIZED",
    unauthorizedMessage: "Token ingestion authorization failed.",
  });
}

function isSafeMetadataUri(value: string | null): boolean {
  if (value === null) return true;
  if (value.startsWith("ipfs://")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function validatePumpTokens(
  tokens: PumpTokenIngestItem[],
): PumpTokenIngestItem[] {
  for (const token of tokens) {
    if (
      !isSolanaAddress(token.mint) ||
      !isSolanaAddress(token.tokenProgram) ||
      (token.creatorAddress !== null &&
        !isSolanaAddress(token.creatorAddress)) ||
      !isSolanaSignature(token.creationSignature) ||
      !isSafeMetadataUri(token.metadataUri) ||
      (token.logoUrl !== null && new URL(token.logoUrl).protocol !== "https:")
    ) {
      throw new ApiFailure(
        400,
        "INVALID_PUMP_TOKEN_EVENT",
        "The Pump.fun token event failed validation.",
        false,
      );
    }
  }
  return tokens;
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  if (value.length < prefix.length) return false;
  return prefix.every((byte, index) => value[index] === byte);
}

function readBorshString(
  bytes: Uint8Array,
  offset: number,
): { value: string; offset: number } | null {
  if (offset + 4 > bytes.length) return null;
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4,
  ).getUint32(0, true);
  const start = offset + 4;
  const end = start + length;
  if (length > 500 || end > bytes.length) return null;
  try {
    return {
      value: new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.slice(start, end),
      ),
      offset: end,
    };
  } catch {
    return null;
  }
}

function decodeCreateInstruction(encoded: string): {
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  version: 1 | 2;
} | null {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(encoded);
  } catch {
    return null;
  }
  const version = startsWith(bytes, CREATE_DISCRIMINATOR)
    ? 1
    : startsWith(bytes, CREATE_V2_DISCRIMINATOR)
      ? 2
      : null;
  if (version === null) return null;
  const name = readBorshString(bytes, 8);
  const symbol = name && readBorshString(bytes, name.offset);
  const uri = symbol && readBorshString(bytes, symbol.offset);
  if (!name || !symbol || !uri || uri.offset + 32 > bytes.length) return null;
  return {
    name: name.value,
    symbol: symbol.value,
    uri: uri.value,
    creator: bs58.encode(bytes.slice(uri.offset, uri.offset + 32)),
    version,
  };
}

export function parseHeliusPumpWebhook(
  input: unknown,
): PumpTokenIngestItem[] | null {
  const parsed = heliusRawWebhookSchema.safeParse(input);
  if (!parsed.success) return null;
  const tokens = new Map<string, PumpTokenIngestItem>();
  for (const event of parsed.data) {
    if (event.meta.err !== null || event.blockTime === null) continue;
    const keys = [
      ...event.transaction.message.accountKeys,
      ...(event.meta.loadedAddresses?.writable ?? []),
      ...(event.meta.loadedAddresses?.readonly ?? []),
    ];
    const instructions = [
      ...event.transaction.message.instructions,
      ...(event.meta.innerInstructions ?? []).flatMap(
        (group) => group.instructions,
      ),
    ];
    const signature = event.transaction.signatures[0];
    if (!signature || !isSolanaSignature(signature)) continue;
    for (const instruction of instructions) {
      if (keys[instruction.programIdIndex] !== PUMP_PROGRAM) continue;
      const decoded = decodeCreateInstruction(instruction.data);
      if (!decoded) continue;
      const mintIndex = instruction.accounts[0];
      const tokenProgramIndex =
        instruction.accounts[decoded.version === 1 ? 9 : 7];
      const mint = mintIndex === undefined ? undefined : keys[mintIndex];
      const tokenProgram =
        tokenProgramIndex === undefined ? undefined : keys[tokenProgramIndex];
      if (!mint || !tokenProgram) continue;
      const token = PumpTokenIngestItemSchema.safeParse({
        mint,
        symbol: decoded.symbol,
        name: decoded.name,
        decimals: 6,
        logoUrl: null,
        metadataUri: decoded.uri,
        creatorAddress: decoded.creator,
        tokenProgram,
        creationSignature: signature,
        createdAt: new Date(event.blockTime * 1_000).toISOString(),
      });
      if (token.success) tokens.set(token.data.mint, token.data);
    }
  }
  return validatePumpTokens([...tokens.values()]);
}
