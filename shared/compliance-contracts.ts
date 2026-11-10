import { z } from "zod";

export const ComplianceDecisionSchema = z.enum([
  "NO_DIRECT_MATCH",
  "RESTRICTED",
  "UNAVAILABLE",
]);

export const ComplianceStatusSchema = z.object({
  enabled: z.boolean(),
  policyVersion: z.string(),
  scope: z.literal("OFAC_SDN_EXPLICIT_SOL_ADDRESSES_ONLY"),
  state: z.enum(["DISABLED", "CURRENT", "UNAVAILABLE"]),
  fetchedAt: z.iso.datetime().nullable(),
  publishedDate: z.string().nullable(),
  addressCount: z.number().int().nonnegative(),
  sourceHash: z.string().nullable(),
});

export const ComplianceEventSchema = z.object({
  eventId: z.string(),
  walletAddress: z.string(),
  action: z.string(),
  reference: z.string(),
  decision: ComplianceDecisionSchema,
  policyVersion: z.string(),
  sourceHash: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const ComplianceAdminResponseSchema = z.object({
  data: z.object({
    status: ComplianceStatusSchema,
    events: z.array(ComplianceEventSchema),
  }),
});
