export function formatUsdCents(cents: string): string {
  const amount = BigInt(cents);
  const dollars = amount / 100n;
  const remainder = (amount % 100n).toString().padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${remainder}`;
}

export function formatUsdMicroUsd(microUsd: string): string {
  const amount = BigInt(microUsd);
  const dollars = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0");
  const exactFraction = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${exactFraction}`;
}

export function formatUsdMicroUsdCents(microUsd: string): string {
  const amount = BigInt(microUsd);
  const roundedCents = (amount + 5_000n) / 10_000n;
  return formatUsdCents(roundedCents.toString());
}

export function formatParticipantCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

export interface RoundClock {
  hours: string;
  minutes: string;
  seconds: string;
  progressPercent: number;
}

export function roundClock(
  startTime: string,
  endTime: string,
  adjustedNowMs: number,
): RoundClock {
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  const durationMs = Math.max(1, endMs - startMs);
  const remainingSeconds = Math.max(
    0,
    Math.floor((endMs - adjustedNowMs) / 1_000),
  );
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const elapsedMs = Math.min(durationMs, Math.max(0, adjustedNowMs - startMs));

  return {
    hours: hours.toString().padStart(2, "0"),
    minutes: minutes.toString().padStart(2, "0"),
    seconds: seconds.toString().padStart(2, "0"),
    progressPercent: Math.min(100, Math.max(0, (elapsedMs / durationMs) * 100)),
  };
}
