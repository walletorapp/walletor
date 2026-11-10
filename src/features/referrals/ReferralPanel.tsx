import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import bs58 from "bs58";
import { segmentoReferral } from "../affiliates/segmento-referral";
import {
  ReferralChallengeSchema,
  ReferralCodeSchema,
  ReferralStateSchema,
  referralMessage,
} from "../../../shared/referral-contracts";
import "./referrals.css";

const INVITE_KEY = "walletor:referral-invite:v1";
function savedInvite(): string | null {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(INVITE_KEY) ?? "null",
    );
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("code" in raw) ||
      !("expiresAt" in raw) ||
      typeof raw.expiresAt !== "number" ||
      raw.expiresAt < Date.now()
    )
      return null;
    const code = ReferralCodeSchema.safeParse(raw.code);
    return code.success ? code.data : null;
  } catch {
    return null;
  }
}
function captureInvite(search: string): string | null {
  const current = savedInvite();
  if (current) return current;
  if (segmentoReferral(search)) return null;
  const parsed = ReferralCodeSchema.safeParse(
    new URLSearchParams(search).get("ref"),
  );
  if (!parsed.success) return null;
  try {
    window.localStorage.setItem(
      INVITE_KEY,
      JSON.stringify({
        code: parsed.data,
        expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
      }),
    );
  } catch {
    /* The invite still works in the current URL when storage is unavailable. */
  }
  return parsed.data;
}
async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`/api/referrals/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const fallback =
      "Referral registration is unavailable. Try again with the correct wallet before its first swap.";
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
    )
      throw new Error(payload.error.message);
    throw new Error(fallback);
  }
  if (typeof payload !== "object" || payload === null || !("data" in payload))
    throw new Error("Invalid referral response.");
  return payload.data;
}

function subscribeInvite(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("walletor-referral-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("walletor-referral-change", callback);
  };
}
function useInvite(search: string) {
  const code = useSyncExternalStore(subscribeInvite, savedInvite, () => null);
  useEffect(() => {
    captureInvite(search);
    window.dispatchEvent(new Event("walletor-referral-change"));
  }, [search]);
  const candidate = ReferralCodeSchema.safeParse(
    segmentoReferral(search) ? null : new URLSearchParams(search).get("ref"),
  );
  return code ?? (candidate.success ? candidate.data : null);
}
export function ReferralInviteNotice() {
  const location = useLocation();
  const code = useInvite(location.search);
  const [dismissed, setDismissed] = useState(false);
  if (
    !code ||
    dismissed ||
    ["/referal", "/referral"].includes(location.pathname) ||
    location.pathname.startsWith("/admin")
  )
    return null;
  return (
    <aside className="referral-invite-notice" aria-label="Referral invitation">
      <Link to={`/referal?ref=${code}`}>
        You have a referral invite. Register it before your first swap →
      </Link>
      <button
        type="button"
        aria-label="Dismiss referral invitation"
        onClick={() => {
          setDismissed(true);
        }}
      >
        ×
      </button>
    </aside>
  );
}

export function ReferralPanel({ compact = false }: { compact?: boolean }) {
  const { publicKey } = useWallet();
  return (
    <ReferralPanelContent
      key={publicKey?.toBase58() ?? "disconnected"}
      compact={compact}
    />
  );
}
function ReferralPanelContent({ compact = false }: { compact?: boolean }) {
  const { publicKey, connected, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const location = useLocation();
  const wallet = connected ? (publicKey?.toBase58() ?? null) : null;
  const invite = useInvite(location.search);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const state = useQuery({
    queryKey: ["referrals", wallet],
    enabled: !!wallet,
    refetchInterval: 20_000,
    queryFn: async () => {
      const response = await fetch(
        `/api/referrals?wallet=${encodeURIComponent(wallet ?? "")}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("Referral details are temporarily unavailable.");
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload)
      )
        throw new Error("Invalid referral response.");
      return ReferralStateSchema.parse(payload.data);
    },
  });
  const data = state.data;
  const link = data ? `https://walletor.com/?ref=${data.code}` : null;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link ?? "");
      setMessage("Referral link copied.");
    } catch {
      setMessage("Copy unavailable. Select and copy the link above.");
    }
  }
  const shareText =
    "Join me on Walletor. Connect your wallet, register my referral before your first swap, and explore daily USDC Prize Pool rounds. Rewards are not guaranteed.";
  async function register() {
    if (!wallet || !invite || !signMessage) return;
    setBusy(true);
    setMessage("");
    try {
      const challenge = ReferralChallengeSchema.parse(
        await post("challenge", { walletAddress: wallet, code: invite }),
      );
      if (
        challenge.message !==
          referralMessage(
            wallet,
            invite,
            challenge.nonce,
            challenge.expiresAt,
          ) ||
        Date.parse(challenge.expiresAt) <= Date.now()
      )
        throw new Error("The referral message is invalid or expired.");
      const signature = await signMessage(
        new TextEncoder().encode(challenge.message),
      );
      await post("join", {
        walletAddress: wallet,
        code: invite,
        nonce: challenge.nonce,
        signature: bs58.encode(signature),
      });
      setMessage(
        "Referral registered. Complete your first eligible swap of at least $5 to qualify.",
      );
      try {
        window.localStorage.removeItem(INVITE_KEY);
      } catch {
        /* Server registration is already confirmed. */
      }
      window.dispatchEvent(new Event("walletor-referral-change"));
      await state.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Registration did not complete.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`referral-panel ${compact ? "referral-panel--compact" : ""}`}
      aria-labelledby={compact ? "claim-referral-title" : "referral-title"}
    >
      <div className="referral-panel__eyebrow">
        INVITE FRIENDS · BUILD YOUR REWARDS
      </div>
      {compact ? (
        <h2 id="claim-referral-title">Share Walletor. Earn 100 WLT Points.</h2>
      ) : (
        <h1 id="referral-title">Referral</h1>
      )}
      <p>
        Earn <strong>100 WLT Points</strong> when a new wallet you refer
        completes its first verified, fee-bearing swap worth at least $5. One
        bonus per referred wallet.
      </p>
      {!wallet ? (
        <button
          type="button"
          className="referral-primary"
          onClick={() => {
            setVisible(true);
          }}
        >
          Connect wallet to get your link
        </button>
      ) : (
        <>
          {state.isPending && <p role="status">Loading your referral link…</p>}
          {state.isError && (
            <p role="alert">
              Referral details are unavailable.{" "}
              <button
                type="button"
                onClick={() => {
                  void state.refetch();
                }}
              >
                Retry
              </button>
            </p>
          )}
          {data && (
            <>
              <label
                className="referral-link-label"
                htmlFor={compact ? "claim-referral-link" : "referral-link"}
              >
                Your permanent referral link
              </label>
              <div className="referral-link-row">
                <input
                  id={compact ? "claim-referral-link" : "referral-link"}
                  readOnly
                  value={link ?? ""}
                  onFocus={(e) => {
                    e.currentTarget.select();
                  }}
                />
                <button
                  type="button"
                  className="referral-primary"
                  onClick={() => {
                    void copyLink();
                  }}
                >
                  Copy link
                </button>
              </div>
              {link && (
                <div
                  className="referral-share"
                  aria-label="Share your referral link"
                >
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(link)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className="referral-share__logo"
                      src="/assets/x-logo.svg"
                      alt=""
                      width="24"
                      height="24"
                    />
                    <span>Twitter / X ↗</span>
                  </a>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${link}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className="referral-share__logo"
                      src="/assets/whatsapp-logo.svg"
                      alt=""
                      width="24"
                      height="24"
                    />
                    <span>WhatsApp ↗</span>
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className="referral-share__logo"
                      src="/assets/telegram-logo.svg"
                      alt=""
                      width="24"
                      height="24"
                    />
                    <span>Telegram ↗</span>
                  </a>
                </div>
              )}
              <dl className="referral-stats">
                <div>
                  <dt>Qualified referrals</dt>
                  <dd>{data.qualifiedReferrals}</dd>
                </div>
                <div>
                  <dt>Referral WLT Points</dt>
                  <dd>{data.bonusPoints}</dd>
                </div>
                <div>
                  <dt>Current lucky-draw weight boost</dt>
                  <dd>+{data.boostBps / 100}%</dd>
                </div>
              </dl>
              <p className="referral-detail">
                Each qualified referral adds 10% to your lucky-draw weight for
                that round, up to 50%. You must qualify with your own eligible
                swap. Fee-leader rankings are unchanged. A weight boost is not a
                guaranteed increase of the same percentage in your chance of
                winning.
              </p>
              <p className="referral-detail">
                Boost rules apply to rounds starting on or after{" "}
                {new Date(data.boostStartsAt).toUTCString()}. Your current round
                ends {new Date(data.roundEndsAt).toUTCString()}. Boosts do not
                carry over.
              </p>
              {invite && !data.joined && (
                <div className="referral-register">
                  <h3>Register your invitation</h3>
                  {data.canJoin && invite !== data.code ? (
                    <>
                      <p>
                        Confirm your referrer with a free wallet message
                        signature before your first Walletor swap. This does not
                        move funds.
                      </p>
                      <button
                        type="button"
                        className="referral-primary"
                        disabled={busy || !signMessage}
                        onClick={() => {
                          void register();
                        }}
                      >
                        {busy ? "Confirm in your wallet…" : "Register referral"}
                      </button>
                      {!signMessage && (
                        <p>
                          Your wallet must support message signing to register
                          an invite.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>
                      {invite === data.code
                        ? "You cannot refer your own wallet."
                        : "Only new wallets can register a referral before their first Walletor swap."}
                    </p>
                  )}
                </div>
              )}
              {data.joined && (
                <p className="referral-detail">
                  Your wallet already has a registered referrer. Attribution
                  cannot be changed.
                </p>
              )}
            </>
          )}
        </>
      )}
      {message && (
        <p role="status" className="referral-message">
          {message}
        </p>
      )}
      <p className="referral-detail">
        Sharing alone earns no points. No self-referrals or duplicate bonuses.
        WLT Points are off-chain rewards, not transferable tokens or guaranteed
        cash value.
      </p>
      {compact && (
        <Link className="referral-more" to="/referal">
          Open your Referral page →
        </Link>
      )}
    </section>
  );
}
