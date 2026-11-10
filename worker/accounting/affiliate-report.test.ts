// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  AffiliateReportQuerySchema,
  type AffiliateReceipt,
} from "../../shared/affiliate-report-contracts";
import { buildAffiliateReport, readAffiliateReport } from "./affiliate-report";

const wallet = "7iDoebutxy7evc7WszPscoxgK1zUh8KJ4aFTqKHLmK54";
const sol = "So11111111111111111111111111111111111111112";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const now = "2026-10-07T16:00:00.000Z";
const query = AffiliateReportQuerySchema.parse({
  from: "2026-10-07T00:00:00.000Z",
  to: "2026-10-08T00:00:00.000Z",
  limit: 2,
});
function receipt(
  index: number,
  amount = "400000",
  mint = sol,
): AffiliateReceipt {
  return {
    receiptId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    requestId: `request-${String(index)}`,
    transactionHash: `${String(index)}${"a".repeat(87)}`,
    walletAddress: wallet,
    feeMint: mint,
    walletorFeeAtomic: amount,
    confirmedAt: now,
  };
}
const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => {
    db.close();
  });
});
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE referral_fee_ledger(entry_id TEXT PRIMARY KEY, request_id TEXT, transaction_hash TEXT, wallet_address TEXT, fee_mint TEXT, walletor_fee_atomic TEXT, created_at TEXT);
    CREATE TABLE jupiter_swap_orders(request_id TEXT PRIMARY KEY, transaction_hash TEXT, status TEXT);`);
  const sql = {
    exec<T extends Record<string, SqlStorageValue>>(
      text: string,
      ...bindings: (string | number | null)[]
    ) {
      const rows = db
        .prepare(text)
        .all(...bindings)
        .map((row) => row as T);
      return { toArray: () => rows };
    },
  };
  function add(
    row: AffiliateReceipt,
    status = "CREDITED",
    signature = row.transactionHash,
  ) {
    db.prepare("INSERT INTO referral_fee_ledger VALUES (?,?,?,?,?,?,?)").run(
      row.receiptId,
      row.requestId,
      row.transactionHash,
      row.walletAddress,
      row.feeMint,
      row.walletorFeeAtomic,
      row.confirmedAt,
    );
    db.prepare("INSERT INTO jupiter_swap_orders VALUES (?,?,?)").run(
      row.requestId,
      signature,
      status,
    );
  }
  return { db, sql, add };
}

it("keeps each fee mint separate, rounds per receipt and labels all output non-payable", () => {
  const report = buildAffiliateReport(
    [receipt(1, "400000"), receipt(2, "101", usdc), receipt(3, "9", usdc)],
    { ...query, limit: 100 },
    now,
  );
  expect(report.mode).toBe("PREVIEW_ONLY");
  expect(report.commissionAccountingEnabled).toBe(false);
  expect(report.payoutEnabled).toBe(false);
  expect(report.attributionStatus).toBe("NOT_VERIFIED");
  expect(report.pageTotalsByMint.find((t) => t.feeMint === usdc)).toEqual({
    feeMint: usdc,
    walletorFeeAtomic: "110",
    proposedKolAtomic: "10",
    proposedSegmentoAtomic: "1",
    proposedPoolAtomic: "99",
  });
  expect(
    report.pageTotalsByMint.find((t) => t.feeMint === sol)?.proposedKolAtomic,
  ).toBe("40000");
  for (const row of report.receipts)
    expect(
      BigInt(row.proposedKolAtomic) +
        BigInt(row.proposedSegmentoAtomic) +
        BigInt(row.proposedPoolAtomic),
    ).toBe(BigInt(row.walletorFeeAtomic));
});

it("rejects duplicate signatures instead of overstating a commission", () => {
  expect(() =>
    buildAffiliateReport(
      [receipt(1), { ...receipt(1), receiptId: receipt(2).receiptId }],
      query,
      now,
    ),
  ).toThrow("Duplicate");
});

it("excludes pending/mismatched/uncredited fees and uses bounded pagination without writes", () => {
  const { db, sql, add } = setup();
  add(receipt(1));
  add(receipt(2));
  add(receipt(3));
  add(receipt(4), "PENDING");
  add(receipt(5), "CREDITED", receipt(6).transactionHash);
  add({ ...receipt(6), confirmedAt: query.to });
  const before = db.prepare("SELECT * FROM referral_fee_ledger").all();
  const first = readAffiliateReport(sql, query, now);
  expect(first.receipts.map((r) => r.receiptId)).toEqual([
    receipt(1).receiptId,
    receipt(2).receiptId,
  ]);
  expect(first.nextCursor).toBe(receipt(2).receiptId);
  const second = readAffiliateReport(
    sql,
    { ...query, after: first.nextCursor ?? undefined },
    now,
  );
  expect(second.receipts.map((r) => r.receiptId)).toEqual([
    receipt(3).receiptId,
  ]);
  expect(second.nextCursor).toBeNull();
  expect(db.prepare("SELECT * FROM referral_fee_ledger").all()).toEqual(before);
});

it("applies wallet and UTC interval filters at the ledger boundary", () => {
  const { sql, add } = setup();
  add(receipt(1));
  add({ ...receipt(2), walletAddress: sol });
  add({ ...receipt(3), confirmedAt: "2026-10-06T23:59:59.999Z" });
  const report = readAffiliateReport(sql, { ...query, wallet }, now);
  expect(report.receipts.map((r) => r.receiptId)).toEqual([
    receipt(1).receiptId,
  ]);
});

it("rejects unbounded windows, invalid cursor and SQL input", () => {
  for (const input of [
    { ...query, to: query.from },
    { ...query, to: "2027-01-01T00:00:00.000Z" },
    { ...query, limit: 10000 },
    { ...query, after: "' OR 1=1 --" },
    { ...query, wallet: "' OR 1=1 --" },
  ])
    expect(AffiliateReportQuerySchema.safeParse(input).success).toBe(false);
});
