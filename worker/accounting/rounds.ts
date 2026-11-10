const HOUR_MS = 60 * 60 * 1_000;

export function rollingDailyRoundWindow(start: Date): RoundWindow {
  const startTime = start.toISOString();
  return {
    roundId: `solana:mainnet:prize-pool:rolling:${startTime}`,
    startTime,
    endTime: new Date(start.getTime() + 24 * HOUR_MS).toISOString(),
  };
}

export interface RoundWindow {
  roundId: string;
  startTime: string;
  endTime: string;
}

export function canaryContinuationRoundWindow(
  active: RoundWindow,
  closedAt: Date,
): RoundWindow {
  const closedAtMs = closedAt.getTime();
  const startMs = Date.parse(active.startTime);
  const endMs = Date.parse(active.endTime);
  if (
    !Number.isFinite(closedAtMs) ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    closedAtMs <= startMs ||
    closedAtMs >= endMs
  ) {
    throw new Error(
      "A test round can close only inside its active UTC window.",
    );
  }
  const startTime = closedAt.toISOString();
  return {
    roundId: `${active.roundId}:continuation:${startTime}`,
    startTime,
    endTime: active.endTime,
  };
}

function roundDurationMs(roundDurationHours: number): number {
  if (
    !Number.isInteger(roundDurationHours) ||
    roundDurationHours < 1 ||
    roundDurationHours > 24 ||
    24 % roundDurationHours !== 0
  ) {
    throw new Error(
      "Round duration must be a whole-hour divisor of the UTC day.",
    );
  }
  return roundDurationHours * HOUR_MS;
}

export function closedPrizeDrawReferenceTime(
  scheduledTime: Date,
  roundDurationHours = 24,
): Date {
  if (!Number.isFinite(scheduledTime.getTime())) {
    throw new Error("Prize Draw Workflow received an invalid timestamp.");
  }
  const durationMs = roundDurationMs(roundDurationHours);
  return new Date(
    Math.floor(scheduledTime.getTime() / durationMs) * durationMs - 1,
  );
}

export function utcRoundWindow(
  timestamp: Date,
  poolId = "solana:mainnet:prize-pool",
  roundDurationHours = 24,
): RoundWindow {
  const time = timestamp.getTime();
  if (!Number.isFinite(time)) throw new Error("Round timestamp is invalid.");
  const durationMs = roundDurationMs(roundDurationHours);
  const startMs = Math.floor(time / durationMs) * durationMs;
  const startTime = new Date(startMs).toISOString();
  return {
    roundId: `${poolId}:${startTime}`,
    startTime,
    endTime: new Date(startMs + durationMs).toISOString(),
  };
}

export function nextRoundWindow(
  previousEnd: Date,
  poolId: string,
  roundDurationHours: number,
): RoundWindow {
  const window = utcRoundWindow(previousEnd, poolId, roundDurationHours);
  const startTime = previousEnd.toISOString();
  // A cadence change can land inside the new window. Never reuse an older
  // closed round's ID or overlap its participants and financial records.
  return { ...window, startTime, roundId: `${poolId}:${startTime}` };
}

export function roundCloseBoundaryAtOrAfter(
  timestamp: Date,
  roundDurationHours = 24,
): string {
  const time = timestamp.getTime();
  if (!Number.isFinite(time)) throw new Error("Round timestamp is invalid.");
  return utcRoundWindow(new Date(time - 1), undefined, roundDurationHours)
    .endTime;
}

export function alignedOpenRoundEnd(
  startTime: string,
  endTime: string,
  eventTime: string,
  roundDurationHours: number,
): string {
  const time = Date.parse(eventTime);
  // Delayed transaction verification is not a clock change for today's round.
  if (time <= Date.parse(startTime) || time >= Date.parse(endTime)) {
    return endTime;
  }
  return utcRoundWindow(new Date(time), undefined, roundDurationHours).endTime;
}

export function roundProgressBps(
  serverAdjustedTimeMs: number,
  startTime: string,
  endTime: string,
): number {
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Round timestamps are invalid.");
  }
  const elapsed = Math.min(
    Math.max(serverAdjustedTimeMs - start, 0),
    end - start,
  );
  return Math.floor((elapsed * 10_000) / (end - start));
}
