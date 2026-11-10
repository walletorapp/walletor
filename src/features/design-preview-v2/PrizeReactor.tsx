import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowRight, ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { HowItWorksButton } from "../../components/HowItWorksButton";
import { DailyPrizePromotion } from "../prize-pool/DailyPrizePromotion";
import { roundClock } from "../prize-pool/presentation";
import { usePrizePoolState } from "../prize-pool/usePrizePoolState";
import { useSolanaClaimState } from "../prize-pool/useSolanaClaimState";
import { useWalletEngineState } from "../rewards/useWalletEngineState";
import { formatEarnedWltPoints } from "./reward-points";
import { walletorRoutes } from "./routes";

interface OrbitSpec {
  start: number;
  radiusX: number;
  radiusY: number;
  width: number;
  duration: number;
  opacity: number;
}

const orbitSpecs: OrbitSpec[] = [
  {
    start: 0,
    radiusX: 122,
    radiusY: 48,
    width: 70,
    duration: 12,
    opacity: 0.78,
  },
  {
    start: 120,
    radiusX: 122,
    radiusY: 48,
    width: 64,
    duration: 12,
    opacity: 0.6,
  },
  {
    start: 240,
    radiusX: 122,
    radiusY: 48,
    width: 66,
    duration: 12,
    opacity: 0.7,
  },
  {
    start: 45,
    radiusX: 91,
    radiusY: 78,
    width: 58,
    duration: 15,
    opacity: 0.52,
  },
  {
    start: 225,
    radiusX: 91,
    radiusY: 78,
    width: 58,
    duration: 15,
    opacity: 0.48,
  },
];

function buildOrbit(spec: OrbitSpec) {
  const frames = Array.from({ length: 25 }, (_, index) => {
    const angle = spec.start + (index / 24) * 360;
    const radians = (angle * Math.PI) / 180;
    return {
      x: Math.cos(radians) * spec.radiusX,
      y: Math.sin(radians) * spec.radiusY,
      rotate: angle + 90,
      scale: 0.84 + ((Math.sin(radians) + 1) / 2) * 0.22,
    };
  });

  return {
    x: frames.map((frame) => frame.x),
    y: frames.map((frame) => frame.y),
    rotate: frames.map((frame) => frame.rotate),
    scale: frames.map((frame) => frame.scale),
  };
}

