import { describe, expect, it } from "vitest";

import {
  formatUsdCents,
  formatUsdMicroUsd,
  formatUsdMicroUsdCents,
  roundClock,
} from "./presentation";

describe("Prize Pool presentation", () => {
  it("formats integer cents without floating point", () => {
    expect(formatUsdCents("0")).toBe("$0.00");
    expect(formatUsdCents("120000200")).toBe("$1,200,002.00");
  });

  it("preserves exact sub-cent pool estimates without floating point", () => {
    expect(formatUsdMicroUsd("0")).toBe("$0.00");
    expect(formatUsdMicroUsd("3966")).toBe("$0.003966");
    expect(formatUsdMicroUsd("15000")).toBe("$0.015");
    expect(formatUsdMicroUsd("1200002000000")).toBe("$1,200,002.00");
  });

  it("rounds micro USD estimates to cents without floating point", () => {
    expect(formatUsdMicroUsdCents("3966")).toBe("$0.00");
    expect(formatUsdMicroUsdCents("6009")).toBe("$0.01");
    expect(formatUsdMicroUsdCents("15000")).toBe("$0.02");
  });

  it("uses one UTC window for countdown and progress", () => {
    const clock = roundClock(
      "2026-07-31T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      Date.parse("2026-07-31T06:00:00.000Z"),
    );
    expect(clock).toEqual({
      hours: "18",
      minutes: "00",
      seconds: "00",
      progressPercent: 25,
    });
  });

  it("clamps expired rounds at zero remaining and full progress", () => {
    const clock = roundClock(
      "2026-07-31T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      Date.parse("2026-08-02T00:00:00.000Z"),
    );
    expect(clock.hours).toBe("00");
    expect(clock.minutes).toBe("00");
    expect(clock.seconds).toBe("00");
    expect(clock.progressPercent).toBe(100);
  });
});
