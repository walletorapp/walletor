import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction, type Connection } from "@solana/web3.js";
import { z } from "zod";
import {
  assertMagicBlockRequestTransaction,
  drawAddress,
  MagicBlockPrepareSchema,
  MagicBlockStatusSchema,
} from "../../../shared/magicblock-randomness";

interface Evidence {
  randomnessAccount: string;
  randomnessCommitTransactionSignature: string;
  randomnessRevealTransactionSignature: string | null;
}

async function request(
  action: "prepare" | "status",
  roundId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    `/admin/api/claim-distributions/magicblock/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roundId }),
      signal,
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(payload);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : "Could not check the MagicBlock draw. Retry to recover the same request.",
    );
  }
  return z.object({ data: z.unknown() }).parse(payload).data;
}

export function MagicBlockRequestPanel({
  roundId,
  authority,
  enabled,
  connection,
  onEvidence,
}: {
  roundId: string;
  authority: string;
  enabled: boolean;
  connection: Connection;
  onEvidence: (evidence: Evidence | null) => void;
}) {
  const { publicKey, sendTransaction } = useWallet();
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!watching || ready) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const status = MagicBlockStatusSchema.parse(
          await request("status", roundId, controller.signal),
        );
        if (controller.signal.aborted) return;
        if (
          status.roundId !== roundId ||
          status.randomnessAccount !==
            drawAddress(authority, roundId)[0].toBase58()
        )
          throw new Error(
            "The returned draw does not match the selected round.",
          );
        if (
          status.status === "FULFILLED" &&
          status.randomnessCommitTransactionSignature &&
          status.randomnessRevealTransactionSignature
        ) {
          onEvidence({
            randomnessAccount: status.randomnessAccount,
            randomnessCommitTransactionSignature:
              status.randomnessCommitTransactionSignature,
            randomnessRevealTransactionSignature:
              status.randomnessRevealTransactionSignature,
          });
          setReady(true);
          setError(null);
          return;
        }
        setError(null);
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "The draw status is unavailable.",
          );
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void check();
        }, 5000);
    };
    void check();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [watching, ready, roundId, authority, onEvidence]);

  const prepare = async () => {
    if (!enabled || publicKey?.toBase58() !== authority) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = MagicBlockPrepareSchema.parse(
        await request("prepare", roundId),
      );
      if (
        prepared.roundId !== roundId ||
        prepared.authorityAddress !== authority ||
        prepared.randomnessAccount !==
          drawAddress(authority, roundId)[0].toBase58()
      )
        throw new Error("The request belongs to a different round or wallet.");
      setWatching(true);
      if (prepared.transaction !== null) {
        if (!prepared.blockhash)
          throw new Error("The request blockhash is missing.");
        const transaction = Transaction.from(
          Uint8Array.from(atob(prepared.transaction), (char) =>
            char.charCodeAt(0),
          ),
        );
        assertMagicBlockRequestTransaction(
          transaction,
          authority,
          roundId,
          prepared.snapshotHash,
          prepared.blockhash,
        );
        await sendTransaction(transaction, connection, {
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The request could not be submitted. Retry to recover the same draw.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <article>
        <strong>1. Request randomness</strong>
        <small>
          Sign one MagicBlock request for this locked round. Retrying recovers
          the same draw.
        </small>
        <button
          className="admin-primary-button"
          type="button"
          disabled={!enabled || busy || ready}
          onClick={() => void prepare()}
        >
          {busy
            ? "Preparing…"
            : watching
              ? "Recover request"
              : "Request / resume in wallet"}
        </button>
      </article>
      <article>
        <strong>2. Automatic oracle response</strong>
        <small>
          MagicBlock returns verifiable randomness on Solana. No reveal
          signature is needed.
        </small>
        <span role="status">
          {ready
            ? "RANDOMNESS VERIFIED · READY TO FUND"
            : watching
              ? "WAITING FOR FINALIZED RANDOMNESS"
              : "WAITING FOR REQUEST"}
        </span>
        {error ? <p role="alert">{error}</p> : null}
      </article>
    </>
  );
}
