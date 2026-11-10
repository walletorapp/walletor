import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowRight,
  CircleDollarSign,
  Flame,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { formatUsdCents } from "../prize-pool/presentation";
import { useWalletEngineState } from "../rewards/useWalletEngineState";
import { PoolFomoStrip } from "./PoolFomoStrip";
import { formatEarnedWltPoints } from "./reward-points";
import { walletorRoutes } from "./routes";

const milestones = [
  { level: 1, swaps: 1, reward: "Base reward", icon: Flame, featured: true },
  {
    level: 2,
    swaps: 3,
    reward: "Active trader level",
    icon: Zap,
    featured: false,
  },
  {
    level: 3,
    swaps: 5,
    reward: "Pro trader level",
    icon: Sparkles,
    featured: false,
  },
  {
    level: 4,
    swaps: 10,
    reward: "Elite trader level",
    icon: CircleDollarSign,
    featured: false,
  },
] as const;

function levelForTier(tier: number): { number: number; name: string } {
  if (tier >= 10) return { number: 4, name: "Elite" };
  if (tier >= 5) return { number: 3, name: "Pro" };
  if (tier >= 3) return { number: 2, name: "Active" };
  if (tier >= 1) return { number: 1, name: "Starter" };
  return { number: 0, name: "Rookie" };
}

function formatPoints(value: string | undefined): string {
  return value === undefined ? "—" : BigInt(value).toLocaleString("en-US");
}

export function WalletorEnginePanel({
  variant = "panel",
}: {
  variant?: "panel" | "page";
}) {
  const navigate = useNavigate();
  const { connected, publicKey } = useWallet();
  const engine = useWalletEngineState(publicKey?.toBase58() ?? null);
  const eligibleSwaps = engine.data?.currentRound.eligibleSwaps ?? 0;
  const achievedTier = engine.data?.currentRound.achievedTier ?? 0;
  const nextTier = engine.data ? engine.data.currentRound.nextTier : 1;
  const level = levelForTier(achievedTier);
  const progress =
    nextTier === null ? 100 : Math.min(100, (eligibleSwaps / nextTier) * 100);
  const pointsPerSwap = engine.data?.pointsPerEligibleSwap ?? "2";
  const eligibleVolume = engine.data
    ? formatUsdCents(engine.data.currentRound.eligibleVolumeCents)
    : undefined;
  const wltToday = engine.data
    ? formatEarnedWltPoints(pointsPerSwap, eligibleSwaps)
    : undefined;
  const status = !connected
    ? "Connect wallet"
    : engine.isLoading
      ? "Syncing"
      : engine.isError
        ? "Unavailable"
        : engine.data?.currentRound.active
          ? "Active"
          : "Ready";

  const startSwapping = () => {
    const swap = document.getElementById("concept-swap");
    if (!swap) {
      void navigate(walletorRoutes.home);
      return;
    }
    swap.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <section
      id="concept-engine"
      className={`concept-engine concept-engine--${variant}`}
      aria-labelledby="concept-engine-title"
    >
      <header className="concept-engine-heading">
        <div>
          <span className="concept-engine-kicker">
            <ShieldCheck aria-hidden="true" /> Rewards progress
          </span>
          {variant === "page" ? (
            <h1 id="concept-engine-title">Walletor Rewards</h1>
          ) : (
            <h2 id="concept-engine-title">Walletor Engine</h2>
          )}
          <p>Build WLT progress in the current 24-hour Prize Pool round.</p>
        </div>
        <span className="concept-engine-status">
          <i aria-hidden="true" /> {status}
        </span>
      </header>

      <div className="concept-engine-level">
        <div className="concept-engine-level-copy">
          <span>
            <Flame aria-hidden="true" /> Level {level.number} — {level.name}
          </span>
          <strong>
            {connected ? eligibleSwaps : "—"} / {nextTier ?? eligibleSwaps}{" "}
            eligible swaps
          </strong>
        </div>
        <div
          className="concept-engine-progress"
          role="progressbar"
          aria-label="Progress to the next Walletor level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <span
            className="concept-engine-progress__fill"
            style={{ width: `${progress.toFixed(2)}%` }}
          >
            <i className="concept-engine-progress__beacon" aria-hidden="true">
              <b />
            </i>
          </span>
        </div>
      </div>

      <div className="concept-engine-metrics">
        <div>
          <small>Eligible swaps</small>
          <strong>{connected ? eligibleSwaps : "—"}</strong>
          <span>Current round</span>
        </div>
        <div
          className="concept-engine-wlt concept-engine-wlt--daily"
          aria-label="WLT points earned this round"
        >
          <small>WLT points this round</small>
          <strong>
            {connected ? (wltToday ?? "—") : "—"} <em>WLT</em>
          </strong>
          <span>+{formatPoints(pointsPerSwap)} WLT per qualified swap</span>
          <div
            className="concept-engine-wlt-lifetime"
            aria-label="Lifetime WLT points earned"
          >
            <small>Lifetime WLT points</small>
            <strong>
              {connected ? formatPoints(engine.data?.lifetimeWltPoints) : "—"}{" "}
              <em>WLT</em>
            </strong>
            <span>All-time verified total</span>
          </div>
        </div>
        <div
          className="concept-engine-draw-boost"
          aria-label="Eligible trading volume this round"
        >
          <small>Eligible volume</small>
          <strong>{connected ? (eligibleVolume ?? "—") : "—"}</strong>
          <span>Verified this round</span>
        </div>
      </div>

      <div className="concept-engine-ladder">
        <div className="concept-engine-ladder-heading">
          <span>
            Round rewards
            <small>Resets when the current round ends</small>
          </span>
          {variant === "page" ? <strong>Tier {level.number}</strong> : null}
        </div>
        <div className="concept-engine-milestones">
          {milestones.map((milestone) => {
            const Icon = milestone.icon;
            const unlocked = achievedTier >= milestone.swaps;
            const featured =
              connected && !unlocked && nextTier === milestone.swaps;
            const callToAction =
              featured || (!connected && milestone.swaps === 1);
            return (
              <div
                key={milestone.swaps}
                className={`${featured ? "is-featured" : ""} ${
                  unlocked ? "is-unlocked" : ""
                } ${callToAction ? "is-cta" : ""}`}
              >
                <span className="concept-engine-milestone-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span>
                  <strong>
                    {variant === "page" && milestone.swaps === 1
                      ? "Start your first swap"
                      : `${String(milestone.swaps)} ${
                          milestone.swaps === 1 ? "swap" : "swaps"
                        }`}
                  </strong>
                  <small>
                    {variant === "page" && milestone.swaps === 1
                      ? "Complete a swap to join today’s rewards"
                      : milestone.reward}
                  </small>
                </span>
                {featured || (!connected && milestone.featured) ? (
                  <button type="button" onClick={startSwapping}>
                    Level {milestone.level} ·{" "}
                    {eligibleSwaps > 0 ? "Keep swapping" : "Start swapping"}{" "}
                    <ArrowRight aria-hidden="true" />
                  </button>
                ) : unlocked ? (
                  <span className="concept-engine-unlocked">
                    Level {milestone.level}
                  </span>
                ) : (
                  <span className="concept-engine-locked">
                    Level {milestone.level} · Locked
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {variant === "page" ? <PoolFomoStrip /> : null}
    </section>
  );
}
