import { absoluteDifference } from "./math";

export interface ReconciliationResult {
  expectedBalanceCents: bigint;
  actualBalanceCents: bigint;
  differenceCents: bigint;
  mismatch: boolean;
  pauseDistributions: boolean;
}

export function reconcilePoolBalance(
  expectedBalanceCents: bigint,
  actualBalanceCents: bigint,
  pauseThresholdCents: bigint,
): ReconciliationResult {
  if (
    expectedBalanceCents < 0n ||
    actualBalanceCents < 0n ||
    pauseThresholdCents < 0n
  ) {
    throw new Error("Reconciliation balances cannot be negative.");
  }
  const differenceCents = absoluteDifference(
    expectedBalanceCents,
    actualBalanceCents,
  );
  return {
    expectedBalanceCents,
    actualBalanceCents,
    differenceCents,
    mismatch: differenceCents > 0n,
    pauseDistributions: differenceCents > pauseThresholdCents,
  };
}
