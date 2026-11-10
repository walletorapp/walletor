import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import { DailyPrizePromotion } from "../prize-pool/DailyPrizePromotion";
import { roundClock } from "../prize-pool/presentation";
import { usePrizePoolState } from "../prize-pool/usePrizePoolState";

export function PoolFomoStrip() {
  const pool = usePrizePoolState();
  const [clock, setClock] = useState(() => Date.now());
  const state = pool.data;
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
  const countdownLabel = countdown
    ? `${countdown.hours}:${countdown.minutes}:${countdown.seconds}`
    : "--:--:--";

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <section
      className="concept-pool-fomo-strip"
      aria-label="Current Prize Pool round and time remaining"
    >
      <article className="concept-pool-fomo-card concept-pool-fomo-card--pool">
        <div className="concept-pool-fomo-heading">
          <span className="concept-pool-fomo-signal" aria-hidden="true" />
          <span>Prize Pool</span>
          <small>Open now</small>
        </div>
        <DailyPrizePromotion state={state} isError={pool.isError} />
        <p>One eligible swap activates your entry for this 24-hour round.</p>
      </article>

      <article className="concept-pool-fomo-card concept-pool-fomo-card--timer">
        <div className="concept-pool-fomo-heading">
          <Clock3 aria-hidden="true" />
          <span>Round closes in</span>
          <small>This round</small>
        </div>
        <strong className="concept-pool-fomo-time">{countdownLabel}</strong>
        <p>Qualify before the countdown reaches zero.</p>
      </article>
    </section>
  );
}
