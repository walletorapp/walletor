import { describe, expect, it } from "vitest";

import {
  rewardReconciliationRetry,
  rewardSyncCountdownSeconds,
} from "./reward-reconciliation";

describe("reward reconciliation timing", () => {
  it("checks finalized evidence frequently immediately after confirmation", () => {
    const retries = Array.from({ length: 8 }, (_, index) =>
      rewardReconciliationRetry(index + 1),
    );

    expect(retries.map((retry) => retry.delayMs)).toEqual([
      250, 400, 600, 800, 1_000, 1_200, 1_500, 2_000,
    ]);
    expect(retries.every((retry) => retry.status === "SYNCING")).toBe(true);
    expect(
      retries.slice(0, 5).reduce((total, retry) => total + retry.delayMs, 0),
    ).toBe(3_050);
  });

  it("backs off after the rapid finalization window", () => {
    expect(rewardReconciliationRetry(9)).toEqual({
      delayMs: 5_000,
      status: "DELAYED",
    });
  });

  it("counts down the visible reward-sync window from seven seconds", () => {
    const startedAt = 1_000_000;

    expect(rewardSyncCountdownSeconds(startedAt, startedAt)).toBe(7);
    expect(rewardSyncCountdownSeconds(startedAt, startedAt + 1_000)).toBe(6);
    expect(rewardSyncCountdownSeconds(startedAt, startedAt + 6_001)).toBe(1);
    expect(rewardSyncCountdownSeconds(startedAt, startedAt + 7_000)).toBe(0);
    expect(rewardSyncCountdownSeconds(startedAt, startedAt + 30_000)).toBe(0);
  });
});
