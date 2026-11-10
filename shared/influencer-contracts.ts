import { z } from "zod";

const atomic = z.string().regex(/^\d+$/);
const wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const INFLUENCER_POLICY = "walletor-direct-influencer-v1";
export function influencerCode(walletAddress: string): string {
  return `wlr-${walletAddress}`;
}
export function isDirectInfluencerCode(code: string): boolean {
  return /^wlr-[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(code);
}
export function influencerName(walletAddress: string): string {
  return `Creator ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
}
export const InfluencerCodeSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const RegisteredInfluencerSchema = z
  .object({
    code: InfluencerCodeSchema,
    influencerId: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    ownerWallet: wallet,
  })
  .strict();
export type RegisteredInfluencer = z.infer<typeof RegisteredInfluencerSchema>;
export const InfluencerRequestSchema = z
  .object({
    walletAddress: wallet,
    code: InfluencerCodeSchema,
    purpose: z.enum(["ENROLL", "JOIN", "REPORT"]),
  })
  .strict();
export const InfluencerProofSchema = InfluencerRequestSchema.extend({
  nonce: z.uuid(),
  signature: z.string().min(64).max(100),
});
export type InfluencerProof = z.infer<typeof InfluencerProofSchema>;
export const InfluencerChallengeSchema = z.object({
  nonce: z.uuid(),
  expiresAt: z.iso.datetime(),
  message: z.string(),
});
export const InfluencerStatusSchema = z.object({
  approved: z.boolean(),
  name: z.string().nullable(),
  canJoin: z.boolean(),
  joined: z.boolean(),
  startsAt: z.iso.datetime().nullable(),
  policy: z.literal(INFLUENCER_POLICY),
  kolBps: z.literal(1000),
});
export const InfluencerProfileSchema = z.object({
  registered: z.boolean(),
  code: InfluencerCodeSchema,
  name: z.string().nullable(),
  referralUrl: z.url(),
  startsAt: z.iso.datetime(),
  policy: z.literal(INFLUENCER_POLICY),
  kolBps: z.literal(1000),
});
export const InfluencerReportQuerySchema = z
  .object({
    from: z.iso.datetime().transform((value) => new Date(value).toISOString()),
    to: z.iso.datetime().transform((value) => new Date(value).toISOString()),
    code: InfluencerCodeSchema.optional(),
    after: z.coerce.number().int().nonnegative().default(0),
  })
  .strict()
  .refine((q) => {
    const duration = Date.parse(q.to) - Date.parse(q.from);
    return (
      duration > 0 &&
      duration <= 31 * 86_400_000 &&
      [q.from, q.to].every((d) => Date.parse(d) % 86_400_000 === 0)
    );
  }, "Choose UTC day boundaries covering up to 31 days.");
export type InfluencerReportQuery = z.infer<typeof InfluencerReportQuerySchema>;
const total = z.object({
  code: InfluencerCodeSchema,
  influencerId: z.string(),
  name: z.string(),
  feeMint: wallet,
  grossFeeAtomic: atomic,
  influencerAtomic: atomic,
  platformAtomic: z.literal("0"),
  receiptCount: z.number().int().nonnegative(),
});
export const InfluencerReportSchema = z.object({
  policy: z.literal(INFLUENCER_POLICY),
  startsAt: z.iso.datetime().nullable(),
  generatedAt: z.iso.datetime(),
  payoutMode: z.literal("MANUAL"),
  paymentRecordingEnabled: z.literal(false),
  registeredInfluencers: z.array(RegisteredInfluencerSchema),
  query: InfluencerReportQuerySchema,
  periodTotals: z.array(total),
  lifetimeTotals: z.array(total),
  receipts: z
    .array(
      z.object({
        id: z.number().int().positive(),
        code: InfluencerCodeSchema,
        chainId: z.string(),
        transactionHash: z.string(),
        walletAddress: wallet,
        feeMint: wallet,
        grossFeeAtomic: atomic,
        influencerAtomic: atomic,
        platformAtomic: z.literal("0"),
        confirmedAt: z.iso.datetime(),
      }),
    )
    .max(100),
  nextCursor: z.number().int().positive().nullable(),
});
export type InfluencerReport = z.infer<typeof InfluencerReportSchema>;

export function influencerMessage(
  input: z.infer<typeof InfluencerRequestSchema>,
  nonce: string,
  expiresAt: string,
) {
  const action =
    input.purpose === "ENROLL"
      ? "This free signature creates my public Walletor influencer referral link, linked to this wallet. I earn 10% of Walletor fees from registered referred wallets' future swaps. Payments are manual every 30 days. There is no Segmento commission. My public creator name is derived from this wallet address."
      : input.purpose === "JOIN"
        ? "This free signature permanently registers this wallet with this influencer before its first Walletor swap. The influencer earns 10% of Walletor fees from future swaps under this policy."
        : "This free signature authorizes a private earnings report for this influencer.";
  return `Walletor influencer referral\nDomain: walletor.com\nPurpose: ${input.purpose}\nWallet: ${input.walletAddress}\nReferral code: ${input.code}\nPolicy: ${INFLUENCER_POLICY}\nNonce: ${nonce}\nExpires: ${expiresAt}\n${action}\nIt does not authorize a transaction or transfer funds.`;
}
