import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";

const MIN_REFERRAL_FEE_BPS = 50;
const MAX_REFERRAL_FEE_BPS = 255;

export type JupiterReferralConfig = Readonly<{
  account: string;
  feeBps: number;
  partnerShareBps: number;
}>;

type JupiterReferralEnvironment = Readonly<{
  JUPITER_REFERRAL_FEE_ENABLED?: string;
  JUPITER_REFERRAL_ACCOUNT?: string;
  JUPITER_REFERRAL_FEE_BPS?: string;
  JUPITER_PARTNER_SHARE_BPS?: string;
}>;

export function getJupiterReferralConfig(
  env: JupiterReferralEnvironment,
): JupiterReferralConfig | null {
  if (env.JUPITER_REFERRAL_FEE_ENABLED !== "true") return null;

  const account = env.JUPITER_REFERRAL_ACCOUNT?.trim() ?? "";
  const rawFeeBps = env.JUPITER_REFERRAL_FEE_BPS?.trim() ?? "";
  const feeBps = /^\d+$/.test(rawFeeBps) ? Number(rawFeeBps) : Number.NaN;
  const rawPartnerShareBps = env.JUPITER_PARTNER_SHARE_BPS?.trim() ?? "";
  const partnerShareBps = /^\d+$/.test(rawPartnerShareBps)
    ? Number(rawPartnerShareBps)
    : Number.NaN;
  if (
    !isSolanaAddress(account) ||
    !Number.isInteger(feeBps) ||
    feeBps < MIN_REFERRAL_FEE_BPS ||
    feeBps > MAX_REFERRAL_FEE_BPS ||
    !Number.isInteger(partnerShareBps) ||
    partnerShareBps < 1 ||
    partnerShareBps > 10_000
  ) {
    throw new ApiFailure(
      503,
      "JUPITER_REFERRAL_NOT_CONFIGURED",
      "Walletor swap fees are not configured safely for this environment.",
      false,
    );
  }

  return { account, feeBps, partnerShareBps };
}
