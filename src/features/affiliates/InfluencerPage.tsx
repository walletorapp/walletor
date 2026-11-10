import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Link } from "react-router-dom";
import {
  InfluencerProfileSchema,
  InfluencerReportSchema,
  InfluencerReportQuerySchema,
  type InfluencerReport,
} from "../../../shared/influencer-contracts";
import {
  defaultInfluencerDates,
  influencerDateQuery,
  influencerApi,
  signInfluencerAction,
} from "./influencer-client";
import { InfluencerReportView } from "./InfluencerReportView";
import "./segmento.css";

export function InfluencerPage() {
  const { publicKey } = useWallet();
  return <InfluencerPageContent key={publicKey?.toBase58() ?? "none"} />;
}
function InfluencerPageContent() {
  const { publicKey, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey?.toBase58() ?? "";
  const profile = useQuery({
    queryKey: ["direct-influencer-profile", wallet],
    enabled: !!wallet,
    retry: false,
    queryFn: async () =>
      InfluencerProfileSchema.parse(
        await influencerApi(
          `/api/influencers/profile?${new URLSearchParams({ wallet })}`,
        ),
      ),
  });
  const [dates, setDates] = useState(defaultInfluencerDates);
  const [report, setReport] = useState<InfluencerReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function enroll() {
    if (!signMessage || !profile.data) return;
    setBusy(true);
    setError("");
    try {
      const proof = await signInfluencerAction(
        wallet,
        profile.data.code,
        "ENROLL",
        signMessage,
      );
      await influencerApi("/api/influencers/enroll", proof);
      await profile.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }
  async function load(next: boolean) {
    setBusy(true);
    setError("");
    if (!next) setReport(null);
    try {
      if (!signMessage || !profile.data?.registered)
        throw new Error("Register your influencer wallet first.");
      const query = InfluencerReportQuerySchema.parse(
        next && report
          ? { ...report.query, after: report.nextCursor ?? 0 }
          : influencerDateQuery(dates.from, dates.through),
      );
      const proof = await signInfluencerAction(
        wallet,
        profile.data.code,
        "REPORT",
        signMessage,
      );
      setReport(
        InfluencerReportSchema.parse(
          await influencerApi("/api/influencers/report", { proof, query }),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Earnings unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyLink() {
    if (!profile.data?.registered) return;
    try {
      await navigator.clipboard.writeText(profile.data.referralUrl);
      setCopied(true);
    } catch {
      setError("Copy the referral link from the field below.");
    }
  }
  return (
    <main className="segmento-privacy influencer-page">
      <Link to="/">← Back to Walletor</Link>
      <h1>Influencer earnings</h1>
      <p>
        Join Walletor’s influencer program. Earn 10% of Walletor’s confirmed
        fees from your referred users’ future swaps, for the lifetime of their
        registered wallet.
      </p>
      <ol>
        <li>
          Connect your wallet and create your personal referral link with a free
          signature.
        </li>
        <li>
          Share your link. New users register their wallet before their first
          swap quote.
        </li>
        <li>
          Track verified earnings here. Payments are handled manually every 30
          days.
        </li>
      </ol>
      <p>
        There is no extra referral charge for users. Earnings come from
        Walletor’s existing reserve, in the fee token received. A different user
        wallet needs its own registration. Historical swaps are excluded. A
        signature never transfers funds.
      </p>
      {!publicKey ? (
        <button
          type="button"
          onClick={() => {
            setVisible(true);
          }}
        >
          Connect influencer wallet
        </button>
      ) : (
        <>
          {profile.isPending ? (
            <p role="status">Loading your creator profile…</p>
          ) : null}
          {profile.isError ? (
            <>
              <p role="alert">Your creator profile is unavailable.</p>
              <button
                type="button"
                onClick={() => {
                  void profile.refetch();
                }}
              >
                Retry profile
              </button>
            </>
          ) : null}
          {!signMessage ? (
            <p>
              Your wallet must support message signing to enroll and view
              earnings.
            </p>
          ) : null}
          {profile.data && !profile.data.registered ? (
            <button
              type="button"
              disabled={busy || !signMessage}
              onClick={() => {
                void enroll();
              }}
            >
              {busy ? "Registering…" : "Create my influencer link"}
            </button>
          ) : null}
          {profile.data?.registered ? (
            <>
              <label>
                Your referral link
                <input readOnly value={profile.data.referralUrl} />
              </label>
              <button
                type="button"
                onClick={() => {
                  void copyLink();
                }}
              >
                {copied ? "Copied" : "Copy referral link"}
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void load(false);
                }}
              >
                <label>
                  From (UTC)
                  <input
                    required
                    disabled={busy}
                    type="date"
                    value={dates.from}
                    onChange={(e) => {
                      setDates({ ...dates, from: e.target.value });
                      setReport(null);
                    }}
                  />
                </label>
                <label>
                  Through (UTC)
                  <input
                    required
                    disabled={busy}
                    type="date"
                    value={dates.through}
                    onChange={(e) => {
                      setDates({ ...dates, through: e.target.value });
                      setReport(null);
                    }}
                  />
                </label>
                <button disabled={busy || !signMessage}>
                  {busy ? "Loading…" : "Sign to view earnings"}
                </button>
              </form>
            </>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <>
          <InfluencerReportView report={report} />
          {report.nextCursor ? (
            <button
              disabled={busy}
              type="button"
              onClick={() => {
                void load(true);
              }}
            >
              Sign to load next receipts
            </button>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
