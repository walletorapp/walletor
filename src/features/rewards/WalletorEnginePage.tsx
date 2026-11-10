import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowRight,
  CircleDollarSign,
  Flame,
  Info,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  PrizePoolAmount,
  PrizePoolFundingNote,
} from "../prize-pool/DailyPrizePromotion";
import { formatUsdCents } from "../prize-pool/presentation";
import { usePrizePoolState } from "../prize-pool/usePrizePoolState";
import { useWalletEngineState } from "./useWalletEngineState";

const LADDER = [
  { swaps: 1, label: "Base reward", icon: Flame },
  { swaps: 3, label: "Active trader level", icon: Zap },
  { swaps: 5, label: "Pro trader level", icon: Sparkles },
  { swaps: 10, label: "Elite trader level", icon: CircleDollarSign },
] as const;

function points(value: string | undefined): string {
  if (value === undefined) return "—";
  return BigInt(value).toLocaleString("en-US");
}

function levelForTier(tier: number): { number: number; name: string } {
  if (tier >= 10) return { number: 4, name: "Elite" };
  if (tier >= 5) return { number: 3, name: "Pro" };
  if (tier >= 3) return { number: 2, name: "Active" };
  if (tier >= 1) return { number: 1, name: "Starter" };
  return { number: 0, name: "Rookie" };
}

function progressFor(swaps: number, nextTier: number | null): number {
  if (nextTier === null) return 100;
  return Math.min(100, Math.max(0, (swaps / nextTier) * 100));
}

