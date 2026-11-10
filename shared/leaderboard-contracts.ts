import { z } from "zod";

const amount = z.string().regex(/^\d+$/);
const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
export const LeaderboardQuerySchema = z.object({
  period: z.enum(["round", "all"]).default("all"),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  search: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{0,44}$/)
    .default(""),
  wallet: address.optional(),
});
const pagination = z.object({
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export const RankingEntrySchema = z.object({
  rank: z.number().int().positive(),
  walletAddress: address,
  points: amount,
  eligibleSwaps: z.number().int().nonnegative(),
});
export const RankingsSchema = z.object({
  entries: z.array(RankingEntrySchema).max(25),
  yourPosition: RankingEntrySchema.nullable(),
  pagination,
});
const rankedWallet = RankingEntrySchema.extend({ totalWonAtomic: amount });
export const LeaderboardResponseSchema = z.object({
  entries: z.array(rankedWallet).max(25),
  yourPosition: rankedWallet.nullable(),
  pagination,
  roundId: z.string(),
  roundEndsAt: z.iso.datetime(),
  serverTime: z.iso.datetime(),
});
export const WinnerSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  walletAddress: address,
  rank: z.number().int().positive(),
  netAmountAtomic: amount,
  poolAmountAtomic: amount,
  status: z.enum(["CLAIMED", "CLAIMABLE", "EXPIRED", "PENDING"]),
  date: z.iso.datetime(),
  deadline: z.iso.datetime(),
  claimSignature: signature.nullable(),
  fundingSignature: signature,
  requestSignature: signature,
  revealSignature: signature,
  randomnessAccount: address,
  randomnessProvider: z.enum(["MagicBlock", "Switchboard"]),
  merkleRoot: z.string(),
});
export const WinnersResponseSchema = z.object({
  entries: z.array(WinnerSchema).max(25),
  pagination,
  totals: z.object({
    claimedAtomic: amount,
    awardedAtomic: amount,
    winningWallets: z.number().int().nonnegative(),
    fundedDraws: z.number().int().nonnegative(),
  }),
  serverTime: z.iso.datetime(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;
export type Winner = z.infer<typeof WinnerSchema>;
