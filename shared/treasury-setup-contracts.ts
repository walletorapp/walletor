import { z } from "zod";

export const REWARDS_AUTOMATION_ADDRESS =
  "EKvbK4qoE2dHK3z6d9et3H67cVKLsjUzLzyEB2Yx8RJ8";
export const JUPITER_REFERRAL_PROGRAM_ADDRESS =
  "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";

export const TreasurySetupResponseSchema = z.object({
  data: z.object({
    referralAccount: z.string(),
    currentPartner: z.string(),
    automationAddress: z.literal(REWARDS_AUTOMATION_ADDRESS),
    partnerShareBps: z.number().int(),
    authorized: z.boolean(),
    transaction: z.string().nullable(),
    blockhash: z.string().nullable(),
    lastValidBlockHeight: z.number().int().nullable(),
  }),
});

export const TreasuryFundingStatusSchema = z.object({
  data: z.object({
    automaticEnabled: z.boolean(),
    rounds: z.array(
      z.object({
        round_id: z.string(),
        status: z.string(),
        last_error: z.string().nullable(),
      }),
    ),
    operations: z.array(
      z.object({
        round_id: z.string(),
        kind: z.string(),
        status: z.string(),
        signature: z.string(),
        output_amount_atomic: z.string().nullable(),
      }),
    ),
  }),
});
