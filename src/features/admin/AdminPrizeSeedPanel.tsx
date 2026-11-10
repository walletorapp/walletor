import { useState } from "react";
import {
  PrizeSeedStateSchema,
  type PrizeSeedState,
} from "../../../shared/prize-seed-contracts";
import { z } from "zod";

export function AdminPrizeSeedPanel() {
  const [state, setState] = useState<PrizeSeedState | null>(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function request(action?: "prepare" | "confirm") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/admin/api/prize-seed${action ? `/${action}` : ""}`,
        {
          credentials: "same-origin",
          ...(action
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  action === "confirm" ? { signature: signature.trim() } : {},
                ),
              }
            : {}),
        },
      );
      if (
        response.redirected ||
        response.status === 401 ||
        response.status === 403
      )
        throw new Error("Refresh your admin login and try again.");
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = z
          .object({ error: z.object({ message: z.string().max(1000) }) })
          .safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.error.message
            : "Reserve check failed. Please retry.",
        );
      }
      setState(z.object({ data: PrizeSeedStateSchema }).parse(body).data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Reserve check failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel" aria-labelledby="daily-seed-heading">
      <h2 id="daily-seed-heading">$100 daily Prize Pool + swap fees</h2>
      <p>
        Fund seven daily rounds with 700 USDC. The first $100 is added when the
        next full 24-hour round starts. Swap fees add to each round as usual.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void request();
        }}
      >
        {busy ? "Checking…" : "Check daily reserve"}
      </button>
      {state && !state.requestedAt ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void request("prepare");
          }}
        >
          Prepare 700 USDC reserve
        </button>
      ) : null}
      {state?.requestedAt && !state.fundedAt ? (
        <>
          <p>
            Send exactly <strong>700 USDC on Solana</strong> from another wallet
            to this distribution wallet:
          </p>
          <p>
            <code style={{ overflowWrap: "anywhere" }}>
              {state.authorityAddress}
            </code>
          </p>
          <p>
            Send after preparing this reserve, then paste its transaction
            signature below. Keep the reserve in this wallet for payouts.
            Preparing does not transfer money.
          </p>
          <label htmlFor="seed-signature">Deposit transaction signature</label>
          <input
            id="seed-signature"
            value={signature}
            onChange={(event) => {
              setSignature(event.target.value);
            }}
            autoComplete="off"
          />
          <button
            type="button"
            disabled={busy || !signature.trim()}
            onClick={() => {
              void request("confirm");
            }}
          >
            Verify deposit and schedule seven rounds
          </button>
        </>
      ) : null}
      {state?.fundedAt ? (
        <div role="status">
          <p>
            700 USDC deposit verified. {state.seededRounds} of 7 rounds seeded.
          </p>
          <p>
            Schedule: {state.startsAt} to {state.endsAt} (UTC). Unallocated
            reserve: ${(state.remainingCents / 100).toFixed(2)}.
          </p>
          <p>
            No further daily seeds after this campaign. Continue approving prize
            distributions in your wallet. This reserve is held in your
            distribution wallet, not locked in an escrow.
          </p>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
