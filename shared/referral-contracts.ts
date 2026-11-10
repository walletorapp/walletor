import { z } from "zod";

export const REFERRAL_POINTS = 100;
export const REFERRAL_BOOST_BPS = 1000;
export const REFERRAL_MAX_BOOST_BPS = 5000;
export const ReferralWalletSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const ReferralCodeSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const ReferralJoinSchema = z.object({
  walletAddress: ReferralWalletSchema,
  code: ReferralCodeSchema,
});
export const ReferralProofSchema = ReferralJoinSchema.extend({
  nonce: z.uuid(),
  signature: z.string().min(64).max(100),
});
export const ReferralChallengeSchema = z.object({
  message: z.string(),
  nonce: z.uuid(),
  expiresAt: z.iso.datetime(),
});
export const ReferralStateSchema = z.object({
  walletAddress: ReferralWalletSchema,
  code: ReferralCodeSchema,
  qualifiedReferrals: z.number().int().nonnegative(),
  bonusPoints: z.string().regex(/^\d+$/),
  joined: z.boolean(),
  canJoin: z.boolean(),
  activeRoundId: z.string(),
  roundEndsAt: z.iso.datetime(),
  boostStartsAt: z.iso.datetime(),
  roundQualifiedReferrals: z.number().int().nonnegative(),
  boostBps: z.number().int().min(0).max(5000),
  eligibleForBoost: z.boolean(),
});
export type ReferralState = z.infer<typeof ReferralStateSchema>;
export type ReferralProof = z.infer<typeof ReferralProofSchema>;

export function referralMessage(
  wallet: string,
  code: string,
  nonce: string,
  expiresAt: string,
): string {
  return `Walletor referral registration\nDomain: walletor.com\nWallet: ${wallet}\nReferral code: ${code}\nNonce: ${nonce}\nExpires: ${expiresAt}\nThis free signature links your first qualifying Walletor swap to this referrer. It does not authorize a transaction or transfer funds.`;
}