export function PrizeReactor() {
  const reduceMotion = useReducedMotion();
  const navigate = useNavigate();
  const { connected, publicKey } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const pool = usePrizePoolState();
  const engine = useWalletEngineState(publicKey?.toBase58() ?? null);
  const claims = useSolanaClaimState(publicKey?.toBase58() ?? null);
  const [clock, setClock] = useState(() => Date.now());
  const state = pool.data;
  const eligibleSwaps = engine.data?.currentRound.eligibleSwaps ?? 0;
  const qualified =
    engine.data?.currentRound.active === true && eligibleSwaps >= 1;
  const pointsPerSwap = engine.data?.pointsPerEligibleSwap ?? "2";
  const wltToday = formatEarnedWltPoints(pointsPerSwap, eligibleSwaps);
  const swapsUntilNextTier = engine.data?.currentRound.swapsUntilNextTier ?? 0;
  const maxBoostActive = engine.data?.currentRound.nextTier === null;
  const serverClockOffsetMs = state
    ? Date.parse(state.serverTime) - pool.dataUpdatedAt
    : 0;
  const countdown = state
    ? roundClock(
        state.activeRound.startTime,
        state.activeRound.endTime,
        clock + serverClockOffsetMs,
      )
    : null;
  const progress = Math.round(countdown?.progressPercent ?? 0);
  const countdownUnits = [
    { label: "Hours", value: countdown?.hours ?? "--" },
    { label: "Minutes", value: countdown?.minutes ?? "--" },
    { label: "Seconds", value: countdown?.seconds ?? "--" },
  ];
  const claimableUsdcAtomic =
    claims.data?.entitlements.reduce(
      (total, entitlement) =>
        entitlement.status === "CLAIMABLE"
          ? total + BigInt(entitlement.remainingAmountAtomic)
          : total,
      0n,
    ) ?? 0n;
  const hasClaimedCurrentRound =
    claims.data?.entitlements.some(
      (entitlement) =>
        entitlement.status === "CLAIMED" &&
        entitlement.roundId === state?.activeRound.roundId,
    ) ?? false;

  const scrollToSwap = () => {
    document
      .querySelector("#concept-swap")
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      <section
        className="concept-mobile-pool-snapshot"
        aria-label="Prize Pool and time remaining"
      >
        <div className="concept-mobile-pool-card concept-mobile-pool-card--amount">
          <span className="concept-mobile-pool-label">
            <span className="concept-mobile-pool-signal" aria-hidden="true" />
            Prize Pool
          </span>
          <DailyPrizePromotion state={state} isError={pool.isError} />
        </div>

        <div className="concept-mobile-pool-card concept-mobile-pool-card--time">
          <span className="concept-mobile-pool-label">Time left</span>
          <strong>
            {countdown
              ? `${countdown.hours}:${countdown.minutes}:${countdown.seconds}`
              : "--:--:--"}
          </strong>
          <small>Until distribution</small>
        </div>
      </section>

      <section
        id="concept-pool"
        className="concept-reactor"
        aria-labelledby="concept-reactor-title"
      >
        <div className="concept-reactor-heading">
          <div>
            <span className="concept-eyebrow">Daily prize pool</span>
            <h2 id="concept-reactor-title">You could win USDC.</h2>
          </div>
          <span className="concept-round-chip">
            {state ? `Round ${state.activeRound.roundId.slice(-3)}` : "Syncing"}
          </span>
        </div>

        <ol className="concept-prize-path" aria-label="How to enter and win">
          {["SWAP", "Get verified", "Chance to win"].map((step, index) => (
            <li key={step}>
              <motion.span
                aria-hidden="true"
                animate={reduceMotion ? undefined : { scale: [1, 1.15, 1] }}
                transition={{ duration: 0.6, delay: index * 0.65 }}
              >
                {index + 1}
              </motion.span>
              {step}
            </li>
          ))}
        </ol>

        <div className="concept-reactor-stage">
          <div className="concept-reactor-grid" />
          <motion.div
            className="concept-reactor-halo"
            animate={
              reduceMotion
                ? undefined
                : { scale: [0.94, 1.05, 0.94], opacity: [0.35, 0.7, 0.35] }
            }
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="concept-reactor-ring concept-reactor-ring-a" />
          <div className="concept-reactor-ring concept-reactor-ring-b" />

          {orbitSpecs.map((spec, index) => {
            const orbit = buildOrbit(spec);
            return (
              <motion.img
                key={`${String(spec.start)}-${String(spec.radiusX)}`}
                data-testid={
                  index === 0 ? "concept-two-cash-motion" : undefined
                }
                src="/assets/walletor-cash-bill-v3.png"
                alt=""
                className="concept-orbiting-note"
                style={{ width: spec.width, opacity: spec.opacity }}
                animate={reduceMotion ? undefined : orbit}
                transition={{
                  duration: spec.duration,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            );
          })}

          <div className="concept-reactor-core">
            <div className="concept-core-label">
              <span className="concept-signal" />
              Prize Pool
            </div>
            <DailyPrizePromotion state={state} isError={pool.isError} />
          </div>
        </div>

        <div className="concept-prize-entry">
          {qualified ? (
            <p>
              <Check aria-hidden="true" /> You’re entered in this round
            </p>
          ) : null}
          <small>
            Winners selected every 24 hours. Winning is not guaranteed.
          </small>
        </div>

        <div
          className="concept-countdown"
          aria-label="Time until next distribution"
        >
          <span className="concept-countdown-title">Next distribution</span>
          <div className="concept-countdown-units">
            {countdownUnits.map((unit, index) => (
              <div className="concept-countdown-unit-wrap" key={unit.label}>
                {index > 0 ? (
                  <span
                    className="concept-countdown-separator"
                    aria-hidden="true"
                  >
                    :
                  </span>
                ) : null}
                <div className="concept-countdown-unit">
                  <strong>{unit.value}</strong>
                  <span>{unit.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="concept-progress">
          <div className="concept-progress-heading">
            <span className="concept-progress-copy">
              <strong>Round progress</strong>
              <small>Until next distribution</small>
            </span>
            <strong className="concept-progress-value">{progress}%</strong>
          </div>
          <div
            className="concept-progress-track"
            role="progressbar"
            aria-label="Daily Prize Pool round progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <motion.span
              className="concept-progress-fill"
              initial={reduceMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: progress / 100 }}
              transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        <button
          type="button"
          className="concept-claim"
          onClick={() => {
            if (!connected) {
              setWalletModalVisible(true);
              return;
            }
            void navigate(walletorRoutes.claim);
          }}
        >
          <span>
            <ShieldCheck className="size-4" aria-hidden="true" />
            Claim Prize Pool Airdrop
          </span>
          {hasClaimedCurrentRound && claimableUsdcAtomic === 0n ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <ArrowUpRight className="size-4" aria-hidden="true" />
          )}
        </button>

        <HowItWorksButton className="concept-how" />
      </section>

      {qualified ? (
        <aside
          className="concept-metrics concept-reward-steps is-qualified"
          aria-label="Verified Walletor rewards activity"
          aria-live="polite"
        >
          <motion.div
            className="concept-game-card concept-game-card--entry"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36 }}
          >
            <span
              className="concept-game-card-icon concept-game-card-step"
              aria-hidden="true"
            >
              1
            </span>
            <span className="concept-game-card-copy">
              <small>Entry unlocked</small>
              <strong>Congrats, you&apos;re in!</strong>
              <span>Your entry for this round is active.</span>
            </span>
            <span className="concept-game-card-status">
              <Check aria-hidden="true" />
              Verified
            </span>
          </motion.div>
          <motion.div
            className="concept-game-card concept-game-card--wlt"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: reduceMotion ? 0 : 0.08 }}
          >
            <span
              className="concept-game-card-icon concept-game-card-step"
              aria-hidden="true"
            >
              2
            </span>
            <span className="concept-game-card-copy">
              <motion.strong
                className="concept-wlt-earned"
                animate={
                  reduceMotion
                    ? undefined
                    : {
                        y: [0, -7, 0, -3, 0],
                        scale: [1, 1.04, 1, 1.02, 1],
                      }
                }
                transition={
                  reduceMotion
                    ? undefined
                    : {
                        duration: 0.9,
                        ease: "easeOut",
                        repeat: Infinity,
                        repeatDelay: 1.2,
                      }
                }
              >
                You earned (+{wltToday} WLT)
              </motion.strong>
              <span>
                {eligibleSwaps.toLocaleString("en-US")} confirmed{" "}
                {eligibleSwaps === 1 ? "swap" : "swaps"} × +
                {BigInt(pointsPerSwap).toLocaleString("en-US")} WLT each.
              </span>
            </span>
            <span className="concept-game-card-status">
              <Check aria-hidden="true" />
              Verified
            </span>
          </motion.div>
          <motion.button
            type="button"
            className="concept-game-card concept-game-card--cta"
            aria-label="Swap again to increase your reward boost"
            onClick={scrollToSwap}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={reduceMotion ? undefined : { y: -2 }}
            whileTap={reduceMotion ? undefined : { scale: 0.985 }}
            transition={{ duration: 0.36, delay: reduceMotion ? 0 : 0.16 }}
          >
            <span
              className="concept-game-card-icon concept-game-card-step"
              aria-hidden="true"
            >
              3
            </span>
            <span className="concept-game-card-copy">
              <small>{maxBoostActive ? "Top tier active" : "Next boost"}</small>
              <strong>
                {maxBoostActive ? "+50% boost active" : "Swap again"}
              </strong>
              <span>
                {maxBoostActive
                  ? "Top reward tier unlocked."
                  : `${String(swapsUntilNextTier)} ${swapsUntilNextTier === 1 ? "swap" : "swaps"} to your next boost.`}
              </span>
            </span>
            <motion.span
              className="concept-game-card-arrow"
              aria-hidden="true"
              animate={reduceMotion ? undefined : { x: [0, 4, 0] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <ArrowRight />
            </motion.span>
            <span className="concept-game-card-status">
              <Check aria-hidden="true" />
              Verified
            </span>
          </motion.button>
        </aside>
      ) : null}
    </>
  );
}
