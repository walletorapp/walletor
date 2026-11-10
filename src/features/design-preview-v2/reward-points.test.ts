import { describe, expect, it } from "vitest";

import { formatEarnedWltPoints } from "./reward-points";

describe("formatEarnedWltPoints", () => {
  it.each([
    { swaps: 1, expected: "2" },
    { swaps: 2, expected: "4" },
    { swaps: 3, expected: "6" },
    { swaps: 10, expected: "20" },
    { swaps: 25, expected: "50" },
  ])(
    "credits two cumulative WLT points across $swaps swaps",
    ({ swaps, expected }) => {
      expect(formatEarnedWltPoints("2", swaps)).toBe(expected);
    },
  );

  it("keeps large cumulative point totals exact", () => {
    expect(formatEarnedWltPoints("9007199254740993", 10)).toBe(
      "90,071,992,547,409,930",
    );
  });

  it.each([
    ["-1", 1],
    ["2.5", 1],
    ["2", -1],
    ["2", 1.5],
  ] as const)("rejects invalid inputs", (pointsPerSwap, swaps) => {
    expect(() => formatEarnedWltPoints(pointsPerSwap, swaps)).toThrow(
      "WLT reward inputs must be nonnegative integers.",
    );
  });
});
