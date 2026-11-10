// @vitest-environment node
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { expect, it } from "vitest";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMerkleClaimInstruction,
} from "../../shared/solana-foundation-rewards";
import { validateConfirmedClaimTransaction } from "./usdc-claims";

it("accepts Phantom fee and Lighthouse additions but rejects changed claim data or unrelated transfers", () => {
  const winner = Keypair.generate();
  const row = {
    winner_address: winner.publicKey.toBase58(),
    distribution_address: Keypair.generate().publicKey.toBase58(),
    distribution_vault_address: Keypair.generate().publicKey.toBase58(),
    net_amount_atomic: "1755000",
    proof_json: "[]",
  };
  const claim = createMerkleClaimInstruction({
    distributionAddress: row.distribution_address,
    distributionVaultAddress: row.distribution_vault_address,
    winnerAddress: row.winner_address,
    netAmountAtomic: 1755000n,
    proof: [],
  });
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    createAssociatedTokenAccountIdempotentInstruction(
      row.winner_address,
      row.winner_address,
    ),
    claim,
    new TransactionInstruction({
      programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"),
      keys: [{ pubkey: winner.publicKey, isSigner: false, isWritable: false }],
      data: Buffer.from([1]),
    }),
  ];
  const validate = (items: TransactionInstruction[], expected = row) => {
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: winner.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: items,
      }).compileToV0Message(),
    );
    tx.sign([winner]);
    validateConfirmedClaimTransaction(
      tx.serialize(),
      bs58.encode(tx.signatures[0] ?? new Uint8Array()),
      expected,
    );
  };
  expect(() => {
    validate(instructions);
  }).not.toThrow();
  expect(() => {
    validate(instructions, { ...row, net_amount_atomic: "1755001" });
  }).toThrow("does not match");
  expect(() => {
    validate(instructions, {
      ...row,
      winner_address: Keypair.generate().publicKey.toBase58(),
    });
  }).toThrow("not signed");
  expect(() => {
    validate([...instructions, claim]);
  }).toThrow("unexpected instructions");
  expect(() => {
    validate([
      ...instructions,
      SystemProgram.transfer({
        fromPubkey: winner.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ]);
  }).toThrow("unexpected instructions");
});