export function WalletorEnginePage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const engine = useWalletEngineState(walletAddress);
  const pool = usePrizePoolState();
  const eligibleSwaps = engine.data?.currentRound.eligibleSwaps ?? 0;
  const achievedTier = engine.data?.currentRound.achievedTier ?? 0;
  const level = levelForTier(achievedTier);
  const nextTier =
    engine.data?.currentRound.nextTier ?? (engine.data ? null : 1);
  const pointsPerEligibleSwap = engine.data?.pointsPerEligibleSwap ?? "2";
  const minimumEligibleSwapUsd =
    engine.data?.eligibilityPolicy.minimumEligibleSwapUsd ?? "5.00";
  const progress = progressFor(eligibleSwaps, nextTier);
  const accountingLive = engine.data?.accountingStatus === "LIVE";
  const status = !connected
    ? "CONNECT WALLET"
    : engine.isLoading
      ? "SYNCING"
      : accountingLive
        ? engine.data?.currentRound.active === true
          ? "ACTIVE"
          : "READY"
        : "BETA SETUP";

  return (
    <section
      className={`engine-page${embedded ? " engine-page--embedded" : ""}`}
    >
      <header className="engine-heading">
        <span className="engine-kicker">
          <ShieldCheck aria-hidden="true" /> Rewards progress
        </span>
        <h1>Walletor Rewards</h1>
        <span
          className={`engine-status ${accountingLive ? "engine-status--live" : ""}`}
        >
          <i aria-hidden="true" /> {status}
        </span>
      </header>

      <section className="engine-level" aria-label="Current Walletor level">
        <div className="engine-level__label">
          <span>
            <Flame aria-hidden="true" /> Level {level.number} — {level.name}
          </span>
          <small>
            {nextTier === null ? (
              <>{eligibleSwaps} eligible swaps</>
            ) : (
              <>
                {eligibleSwaps} / {nextTier} eligible swaps
              </>
            )}
          </small>
        </div>
        <div
          className="engine-progress"
          role="progressbar"
          aria-label="Progress to the next streak level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <span style={{ width: `${progress.toFixed(2)}%` }} />
        </div>
      </section>

      <div className="engine-stats">
        <section>
          <span>Eligible swaps this round</span>
          <strong>{connected ? eligibleSwaps : "—"}</strong>
          <small>
            {connected
              ? engine.data?.currentRound.active
                ? "Active"
                : "Inactive"
              : "Connect wallet"}
          </small>
        </section>
        <section>
          <span>
            WLT Points
            <Info aria-label="Off-chain points for a future WLT airdrop allocation" />
          </span>
          <strong>
            {connected ? points(engine.data?.lifetimeWltPoints) : "—"}
          </strong>
          <small>Future WLT airdrop allocation</small>
        </section>
      </div>

      <section className="engine-ladder">
        <header>
          <div>
            <span>Round rewards</span>
            <small>Resets when the current round ends</small>
          </div>
          <strong>TIER {level.number}</strong>
        </header>
        <div className="engine-ladder__rows">
          {LADDER.map((tier) => {
            const unlocked = achievedTier >= tier.swaps;
            const next = nextTier === tier.swaps;
            const firstSwapCta = tier.swaps === 1 && eligibleSwaps === 0;
            const Icon = tier.icon;
            if (firstSwapCta) {
              return (
                <Link
                  key={tier.swaps}
                  className="engine-first-swap-cta"
                  to="/swap#swap-heading"
                  aria-label="Start your first swap"
                >
                  <span className="engine-first-swap-cta__milestone">
                    <span className="engine-first-swap-cta__icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span>
                      <strong>Start your first swap</strong>
                      <small>
                        Complete a ${minimumEligibleSwapUsd}+ swap to join
                        today’s rewards
                      </small>
                    </span>
                  </span>
                  <span className="engine-first-swap-cta__action">
                    Start swapping <ArrowRight aria-hidden="true" />
                  </span>
                </Link>
              );
            }
            return (
              <div
                key={tier.swaps}
                className={`${unlocked ? "is-unlocked" : ""} ${next ? "is-next" : ""}`}
              >
                <span>
                  <Icon aria-hidden="true" /> {tier.swaps}{" "}
                  {tier.swaps === 1 ? "swap" : "swaps"}
                </span>
                <strong>{tier.label}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <div className="engine-points-rule">
        <ShieldCheck aria-hidden="true" />
        <p>
          <strong>
            Earn {points(pointsPerEligibleSwap)} WLT Points per eligible swap.
          </strong>
          The swap must be valued at ${minimumEligibleSwapUsd} or more and pass
          Jupiter confirmation and backend verification. Smaller swaps can
          execute but do not qualify. Points are off-chain and lifetime-based.
          Tiers unlock by eligible-swap count. The two highest verified fee
          contributors receive 20% and 10% of the pool. Twenty additional
          wallets are selected with capped, contribution-weighted odds and share
          the remaining 70%.
        </p>
      </div>

      {accountingLive ? (
        <Link className="engine-cta" to="/swap">
          <Zap aria-hidden="true" />
          {eligibleSwaps > 0 ? "Keep Swapping" : "Swap to Start Earning"}
        </Link>
      ) : connected ? (
        <div className="engine-cta engine-cta--disabled" aria-disabled="true">
          <LockKeyhole aria-hidden="true" /> WLT Points launch pending
        </div>
      ) : null}

      <section className="engine-pool" aria-label="Prize Pool summary">
        <header className="engine-pool__header">
          <CircleDollarSign aria-hidden="true" />
          <strong>Prize Pool</strong>
        </header>
        <dl className="engine-pool__metrics">
          <div>
            <dt>Current Prize Pool</dt>
            <dd>
              {pool.data ? (
                <PrizePoolAmount state={pool.data} />
              ) : pool.isError ? (
                "Unavailable"
              ) : (
                "Loading…"
              )}
            </dd>
          </div>
          <div>
            <dt>Total Paid Out</dt>
            <dd>
              {pool.data
                ? formatUsdCents(pool.data.totalDistributedCents)
                : pool.isError
                  ? "Unavailable"
                  : "Loading…"}
            </dd>
          </div>
        </dl>
        <PrizePoolFundingNote state={pool.data} />
      </section>
    </section>
  );
}
