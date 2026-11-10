// @vitest-environment node
import { Keypair, type ParsedTransactionWithMeta } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { expect, it } from "vitest";
import { SOLANA_MAINNET_USDC_MINT } from "../../shared/usdc-claim-contracts";
import { verifySeedDepositTransaction } from "./prize-seed";

const treasury = Keypair.generate().publicKey;
const sender = Keypair.generate().publicKey;
const mint = new PublicKey(SOLANA_MAINNET_USDC_MINT);
const destination = getAssociatedTokenAddressSync(mint, treasury);
const source = getAssociatedTokenAddressSync(mint, sender);
const requested = "2026-10-04T12:00:00.000Z";
const now = new Date("2026-10-04T12:02:00.000Z");
function transaction(): ParsedTransactionWithMeta {
  return {
    slot: 100,
    blockTime: Date.parse("2026-10-04T12:01:00.000Z") / 1000,
    transaction: {
      signatures: ["signature"],
      message: {
        recentBlockhash: "hash",
        accountKeys: [sender, source, destination].map((pubkey, index) => ({
          pubkey,
          signer: index === 0,
          writable: true,
        })),
        instructions: [
          {
            programId: TOKEN_PROGRAM_ID,
            program: "spl-token",
            parsed: {
              type: "transferChecked",
              info: {
                authority: sender.toBase58(),
                source: source.toBase58(),
                destination: destination.toBase58(),
                mint: mint.toBase58(),
                tokenAmount: { amount: "700000000", decimals: 6 },
              },
            },
          },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      preTokenBalances: [
        {
          accountIndex: 1,
          mint: mint.toBase58(),
          owner: sender.toBase58(),
          uiTokenAmount: { amount: "700000000", decimals: 6, uiAmount: 700 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 2,
          mint: mint.toBase58(),
          owner: treasury.toBase58(),
          uiTokenAmount: { amount: "700000000", decimals: 6, uiAmount: 700 },
        },
      ],
    },
  };
}
const verify = (tx: ParsedTransactionWithMeta | null) => {
  verifySeedDepositTransaction(
    tx,
    treasury.toBase58(),
    destination.toBase58(),
    requested,
    now,
  );
};
it("accepts a fresh successful direct mainnet-USDC deposit", () => {
  expect(() => {
    verify(transaction());
  }).not.toThrow();
});
it("rejects missing, failed and pre-existing transfers", () => {
  expect(() => {
    verify(null);
  }).toThrow();
  const tx = transaction();
  tx.blockTime = Date.parse(requested) / 1000 - 1;
  expect(() => {
    verify(tx);
  }).toThrow();
  if (tx.meta) tx.meta.err = { InstructionError: [0, "failed"] };
  expect(() => {
    verify(tx);
  }).toThrow();
});
it("rejects swaps, fee collections and arbitrary program callbacks", () => {
  const tx = transaction();
  tx.transaction.message.instructions.push({
    programId: Keypair.generate().publicKey,
    accounts: [],
    data: "",
  });
  expect(() => {
    verify(tx);
  }).toThrow("direct USDC transfer");
});
it("rejects a wrong recipient, an insufficient deposit, or a non-signer", () => {
  expect(() => {
    verifySeedDepositTransaction(
      transaction(),
      treasury.toBase58(),
      source.toBase58(),
      requested,
      now,
    );
  }).toThrow();
  const tx = transaction();
  const post = tx.meta?.postTokenBalances?.[0];
  if (post) post.uiTokenAmount.amount = "699000000";
  expect(() => {
    verify(tx);
  }).toThrow("exactly 700");
  const unsigned = transaction();
  const key = unsigned.transaction.message.accountKeys[0];
  if (key) key.signer = false;
  expect(() => {
    verify(unsigned);
  }).toThrow();
});
