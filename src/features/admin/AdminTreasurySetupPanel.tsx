import { useState } from "react";
import { z } from "zod";
import { TreasurySetupResponseSchema } from "../../../shared/treasury-setup-contracts";

async function loadSetup() {
  const response = await fetch("/admin/api/treasury/setup", {
    credentials: "same-origin",
  });
  if (response.status === 401 || response.status === 403 || response.redirected)
    throw new Error(
      "Your admin session has expired or access was denied. Refresh your admin session and try again.",
    );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const failure = z
      .object({ error: z.object({ message: z.string().max(500) }) })
      .safeParse(body);
    throw new Error(
      failure.success
        ? failure.data.error.message
        : `Treasury verification failed (HTTP ${String(response.status)}). Please try again.`,
    );
  }
  return TreasurySetupResponseSchema.parse(await response.json()).data;
}

export function AdminTreasurySetupPanel({
  authorityAddress,
  automaticSettlementEnabled,
}: {
  authorityAddress: string;
  automaticSettlementEnabled: boolean;
}) {
  const [setup, setSetup] = useState<Awaited<
    ReturnType<typeof loadSetup>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    setSetup(null);
    try {
      setSetup(await loadSetup());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Treasury check failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="admin-panel admin-treasury-setup"
      aria-labelledby="treasury-setup-title"
    >
      <h2 id="treasury-setup-title">Manual rewards funding</h2>
      <p>
        You hold the funds and approve each USDC distribution in your wallet.
        Winners then claim their USDC themselves.
      </p>
      <p>
        Distribution wallet: <code>{authorityAddress}</code>
      </p>
      {automaticSettlementEnabled ? (
        <p role="alert">
          Automatic spending is enabled in server configuration. Manual-only
          funding requires it to be disabled.
        </p>
      ) : (
        <p>
          Automatic spending is disabled. After you fund a distribution,
          Walletor verifies it and activates winner claims.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void check();
        }}
      >
        {busy ? "Checking treasury…" : "Check fee recipient"}
      </button>
      {setup ? (
        <div aria-live="polite">
          <p>
            Current fee recipient: <code>{setup.currentPartner}</code> ·
            Walletor share: {setup.partnerShareBps / 100}%
          </p>
          {setup.currentPartner === authorityAddress ? (
            <p role="status">
              Fee recipient matches your distribution wallet. Collect referral
              fees into this wallet and prepare the required USDC before funding
              a round below.
            </p>
          ) : (
            <p role="alert">
              The fee recipient differs from the distribution wallet. Resolve
              the recipient configuration before collecting fees for manual
              funding.
            </p>
          )}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
