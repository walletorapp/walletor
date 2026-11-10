// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { InfluencerLedger } from "./influencer-ledger";
import {
  initializeFeeReserve,
  recordFeeReserve,
  splitFeeReserve,
} from "./fee-reserve";
import {
  InfluencerReportQuerySchema,
  influencerCode,
  influencerName,
  type InfluencerProof,
} from "../../shared/influencer-contracts";
import { exportLedgerSql } from "./backup";

const start = "2026-10-16T14:00:00.000Z";
const joined = "2026-10-16T14:01:00.000Z";
const order = "2026-10-16T14:02:00.000Z";
const end = "2026-10-16T14:03:00.000Z";
const key = (n: number) => new Uint8Array(32).fill(n);
const address = (n: number) => bs58.encode(ed25519.getPublicKey(key(n)));
const mint = address(6);
const creator = {
  code: influencerCode(address(1)),
  influencerId: `direct:${address(1)}`,
  name: influencerName(address(1)),
  ownerWallet: address(1),
};
const other = {
  code: influencerCode(address(2)),
  influencerId: `direct:${address(2)}`,
  name: influencerName(address(2)),
  ownerWallet: address(2),
};
const query = {
  from: "2026-10-16T00:00:00.000Z",
  to: "2026-10-17T00:00:00.000Z",
  after: 0,
};
const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => {
    db.close();
  });
});
function setup(approved = true) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE participants(wallet_address TEXT,actual_swap_count INTEGER); CREATE TABLE jupiter_swap_orders(evidence_json TEXT); CREATE TABLE wallet_referrals(wallet_address TEXT,referrer_address TEXT); CREATE TABLE wallet_referral_codes(wallet_address TEXT,code TEXT);",
  );
  const sql = {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: (string | number | null)[]
    ) {
      let rows: T[] = [];
      if (!bindings.length && !/^\s*(SELECT|WITH|PRAGMA)/i.test(query))
        db.exec(query);
      else {
        const stmt = db.prepare(query);
        if (stmt.columns().length)
          rows = stmt.all(...bindings).map((r) => r as T);
        else stmt.run(...bindings);
      }
      return {
        toArray: () => rows,
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };
  function tx<T>(fn: () => T): T {
    db.exec("SAVEPOINT unit_test");
    try {
      const result = fn();
      db.exec("RELEASE unit_test");
      return result;
    } catch (error) {
      db.exec("ROLLBACK TO unit_test; RELEASE unit_test");
      throw error;
    }
  }
  initializeFeeReserve(sql, start);
  const ledger = new InfluencerLedger(sql);
  tx(() => {
    ledger.initialize(start);
  });
  const proof = (
    n: number,
    code = creator.code,
    purpose: "ENROLL" | "JOIN" | "REPORT" = "JOIN",
    now = joined,
  ): InfluencerProof => {
    const challenge = ledger.challenge(
      { walletAddress: address(n), code, purpose },
      now,
    );
    return {
      walletAddress: address(n),
      code,
      purpose,
      nonce: challenge.nonce,
      signature: bs58.encode(
        ed25519.sign(new TextEncoder().encode(challenge.message), key(n)),
      ),
    };
  };
  if (approved) {
    tx(() => ledger.enroll(proof(1, creator.code, "ENROLL", start), start));
    tx(() => ledger.enroll(proof(2, other.code, "ENROLL", start), start));
  }
  const join = (n = 3, code = creator.code) => {
    tx(() => {
      ledger.join(proof(n, code), joined);
    });
  };
  function credit(
    signature: string,
    gross = 400000n,
    feeMint = mint,
    wallet = address(3),
    startedAt = order,
    confirmedAt = end,
  ) {
    tx(() => {
      const reserve = splitFeeReserve(gross, gross, confirmedAt, start);
      recordFeeReserve(
        sql,
        "solana-mainnet",
        signature,
        feeMint,
        confirmedAt,
        reserve,
      );
      ledger.credit({
        wallet,
        orderStartedAt: startedAt,
        confirmedAt,
        chainId: "solana-mainnet",
        signature,
        mint: feeMint,
        gross,
        reserved: reserve.reserved,
      });
    });
  }
  return { db, sql, tx, ledger, proof, join, credit };
}
describe("verified lifetime influencer commissions", () => {
  it("opens direct wallet enrollment without a CSV and never rewrites activation or ownership", () => {
    const { ledger, tx, db, proof } = setup(false);
    expect(ledger.startsAt()).toBe(start);
    expect(ledger.status(address(3), "unverified").canJoin).toBe(false);
    expect(() =>
      ledger.challenge(
        { walletAddress: address(3), code: creator.code, purpose: "JOIN" },
        joined,
      ),
    ).toThrow("not registered");
    const enrollment = proof(1, creator.code, "ENROLL");
    const profile = tx(() => ledger.enroll(enrollment, joined));
    expect(profile).toMatchObject({
      registered: true,
      referralUrl: `https://walletor.com/?ref=${creator.code}`,
    });
    ledger.initialize(end);
    expect(ledger.startsAt()).toBe(start);
    expect(() => {
      tx(() => ledger.enroll(enrollment, joined));
    }).toThrow("already used");
    expect(() => {
      ledger.challenge(
        { walletAddress: address(7), code: creator.code, purpose: "ENROLL" },
        joined,
      );
    }).toThrow("own wallet");
    expect(() =>
      db
        .prepare("UPDATE influencer_registry SET owner_wallet=?")
        .run(address(7)),
    ).toThrow("immutable");
    expect(() => db.prepare("DELETE FROM influencer_registry").run()).toThrow(
      "immutable",
    );
  });
  it("requires a genuine, unexpired, single-use wallet signature and cannot replace first referral", () => {
    const { ledger, proof, tx, join, db } = setup();
    const p = proof(3);
    expect(() => {
      tx(() => {
        ledger.join(
          { ...p, signature: bs58.encode(new Uint8Array(64)) },
          joined,
        );
      });
    }).toThrow("Signature");
    expect(() => {
      tx(() => {
        ledger.join({ ...p, purpose: "REPORT" }, joined);
      });
    }).toThrow("expired");
    expect(() => {
      tx(() => {
        ledger.join(p, "2026-10-16T14:07:00.000Z");
      });
    }).toThrow("expired");
    tx(() => {
      ledger.join(p, joined);
    });
    expect(ledger.status(address(3), creator.code).joined).toBe(true);
    expect(() => {
      tx(() => {
        ledger.join(p, joined);
      });
    }).toThrow("already used");
    expect(() => {
      join(3, other.code);
    }).toThrow("cannot perform");
    expect(() =>
      db.prepare("UPDATE influencer_links SET code=?").run(other.code),
    ).toThrow("immutable");
  });
  it("rejects self-referrals, existing traders, pending first orders, native referral conflicts and bad addresses", () => {
    const { ledger, join, db } = setup();
    expect(() => {
      join(1);
    }).toThrow("cannot perform");
    db.prepare("INSERT INTO participants VALUES (?,1)").run(address(3));
    expect(() => {
      join(3);
    }).toThrow("cannot perform");
    db.prepare("INSERT INTO jupiter_swap_orders VALUES (?)").run(
      JSON.stringify({ walletAddress: address(4) }),
    );
    expect(() => {
      join(4);
    }).toThrow("cannot perform");
    db.prepare("INSERT INTO wallet_referrals VALUES (?,?)").run(
      address(5),
      other.ownerWallet,
    );
    expect(() => {
      join(5);
    }).toThrow("cannot perform");
    expect(() =>
      ledger.status(
        "11111111111111111111111111111111111111111111",
        creator.code,
      ),
    ).toThrow("valid Solana");
  });
  it("earmarks only subsequent verified receipts within the reserve, preserving exact amounts per mint", () => {
    const { join, credit, ledger, db } = setup();
    join();
    credit("first");
    credit("second", 400000n, address(7));
    credit("tiny", 9n);
    credit("large", 900719925474099300000n);
    credit("late-old", 400000n, mint, address(3), "2026-10-16T13:59:00.000Z");
    credit("before-join", 400000n, mint, address(3), start);
    credit("unknown", 400000n, mint, address(5));
    const report = ledger.report(query, end);
    expect(report.receipts).toHaveLength(4);
    expect(report.periodTotals).toEqual(report.lifetimeTotals);
    expect(report.lifetimeTotals.find((t) => t.feeMint === mint)).toMatchObject(
      {
        influencerAtomic: "90071992547409970000",
        platformAtomic: "0",
        receiptCount: 3,
      },
    );
    expect(() => {
      credit("first");
    }).toThrow();
    expect(() =>
      db.prepare("DELETE FROM influencer_commissions").run(),
    ).toThrow("immutable");
  });
  it("also prevents conflicting native invitations after the lifetime registration", () => {
    const { ledger, join, db } = setup();
    join();
    db.prepare("INSERT INTO wallet_referral_codes VALUES (?,?)").run(
      other.ownerWallet,
      "other-native",
    );
    expect(() => {
      ledger.assertNativeReferral(address(3), "other-native");
    }).toThrow("different influencer");
    db.prepare("INSERT INTO wallet_referral_codes VALUES (?,?)").run(
      creator.ownerWallet,
      "same-native",
    );
    expect(() => {
      ledger.assertNativeReferral(address(3), "same-native");
    }).not.toThrow();
  });
  it("rolls back fee, commission and totals together on failure, then credits one successful retry", () => {
    const { ledger, join, credit, db } = setup();
    join();
    db.exec(
      "CREATE TRIGGER fail_commission BEFORE INSERT ON influencer_totals BEGIN SELECT RAISE(ABORT,'forced failure'); END;",
    );
    expect(() => {
      credit("retry");
    }).toThrow("forced failure");
    expect(ledger.report(query, end).receipts).toHaveLength(0);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM fee_reserve_receipts").get()?.n,
    ).toBe(0);
    db.exec("DROP TRIGGER fail_commission");
    credit("retry");
    expect(ledger.report(query, end).lifetimeTotals[0]?.influencerAtomic).toBe(
      "40000",
    );
    expect(() => {
      ledger.credit({
        wallet: address(3),
        orderStartedAt: order,
        confirmedAt: end,
        chainId: "solana-mainnet",
        signature: "fake",
        mint,
        gross: 400000n,
        reserved: 44000n,
      });
    }).toThrow("missing its verified");
    expect(() => {
      ledger.credit({
        wallet: address(3),
        orderStartedAt: order,
        confirmedAt: end,
        chainId: "solana-mainnet",
        signature: "bad-reserve",
        mint,
        gross: 400000n,
        reserved: 0n,
      });
    }).toThrow("exceeds");
  });
  it("paginates receipts without reducing statement totals, keeps UTC boundaries and restores in backup", () => {
    const { ledger, join, credit, sql } = setup();
    join();
    for (let i = 0; i < 105; i++) credit(`tx-${String(i)}`);
    credit(
      "next-day",
      400000n,
      mint,
      address(3),
      order,
      "2026-10-17T00:00:00.000Z",
    );
    const first = ledger.report(query, end);
    expect(first.receipts).toHaveLength(100);
    expect(first.nextCursor).toBe(100);
    expect(first.periodTotals[0]?.receiptCount).toBe(105);
    expect(first.lifetimeTotals[0]?.receiptCount).toBe(106);
    const next = ledger.report({ ...query, after: first.nextCursor ?? 0 }, end);
    expect(next.receipts).toHaveLength(5);
    expect(next.nextCursor).toBeNull();
    expect(next.periodTotals).toEqual(first.periodTotals);
    expect(
      InfluencerReportQuerySchema.parse({
        ...query,
        from: "2026-10-16T00:00:00Z",
      }).from,
    ).toBe(query.from);
    expect(
      InfluencerReportQuerySchema.safeParse({
        ...query,
        to: "2026-10-17T00:01:00.000Z",
      }).success,
    ).toBe(false);
    const restored = new DatabaseSync(":memory:");
    databases.push(restored);
    restored.exec(exportLedgerSql(sql).sql);
    expect(
      restored.prepare("SELECT COUNT(*) AS n FROM influencer_commissions").get()
        ?.n,
    ).toBe(106);
  });
  it("only reveals a creator's private report to their signed owner, never a supplied different code", () => {
    const { ledger, join, credit, proof, tx } = setup();
    join();
    join(4, other.code);
    credit("one");
    credit("two", 400000n, mint, address(4));
    expect(() => proof(3, creator.code, "REPORT")).toThrow("cannot perform");
    const p = proof(1, creator.code, "REPORT");
    const report = tx(() =>
      ledger.privateReport(p, { ...query, code: other.code }, end),
    );
    expect(report.registeredInfluencers.map((c) => c.code)).toEqual([
      creator.code,
    ]);
    expect(report.receipts.map((r) => r.code)).toEqual([creator.code]);
    expect(() => tx(() => ledger.privateReport(p, query, end))).toThrow(
      "already used",
    );
  });
});
