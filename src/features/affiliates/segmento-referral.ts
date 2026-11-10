import { SEGMENTO_TEST_REFERRAL } from "./segmento-project";
import { isDirectInfluencerCode } from "../../../shared/influencer-contracts";

export function validSegmentoCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function safeSegmentoCampaign(value: unknown): string | null {
  return validSegmentoCode(value) ? value : null;
}

/** Routing for analytics only, never proof of a payable referral. */
export function segmentoReferral(search: string) {
  const params = new URLSearchParams(search);
  const referralCode = params.get("ref");
  if (!validSegmentoCode(referralCode)) return null;
  // Walletor's own influencer links are never Segmento analytics events.
  if (isDirectInfluencerCode(referralCode)) return null;
  const campaign = safeSegmentoCampaign(params.get("utm_campaign"));
  // Native WLT invites share ?ref=. A hex code needs an explicit Segmento marker.
  if (
    /^[a-f0-9]{32}$/i.test(referralCode) &&
    params.get("sgm_rdr") !== "1" &&
    campaign !== SEGMENTO_TEST_REFERRAL.campaign
  )
    return null;
  return {
    referralCode,
    campaign:
      campaign ??
      (referralCode === SEGMENTO_TEST_REFERRAL.referralCode
        ? SEGMENTO_TEST_REFERRAL.campaign
        : null),
  };
}
