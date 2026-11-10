import { Clock3 } from "lucide-react";
import {
  PrizePoolAmount,
  PrizePoolFundingNote,
} from "../prize-pool/DailyPrizePromotion";
import { roundClock } from "../prize-pool/presentation";
import { usePrizePoolState } from "../prize-pool/usePrizePoolState";

export function LaunchPrizePoolBar({ now }: { now: number }) {
  const pool = usePrizePoolState();
  const state = pool.isError ? undefined : pool.data;
  const countdown = state
    ? roundClock(
        state.activeRound.startTime,
        state.activeRound.endTime,
        now + Date.parse(state.serverTime) - pool.dataUpdatedAt,
      )
    : null;
  const timeLeft = countdown
    ? `${countdown.hours}:${countdown.minutes}:${countdown.seconds}`
    : "--:--:--";

  return (
    <section
      className="launch-prize-bar"
      aria-label="Live prize pool and countdown"
    >
      <div className="launch-prize-bar-amount">
        <span className="launch-prize-bar-label">
          <i aria-hidden="true" />
          Prize Pool
        </span>
        <strong>
          <PrizePoolAmount state={state} isError={pool.isError} />
        </strong>
        <PrizePoolFundingNote state={state} />
      </div>
      <div className="launch-prize-bar-countdown">
        <span className="launch-prize-bar-label">
          <Clock3 size={11} aria-hidden="true" />
          Time left
        </span>
        <strong
          role="timer"
          aria-live="off"
          aria-label={`Round closes in ${timeLeft}`}
        >
          {timeLeft}
        </strong>
      </div>
      {countdown && (
        <div className="launch-prize-bar-progress" aria-hidden="true">
          <span style={{ width: `${String(countdown.progressPercent)}%` }} />
        </div>
      )}
    </section>
  );
}
