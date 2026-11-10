import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Connection, PublicKey } from "@solana/web3.js";
import { afterEach, expect, it, vi } from "vitest";
import { drawAddress } from "../../../shared/magicblock-randomness";
import type * as MagicBlockRandomness from "../../../shared/magicblock-randomness";
import { MagicBlockRequestPanel } from "./MagicBlockRequestPanel";

const authority = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const roundId = "solana:mainnet:prize-pool:2026-09-23T00:00:00.000Z";
const digest = "12".repeat(32);
const sendTransaction = vi.hoisted(() => vi.fn());
// Account derivation and transaction validation run in the node tests. Avoid
// jsdom/Node Uint8Array realm incompatibility inside web3's curve library here.
vi.mock("../../../shared/magicblock-randomness", async (importOriginal) => {
  const original = await importOriginal<typeof MagicBlockRandomness>();
  return { ...original, drawAddress: () => [new PublicKey(authority), 255] };
});
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: new PublicKey(authority), sendTransaction }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("recovers a fulfilled draw after refresh without asking for another signature", async () => {
  const address = drawAddress(authority, roundId)[0].toBase58();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        data: {
          roundId,
          authorityAddress: authority,
          randomnessAccount: address,
          snapshotHash: digest,
          transaction: null,
          blockhash: null,
          lastValidBlockHeight: null,
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: {
          roundId,
          randomnessAccount: address,
          status: "FULFILLED",
          randomnessCommitTransactionSignature: "request",
          randomnessRevealTransactionSignature: "callback",
        },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const onEvidence = vi.fn();
  render(
    <MagicBlockRequestPanel
      roundId={roundId}
      authority={authority}
      enabled
      connection={new Connection("https://rpc.example.test")}
      onEvidence={onEvidence}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Request / resume in wallet" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("RANDOMNESS VERIFIED"),
  );
  expect(onEvidence).toHaveBeenCalledWith({
    randomnessAccount: address,
    randomnessCommitTransactionSignature: "request",
    randomnessRevealTransactionSignature: "callback",
  });
  expect(sendTransaction).not.toHaveBeenCalled();
});
