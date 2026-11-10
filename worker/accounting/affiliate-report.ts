import {
  AffiliateReceiptSchema,
  AffiliateReportQuerySchema,
  AffiliateReportSchema,
  type AffiliateReceipt,
  type AffiliateReportQuery,
} from "../../shared/affiliate-report-contracts";
import {
  PROPOSED_SEGMENTO_POLICY,
  splitAffiliateFee,
} from "./affiliate-commission";

type ReceiptRow = Record<string, SqlStorageValue> & {
  entry_id: string;
  request_id: string;
  transaction_hash: string;
  wallet_address: string;
  fee_mint: string;
  walletor_fee_atomic: string;
  created_at: string;
};
interface ReportSql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): T[] };
}

/** Read-only: no attribution, liabilities, fee deductions or settlement writes. */
export function readAffiliateReport(
  sql: ReportSql,
  input: AffiliateReportQuery,
  now: string,
) {
  const query = AffiliateReportQuerySchema.parse(input);
  const rows = sql
    .exec<ReceiptRow>(
      `SELECT f.entry_id, f.request_id, f.transaction_hash, f.wallet_address,
      f.fee_mint, f.walletor_fee_atomic, f.created_at
     FROM referral_fee_ledger AS f
     JOIN jupiter_swap_orders AS o ON o.request_id = f.request_id
       AND o.transaction_hash = f.transaction_hash AND o.status = 'CREDITED'
     WHERE f.created_at >= ? AND f.created_at < ?
       AND (? IS NULL OR f.wallet_address = ?)
       AND (? IS NULL OR f.entry_id > ?)
     ORDER BY f.entry_id ASC LIMIT ?`,
      query.from,
      query.to,
      query.wallet ?? null,
      query.wallet ?? null,
      query.after ?? null,
      query.after ?? null,
      query.limit + 1,
    )
    .toArray();
  const receipts = rows.slice(0, query.limit).map((row) =>
    AffiliateReceiptSchema.parse({
      receiptId: row.entry_id,
      requestId: row.request_id,
      transactionHash: row.transaction_hash,
      walletAddress: row.wallet_address,
      feeMint: row.fee_mint,
      walletorFeeAtomic: row.walletor_fee_atomic,
      confirmedAt: row.created_at,
    }),
  );
  return buildAffiliateReport(
    receipts,
    query,
    now,
    rows.length > query.limit ? (receipts.at(-1)?.receiptId ?? null) : null,
  );
}

export function buildAffiliateReport(
  input: AffiliateReceipt[],
  query: AffiliateReportQuery,
  generatedAt: string,
  nextCursor: string | null = null,
) {
  const seen = new Set<string>();
  const totals = new Map<
    string,
    { gross: bigint; kol: bigint; segmento: bigint; pool: bigint }
  >();
  const receipts = input.map((raw) => {
    const row = AffiliateReceiptSchema.parse(raw);
    const key = `${row.transactionHash}:${row.feeMint}`;
    if (seen.has(key))
      throw new Error("Duplicate fee receipt; report requires reconciliation.");
    seen.add(key);
    const gross = BigInt(row.walletorFeeAtomic);
    const split = splitAffiliateFee(gross, PROPOSED_SEGMENTO_POLICY);
    const total = totals.get(row.feeMint) ?? {
      gross: 0n,
      kol: 0n,
      segmento: 0n,
      pool: 0n,
    };
    total.gross += gross;
    total.kol += split.kolAtomic;
    total.segmento += split.platformAtomic;
    total.pool += split.poolAtomic;
    totals.set(row.feeMint, total);
    return {
      ...row,
      proposedKolAtomic: split.kolAtomic.toString(),
      proposedSegmentoAtomic: split.platformAtomic.toString(),
      proposedPoolAtomic: split.poolAtomic.toString(),
    };
  });
  return AffiliateReportSchema.parse({
    mode: "PREVIEW_ONLY",
    commissionAccountingEnabled: false,
    payoutEnabled: false,
    attributionStatus: "NOT_VERIFIED",
    projectId: "walletor",
    generatedAt,
    query,
    policy: PROPOSED_SEGMENTO_POLICY,
    receipts,
    nextCursor,
    pageTotalsByMint: [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([feeMint, t]) => ({
        feeMint,
        walletorFeeAtomic: t.gross.toString(),
        proposedKolAtomic: t.kol.toString(),
        proposedSegmentoAtomic: t.segmento.toString(),
        proposedPoolAtomic: t.pool.toString(),
      })),
    limitations: [
      "Verified fee receivables, not proof of collection into the treasury or USDC available for payment.",
      "All matching credited swaps are shown; no KOL attribution or payout recipient is verified.",
      "Proposed amounts are hypothetical, not earned allocations or retroactive deductions. Existing pool and claims are unchanged.",
      "Amounts are atomic units grouped by mint. Totals cover this page only; never add different mints together.",
      "Segmento allocation API, recipient mapping, attribution policy, activation date and settlement terms are required before activation.",
      "Late reconciliation can add older receipts; regenerate the report before reviewing settlement.",
    ],
  });
}
