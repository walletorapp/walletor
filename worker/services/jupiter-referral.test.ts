import { describe, expect, it } from "vitest";

import { ApiFailure } from "../lib/http";
import { getJupiterReferralConfig } from "./jupiter-referral";

const referralAccount = "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ";

describe("Jupiter referral configuration", () => {
  it("remains disabled unless explicitly enabled", () => {
    expect(
      getJupiterReferralConfig({
        JUPITER_REFERRAL_FEE_ENABLED: "false",
        JUPITER_REFERRAL_ACCOUNT: referralAccount,
        JUPITER_REFERRAL_FEE_BPS: "255",
        JUPITER_PARTNER_SHARE_BPS: "8000",
      }),
    ).toBeNull();
  });

  it.each([50, 255])("accepts a valid referral rate of %i bps", (feeBps) => {
    expect(
      getJupiterReferralConfig({
        JUPITER_REFERRAL_FEE_ENABLED: "true",
        JUPITER_REFERRAL_ACCOUNT: referralAccount,
        JUPITER_REFERRAL_FEE_BPS: String(feeBps),
        JUPITER_PARTNER_SHARE_BPS: "8000",
      }),
    ).toEqual({
      account: referralAccount,
      feeBps,
      partnerShareBps: 8000,
    });
  });

  it.each(["49", "256", "2.55", ""])(
    "rejects an unsafe referral fee value of %s",
    (feeBps) => {
      let failure: unknown;
      try {
        getJupiterReferralConfig({
          JUPITER_REFERRAL_FEE_ENABLED: "true",
          JUPITER_REFERRAL_ACCOUNT: referralAccount,
          JUPITER_REFERRAL_FEE_BPS: feeBps,
          JUPITER_PARTNER_SHARE_BPS: "8000",
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(ApiFailure);
      if (!(failure instanceof ApiFailure)) return;
      expect(failure.code).toBe("JUPITER_REFERRAL_NOT_CONFIGURED");
    },
  );
});
