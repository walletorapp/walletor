import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowRight,
  Check,
  CircleDashed,
  Clock3,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useWalletEngineState } from "../rewards/useWalletEngineState";
import { usePrizePoolState } from "../prize-pool/usePrizePoolState";
import { ConceptPageShell } from "./ConceptPageShell";
import { SocialRewardsPanel } from "../referrals/SocialRewardsPanel";
import "./airdrop-page.css";

export function WalletorAirdropPage() {
  const reduceMotion = useReducedMotion();
  const { connected, publicKey } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const engine = useWalletEngineState(publicKey?.toBase58() ?? null);
  const pool = usePrizePoolState();
  const [clock, setClock] = useState(() => Date.now());
  const state = engine.data;
  const eligibleSwaps = state?.currentRound.eligibleSwaps ?? 0;
  const qualifiedToday =
    eligibleSwaps > 0 && state?.currentRound.active === true;
  const pointsPerSwap = state?.pointsPerEligibleSwap ?? "2";
  const pointsToday = (
    BigInt(pointsPerSwap) * BigInt(eligibleSwaps)
  ).toLocaleString("en-US");
  const clockState = state ?? pool.data;
  const clockUpdatedAt = state ? engine.dataUpdatedAt : pool.dataUpdatedAt;
  const serverOffset = clockState
    ? Date.parse(clockState.serverTime) - clockUpdatedAt
    : 0;
  const countdownLabel = clockState
    ? roundResetCountdown(
        clock + serverOffset,
        Date.parse(clockState.activeRound.endTime),
      )
    : "--:--:--";

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const status = qualifiedToday
    ? {
        icon: Check,
        title: "Verified for this round",
        detail: `${eligibleSwaps.toLocaleString("en-US")} confirmed swap${eligibleSwaps === 1 ? "" : "s"}`,
      }
    : connected && engine.isLoading
      ? {
          icon: CircleDashed,
          title: "Checking your activity",
          detail: "Syncing verified swaps",
        }
      : {
          icon: connected ? Zap : LockKeyhole,
          title: connected ? "One swap left" : "Connect to start",
          detail: connected
            ? "Complete a qualified swap"
            : "Use a Solana wallet",
        };
  const StatusIcon = status.icon;

  return (
    <ConceptPageShell
      className="walletor-airdrop-page"
      mainClassName="walletor-airdrop-main"
    >
      <section className="airdrop-simple" aria-labelledby="airdrop-title">
        <motion.div
          className="airdrop-simple-copy"
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <span className="airdrop-live-pill">
            <span aria-hidden="true" /> AIRDROP · LIVE
          </span>
          <h1 id="airdrop-title">
            One swap. <em>Every day.</em>
          </h1>
          <p>
            Make one verified Solana swap of $5 or more this round and earn +
            {pointsPerSwap} WLT points.
          </p>
          {!connected ? (
            <button
              type="button"
              className="airdrop-main-action"
              onClick={() => {
                setWalletModalVisible(true);
              }}
            >
              <WalletCards aria-hidden="true" /> Connect wallet
              <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <Link
              className={`airdrop-main-action ${qualifiedToday ? "is-complete" : ""}`}
              to="/"
            >
              {qualifiedToday ? (
                <Check aria-hidden="true" />
              ) : (
                <Zap aria-hidden="true" />
              )}
              {qualifiedToday
                ? "Round goal complete"
                : "Make a qualifying swap"}
              <ArrowRight aria-hidden="true" />
            </Link>
          )}
        </motion.div>

        <motion.div
          className={`airdrop-status-card ${qualifiedToday ? "is-complete" : ""}`}
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
        >
          <div className="airdrop-status-topline">
            <span>THIS ROUND</span>
            <strong>{qualifiedToday ? "COMPLETE" : "1 SWAP"}</strong>
          </div>
          <div className="airdrop-status-main">
            <span className="airdrop-status-symbol">
              <StatusIcon aria-hidden="true" />
            </span>
            <div>
              <h2>{status.title}</h2>
              <p>{status.detail}</p>
            </div>
          </div>
          <div className="airdrop-status-footer" role="timer" aria-live="off">
            <span>
              <Clock3 aria-hidden="true" /> Resets in
            </span>
            <strong>{countdownLabel}</strong>
          </div>
        </motion.div>
      </section>

      <section className="airdrop-simple-facts" aria-label="Airdrop details">
        <article>
          <Zap aria-hidden="true" />
          <span>Round goal</span>
          <strong>1 swap</strong>
        </article>
        <article>
          <Sparkles aria-hidden="true" />
          <span>Reward</span>
          <strong>+{pointsPerSwap} WLT</strong>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <span>Your points this round</span>
          <strong>{connected ? pointsToday : "—"}</strong>
        </article>
      </section>

      <section className="airdrop-simple-steps" aria-label="How it works">
        <span>1</span>
        <strong>Connect</strong>
        <i aria-hidden="true" />
        <span>2</span>
        <strong>Swap</strong>
        <i aria-hidden="true" />
        <span>3</span>
        <strong>Earn points</strong>
      </section>

      <SocialRewardsPanel />
      <p className="airdrop-simple-notice">
        WLT points record participation and do not guarantee a token or monetary
        value. <a href="https://docs.walletor.com">Learn more</a>
      </p>
    </ConceptPageShell>
  );
}

function roundResetCountdown(nowMs: number, nextResetMs: number): string {
  const remainingSeconds = Math.max(
    0,
    Math.floor((nextResetMs - nowMs) / 1_000),
  );
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}
