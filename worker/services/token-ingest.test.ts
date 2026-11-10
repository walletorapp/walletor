import bs58 from "bs58";
import { describe, expect, it } from "vitest";

import { mint } from "../../tests/fixtures";
import { authorizeTokenIngest, parseHeliusPumpWebhook } from "./token-ingest";

const pumpProgram = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function borshString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, encoded.length, true);
  return Uint8Array.from([...length, ...encoded]);
}

function createInstructionData(): string {
  return bs58.encode(
    Uint8Array.from([
      24,
      30,
      200,
      40,
      5,
      28,
      7,
      119,
      ...borshString("Walletor Test"),
      ...borshString("WTEST"),
      ...borshString("https://metadata.example/token.json"),
      ...new Uint8Array(32).fill(7),
    ]),
  );
}

describe("Pump.fun token ingestion", () => {
  it("decodes confirmed Helius raw-webhook create instructions", () => {
    const signature = bs58.encode(new Uint8Array(64).fill(9));
    const result = parseHeliusPumpWebhook([
      {
        blockTime: 1_786_838_400,
        meta: {
          err: null,
          innerInstructions: [],
          loadedAddresses: { writable: [], readonly: [] },
        },
        transaction: {
          message: {
            accountKeys: [
              "11111111111111111111111111111111",
              mint,
              tokenProgram,
              "11111111111111111111111111111111",
              "11111111111111111111111111111111",
              "11111111111111111111111111111111",
              "11111111111111111111111111111111",
              "11111111111111111111111111111111",
              "11111111111111111111111111111111",
              "11111111111111111111111111111111",
              pumpProgram,
            ],
            instructions: [
              {
                accounts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 2],
                data: createInstructionData(),
                programIdIndex: 10,
              },
            ],
          },
          signatures: [signature],
        },
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        mint,
        symbol: "WTEST",
        name: "Walletor Test",
        decimals: 6,
        metadataUri: "https://metadata.example/token.json",
        tokenProgram,
        creationSignature: signature,
      }),
    ]);
  });

  it("acknowledges valid non-create Pump webhook batches as empty", () => {
    expect(parseHeliusPumpWebhook([])).toEqual([]);
  });

  it("rejects an invalid ingestion bearer secret", async () => {
    await expect(
      authorizeTokenIngest("Bearer wrong", "correct"),
    ).rejects.toMatchObject({
      status: 401,
      code: "TOKEN_INGEST_UNAUTHORIZED",
    });
  });
});
