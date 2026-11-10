// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import {
  initializeFeeReserve,
  feeReserveStart,
  splitFeeReserve,
  recordFeeReserve,
  readFeeReserve,
} from "./fee-reserve";
import { exportLedgerSql } from "./backup";
import { InfluencerLedger } from "./influencer-ledger";
import { INFLUENCER_POLICY } from "../../shared/influencer-contracts";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: DurableObjectState,
      public env: Env,
    ) {}
  },
}));
import { PrizePoolCoordinator, type CoordinatorRules } from "./coordinator";
import { JupiterSwapExecutionEvidenceSchema } from "../../shared/accounting-contracts";

const start = "2026-10-12T14:00:00.000Z";
const sol = "So11111111111111111111111111111111111111112";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => {
    db.close();
  });
});
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
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
        one: () => {
          if (rows.length !== 1) throw new Error("Expected one row");
          return rows[0];
        },
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };
  const transactionSync = <T>(fn: () => T): T => {
    db.exec("SAVEPOINT test_tx");
    try {
      const value = fn();
      db.exec("RELEASE test_tx");
      return value;
    } catch (error) {
      db.exec("ROLLBACK TO test_tx; RELEASE test_tx");
      throw error;
    }
  };
  return { db, sql, transactionSync };
}

it("splits all fees exactly, leaves dust, and never backdates the reserve", () => {
  expect(splitFeeReserve(400000n, 400000n, start, start)).toMatchObject({
    reserved: 44000n,
    pool: 356000n,
    reservedMicroUsd: 44000n,
    poolMicroUsd: 356000n,
  });
  for (const gross of [0n, 1n, 9n, 101n, 900719925474099300000n]) {
    const split = splitFeeReserve(gross, gross * 19n, start, start);
    expect(split.reserved + split.pool).toBe(gross);
    expect(split.reservedMicroUsd + split.poolMicroUsd).toBe(gross * 19n);
  }
  expect(
    splitFeeReserve(400000n, 400000n, "2026-10-12T13:59:59.999Z", start),
  ).toMatchObject({ active: false, reserved: 0n, pool: 400000n });
  expect(() => splitFeeReserve(-1n, 0n, start, start)).toThrow();
  expect(() => splitFeeReserve(1n, 1n, "invalid", start)).toThrow();
});

it("persists activation once, rejects duplicate/edited receipts, separates mints and restores a backup", () => {
  const { db, sql, transactionSync } = setup();
  initializeFeeReserve(sql, start);
  initializeFeeReserve(sql, "2026-11-12T00:00:00.000Z");
  expect(feeReserveStart(sql)).toBe(start);
  const add = (signature: string, mint: string) => {
    transactionSync(() => {
      recordFeeReserve(
        sql,
        "solana:mainnet",
        signature,
        mint,
        start,
        splitFeeReserve(10000n, 10000n, start, start),
      );
    });
  };
  add("sig1", sol);
  add("sig2", usdc);
  expect(() => {
    add("sig1", sol);
  }).toThrow();
  expect(() => {
    db.exec("UPDATE fee_reserve_receipts SET reserved_atomic='0'");
  }).toThrow();
  expect(
    readFeeReserve(sql, start).balances.map((b) => b.reservedAtomic),
  ).toEqual(["1100", "1100"]);
  expect(() =>
    transactionSync(() => {
      add("sig3", sol);
      throw new Error("credit failed");
    }),
  ).toThrow();
  expect(readFeeReserve(sql, start).receipts).toHaveLength(2);
  const backup = exportLedgerSql(sql);
  const restored = setup();
  restored.db.exec(backup.sql);
  expect(readFeeReserve(restored.sql, start)).toEqual(
    readFeeReserve(sql, start),
  );
});

