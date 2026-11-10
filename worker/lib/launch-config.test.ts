// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ApiFailure } from "./http";
import { readAccountingEpoch, readPublicLaunchAt } from "./launch-config";

describe("public launch configuration", () => {
  it("uses a separate production accounting epoch", () => {
    expect(
      readAccountingEpoch({ WALLETOR_ACCOUNTING_EPOCH: "public-launch-v1" }),
    ).toBe("public-launch-v1");
  });

  it("keeps legacy behavior when an epoch has not been configured", () => {
    expect(readAccountingEpoch({})).toBe("prelaunch");
  });

  it("requires an exact UTC launch timestamp", () => {
    expect(
      readPublicLaunchAt({
        WALLETOR_PUBLIC_LAUNCH_AT: "2026-09-06T14:10:16.000Z",
      }),
    ).toBe("2026-09-06T14:10:16.000Z");
    expect(() =>
      readPublicLaunchAt({ WALLETOR_PUBLIC_LAUNCH_AT: "September 6" }),
    ).toThrow(ApiFailure);
  });
});
