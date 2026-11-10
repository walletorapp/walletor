import { z } from "zod";

const integer = z.string().regex(/^\d+$/);
const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const AffiliateReportQuerySchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    wallet: address.optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((q) => {
    const duration = Date.parse(q.to) - Date.parse(q.from);
    return duration > 0 && duration <= 31 * 86_400_000;
  }, "Choose a reporting window of at most 31 days.");

export const AffiliateReceiptSchema = z.object({
  receiptId: z.uuid(),
  requestId: z.string().min(1),
  transactionHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
  walletAddress: address,
  feeMint: address,
  walletorFeeAtomic: integer,
  confirmedAt: z.iso.datetime(),
});

const amounts = {
  walletorFeeAtomic: integer,
  proposedKolAtomic: integer,
  proposedSegmentoAtomic: integer,
  proposedPoolAtomic: integer,
};
export const AffiliateReportSchema = z.object({
  mode: z.literal("PREVIEW_ONLY"),
  commissionAccountingEnabled: z.literal(false),
  payoutEnabled: z.literal(false),
  attributionStatus: z.literal("NOT_VERIFIED"),
  projectId: z.literal("walletor"),
  generatedAt: z.iso.datetime(),
  query: AffiliateReportQuerySchema,
  policy: z.object({
    kolBps: z.literal(1000),
    platformBpsOfKol: z.literal(1000),
  }),
  receipts: z.array(AffiliateReceiptSchema.extend(amounts)).max(100),
  pageTotalsByMint: z.array(z.object({ feeMint: address, ...amounts })),
  nextCursor: z.uuid().nullable(),
  limitations: z.array(z.string()),
});
export const AffiliateReportResponseSchema = z.object({
  data: AffiliateReportSchema,
});
export type AffiliateReportQuery = z.infer<typeof AffiliateReportQuerySchema>;
export type AffiliateReceipt = z.infer<typeof AffiliateReceiptSchema>;
export type AffiliateReport = z.infer<typeof AffiliateReportSchema>;
