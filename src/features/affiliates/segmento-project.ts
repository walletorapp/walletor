/** Public SDK project identifier, not an API secret or payout credential. */
export const SEGMENTO_PROJECT_TOKEN =
  "eyJ2IjoxLCJwaWQiOiJ3YWxsZXRvciIsIm5hbWUiOiJXYWxsZXRvciIsImNoayI6IjFmMWMyODc0In0"; // gitleaks:allow -- Public browser SDK identifier, not a private API credential.

/** Owner-supplied test link only; not a verified KOL payee or production mapping. */
export const SEGMENTO_TEST_REFERRAL = {
  shortUrl: "https://notsolong.link/1GK",
  referralCode: "kind-mediumpurple-sparrow",
  campaign: "walletor-swap",
} as const;
