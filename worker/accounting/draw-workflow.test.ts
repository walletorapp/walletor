import { describe, expect, it } from "vitest";

import { closedPrizeDrawReferenceTime } from "./rounds";

describe("Prize Draw Workflow round selection", () => {
  it("selects the round that closed at midnight when cron delivery is delayed", () => {
    expect(
      closedPrizeDrawReferenceTime(
        new Date("2026-09-05T00:00:53.412Z"),
      ).toISOString(),
    ).toBe("2026-09-04T23:59:59.999Z");
  });

  it("selects the previous round for an exact midnight delivery", () => {
    expect(
      closedPrizeDrawReferenceTime(
        new Date("2026-09-05T00:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-09-04T23:59:59.999Z");
  });

  it("selects the hourly round immediately before an hourly trigger", () => {
    expect(
      closedPrizeDrawReferenceTime(
        new Date("2026-09-07T15:00:12.000Z"),
        1,
      ).toISOString(),
    ).toBe("2026-09-07T14:59:59.999Z");
  });

  it("rejects invalid timestamps", () => {
    expect(() => closedPrizeDrawReferenceTime(new Date("invalid"))).toThrow(
      "invalid timestamp",
    );
  });
});