const rules: CoordinatorRules = {
  accountingEnabled: true,
  prizePoolWinnerCount: 22,
  prizePoolClaimFeeBps: 250,
  chainId: "solana-mainnet",
  treasuryAddress: sol,
  feeAssetMint: null,
  standardSwapFeeAtomic: null,
  standardSwapFeeCents: "100",
  advancedTradeFeeCents: "10",
  prizePoolPercentageBps: "10000",
  platformRevenuePercentageBps: "0",
  roundDurationHours: 24,
  minimumRewardEligibleSwapCents: "500",
  newWalletReviewDays: 7,
  wltBasePointsPerEligibleSwap: "2",
  referralAccount: sol,
  referralFeeBps: 50,
  partnerShareBps: 8000,
};

it("credits gross receipts, net pool and reserve atomically through the real coordinator; funding excludes the reserve", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  const { db, sql, transactionSync } = setup();
  const state = {
    storage: { sql, transactionSync },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
  };
  // Reflect constructs the real coordinator with the narrowly implemented
  // Cloudflare test double above, without pretending to implement platform APIs.
  const coordinator: PrizePoolCoordinator = Reflect.construct(
    PrizePoolCoordinator,
    [
      state,
      {
        SOLANA_CLAIM_AUTHORITY_ADDRESS: sol,
        QUESTLINE_ENABLED: "true",
        QUESTLINE_QUEST_ID: "89",
        QUESTLINE_CAMPAIGN_START_AT: start,
        QUESTLINE_API_KEY: `qlk_live_${"test".repeat(8)}`,
      },
    ],
  );
  coordinator.initialize(
    {
      poolId: "solana:mainnet:prize-pool",
      chainId: rules.chainId,
      chainFamily: "SOLANA",
      networkName: "mainnet",
    },
    start,
    24,
  );
  db.exec(
    "UPDATE pool_state SET current_balance_microusd='100000000', current_balance_cents=10000, treasury_seed_cents=10000",
  );
  const influencer = new InfluencerLedger(sql);
  influencer.initialize(start);
  const creatorCode = `wlr-${usdc}`;
  db.prepare("INSERT INTO influencer_registry VALUES (?,?,?,?,?)").run(
    creatorCode,
    `direct:${usdc}`,
    "Creator",
    usdc,
    start,
  );
  // Signature/first-order validation is covered in influencer-ledger.test.ts.
  db.prepare("INSERT INTO influencer_links VALUES (?,?,?,?)").run(
    sol,
    creatorCode,
    INFLUENCER_POLICY,
    start,
  );
  const register = (
    id: string,
    registeredAt = start,
    questlineQuestId?: 89,
  ) => {
    coordinator.registerJupiterOrder(
      {
        requestId: id,
        questlineQuestId,
        walletAddress: sol,
        inputMint: sol,
        outputMint: usdc,
        inputAmountAtomic: "1000000000",
        outputAmountAtomic: "100000000",
        feeMint: usdc,
        quotedFeeAmountAtomic: "500000",
        referralAccount: sol,
        referralFeeBps: 50,
        partnerShareBps: 8000,
        valuationUsdDecimal: "100",
        valuationAmountAtomic: "100000000",
        registeredAt,
        expiresAt: "2026-10-12T14:05:00.000Z",
      },
      rules,
    );
  };
  const evidence = (id: string, confirmedAt = "2026-10-12T14:00:05.000Z") =>
    JupiterSwapExecutionEvidenceSchema.parse({
      requestId: id,
      transactionHash: id.padEnd(88, "1"),
      inputAmountResult: "1000000000",
      outputAmountResult: "100000000",
      totalInputAmount: "1000000000",
      totalOutputAmount: "99500000",
      confirmedAt,
    });
  register("new", start, 89);
  const result = await coordinator.creditJupiterExecution(
    evidence("new"),
    rules,
  );
  expect(result).toMatchObject({
    feeReserveAmountAtomic: "44000",
    prizePoolContributionMicroUsd: "356000",
    wltPointsCredited: "2",
  });
  expect(
    await coordinator.creditJupiterExecution(evidence("new"), rules),
  ).toMatchObject({ duplicate: true });
  expect(
    coordinator.getFeeReserveReport(start).balances[0]?.reservedAtomic,
  ).toBe("44000");
  expect(
    db.prepare("SELECT walletor_fee_atomic FROM referral_fee_ledger").get()
      ?.walletor_fee_atomic,
  ).toBe("400000");
  expect(
    db
      .prepare(
        "SELECT influencer_atomic,segmento_atomic FROM influencer_commissions",
      )
      .all(),
  ).toEqual([{ influencer_atomic: "40000", segmento_atomic: "0" }]);
  // Late recovery of a pre-activation execution receives its original full pool credit.
  register("old", "2026-10-12T13:59:00.000Z");
  const old = await coordinator.creditJupiterExecution(
    evidence("old", "2026-10-12T13:59:55.000Z"),
    rules,
  );
  expect(old.prizePoolContributionMicroUsd).toBe("400000");
  const pool = db.prepare("SELECT * FROM pool_state").get();
  expect(pool?.current_balance_microusd).toBe("100756000");
  expect(pool?.treasury_seed_cents).toBe(10000);
  expect(pool?.total_collected_microusd).toBe("800000");
  expect(pool?.organic_contributions_microusd).toBe("756000");
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM influencer_commissions").get()?.n,
  ).toBe(1);
  // Force a late failure after the reserve write; all credit writes must roll back.
  register("failed", start, 89);
  db.exec(
    "CREATE TRIGGER test_fail BEFORE INSERT ON referral_fee_ledger WHEN NEW.request_id = 'failed' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  await expect(
    coordinator.creditJupiterExecution(evidence("failed"), rules),
  ).rejects.toThrow("test failure");
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM questline_verified_swaps").get()?.n,
  ).toBe(1);
  expect(
    coordinator.getFeeReserveReport(start).balances[0]?.reservedAtomic,
  ).toBe("44000");
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM influencer_commissions").get()?.n,
  ).toBe(1);
  db.exec("DROP TRIGGER test_fail");
  coordinator.stageJupiterExecution(evidence("failed"));
  await coordinator.retryJupiterExecution(
    evidence("failed").transactionHash,
    rules,
  );
  expect(
    coordinator.getFeeReserveReport(start).balances[0]?.reservedAtomic,
  ).toBe("88000");
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM influencer_commissions").get()?.n,
  ).toBe(2);
  expect(
    influencer.report(
      {
        from: "2026-10-12T00:00:00.000Z",
        to: "2026-10-13T00:00:00.000Z",
        after: 0,
      },
      start,
    ).lifetimeTotals[0],
  ).toMatchObject({
    influencerAtomic: "80000",
    platformAtomic: "0",
    receiptCount: 2,
  });
  db.prepare("UPDATE rounds SET status='LOCKED' WHERE round_id=?").run(
    result.roundId,
  );
  expect(
    coordinator
      .roundFeeSources(result.roundId)
      .map((r) => r.amountAtomic)
      .sort(),
  ).toEqual(["356000", "356000", "400000"]);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM questline_verified_swaps").get()?.n,
  ).toBe(2);
  const beforePush = db.prepare("SELECT * FROM pool_state").get();
  vi.setSystemTime("2026-10-12T14:01:00.000Z");
  const push = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ success: true }));
  expect(await coordinator.flushQuestlineCompletions()).toEqual({
    enabled: true,
    attempted: 1,
    accepted: 1,
  });
  expect(await coordinator.flushQuestlineCompletions()).toEqual({
    enabled: true,
    attempted: 0,
    accepted: 0,
  });
  expect(push).toHaveBeenCalledOnce();
  expect(db.prepare("SELECT * FROM pool_state").get()).toEqual(beforePush);
  expect(coordinator.getQuestlineStatus().counts).toEqual([
    { status: "ACCEPTED", count: 1 },
  ]);
});
