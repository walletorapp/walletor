import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { InfluencerStatusSchema } from "../../../shared/influencer-contracts";
import { influencerApi, signInfluencerAction } from "./influencer-client";

export function InfluencerInvite({ code }: { code: string }) {
  const { publicKey } = useWallet();
  return (
    <Invite key={`${code}:${publicKey?.toBase58() ?? "none"}`} code={code} />
  );
}
function Invite({ code }: { code: string }) {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = useQuery({
    queryKey: ["influencer-status", wallet, code],
    enabled: !!wallet,
    retry: false,
    queryFn: async () =>
      InfluencerStatusSchema.parse(
        await influencerApi(
          `/api/influencers/status?${new URLSearchParams({ walletAddress: wallet, code })}`,
        ),
      ),
  });
  async function register() {
    if (!signMessage) {
      setError(
        "This wallet does not support message signing. No referral was registered.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const proof = await signInfluencerAction(
        wallet,
        code,
        "JOIN",
        signMessage,
      );
      await influencerApi("/api/influencers/join", proof);
      await status.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Referral registration failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!status.data?.canJoin && !status.data?.joined) return null;
  return (
    <aside
      className="influencer-invite"
      aria-label="Creator referral registration"
    >
      {status.data.joined ? (
        <p>Your lifetime referral to {status.data.name} is registered.</p>
      ) : (
        <>
          <p>
            Support {status.data.name}: register this wallet before your first
            swap quote. They earn 10% of Walletor’s fees from your future swaps,
            with no extra referral charge.
          </p>
          <button
            type="button"
            disabled={busy || !signMessage}
            onClick={() => {
              void register();
            }}
          >
            {busy ? "Registering…" : "Register creator referral"}
          </button>
          {!signMessage ? (
            <p>Your wallet needs message-signing support to register.</p>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
