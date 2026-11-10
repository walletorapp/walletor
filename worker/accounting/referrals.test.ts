// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { REFERRAL_SQL, WalletReferrals, type ReferralSql } from "./referrals";
import { referralMessage } from "../../shared/referral-contracts";
import {
  buildPrizeDrawSnapshot,
  selectPrizeDrawWinners,
  type PrizeDrawParticipantInput,
} from "./draw";
import { REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION } from "../../shared/prize-draw-contracts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(REFERRAL_SQL);
  db.exec(
    "CREATE TABLE participants(round_id TEXT,wallet_address TEXT,actual_swap_count INTEGER,eligible_swap_count INTEGER); INSERT INTO wallet_referral_policy VALUES(1,'2026-09-16T00:00:00.000Z')",
  );
  const sql: ReferralSql = {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: (string | number)[]
    ) {
      const statement = db.prepare(query);
      const rows = statement.all(...bindings).map((row) => row as T);
      const changed = db.prepare("SELECT changes() AS count").get();
      return {
        rowsWritten: Number(changed?.count ?? 0),
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1 || !rows[0])
            throw new Error("Expected one SQL row");
          return rows[0];
        },
      };
    },
  };
  return { db, store: new WalletReferrals(sql) };
}
const joinedAt = "2026-09-16T01:00:00.000Z";
function join(store: WalletReferrals, owner: string, user: Keypair) {
  const code = store.code(owner);
  const wallet = user.publicKey.toBase58();
  const challenge = store.challenge(wallet, code, joinedAt);
  const signature = bs58.encode(
    ed25519.sign(
      new TextEncoder().encode(challenge.message),
      user.secretKey.slice(0, 32),
    ),
  );
  const proof = {
    walletAddress: wallet,
    code,
    nonce: challenge.nonce,
    signature,
  };
  store.join(proof, joinedAt);
  return proof;
}
describe("wallet referral accounting", () => {
  it("does not retroactively qualify an earlier order or a later eligible swap", () => {
    const { store, db } = setup();
    const owner = Keypair.generate().publicKey.toBase58();
    const user = Keypair.generate();
    join(store, owner, user);
    const wallet = user.publicKey.toBase58();
    db.prepare("INSERT INTO participants VALUES(?,?,1,1)").run("round", wallet);
    expect(
      store.award(
        wallet,
        "round",
        "earlier-order",
        "2026-09-16T01:02:00.000Z",
        "2026-09-16T00:59:00.000Z",
      ),
    ).toBeNull();
    db.prepare(
      "UPDATE participants SET actual_swap_count=2,eligible_swap_count=2 WHERE wallet_address=?",
    ).run(wallet);
    expect(
      store.award(wallet, "round", "later-order", "2026-09-16T01:03:00.000Z"),
    ).toBeNull();
    expect(store.count(owner)).toBe(0);
    const other = Keypair.generate();
    join(store, owner, other);
    db.prepare("INSERT INTO participants VALUES(?,?,2,1)").run(
      "round",
      other.publicKey.toBase58(),
    );
    expect(
      store.award(
        other.publicKey.toBase58(),
        "round",
        "first-eligible-after-small-swap",
        "2026-09-16T01:03:00.000Z",
      ),
    ).toBe(owner);
  });
  it("allocates permanent unique links and requires a wallet signature", () => {
    const { store } = setup();
    const owner = Keypair.generate().publicKey.toBase58();
    const user = Keypair.generate();
    expect(store.code(owner)).toBe(store.code(owner));
    expect(store.code(user.publicKey.toBase58())).not.toBe(store.code(owner));
    const code = store.code(owner);
    const challenge = store.challenge(
      user.publicKey.toBase58(),
      code,
      joinedAt,
    );
    expect(challenge.message).toBe(
      referralMessage(
        user.publicKey.toBase58(),
        code,
        challenge.nonce,
        challenge.expiresAt,
      ),
    );
    expect(() => {
      store.join(
        {
          walletAddress: user.publicKey.toBase58(),
          code,
          nonce: challenge.nonce,
          signature: bs58.encode(new Uint8Array(64)),
        },
        joinedAt,
      );
    }).toThrow(/signature/);
    const proof = join(store, owner, user);
    expect(store.joined(user.publicKey.toBase58())).toBe(true);
    expect(() => {
      store.join(proof, joinedAt);
    }).toThrow(/expired/);
  });
  it("rejects self-referrals, unknown codes, existing traders and expired messages", () => {
    const { store, db } = setup();
    const user = Keypair.generate();
    const wallet = user.publicKey.toBase58();
    const ownCode = store.code(wallet);
    expect(() => store.challenge(wallet, ownCode, joinedAt)).toThrow(
      /own wallet/,
    );
    expect(() => store.challenge(wallet, "a".repeat(32), joinedAt)).toThrow(
      /not valid/,
    );
    const code = store.code(Keypair.generate().publicKey.toBase58());
    const challenge = store.challenge(wallet, code, joinedAt);
    expect(() => {
      store.join(
        {
          walletAddress: wallet,
          code,
          nonce: challenge.nonce,
          signature: bs58.encode(new Uint8Array(64)),
        },
        "2026-09-16T01:06:00.000Z",
      );
    }).toThrow(/expired/);
    db.prepare("INSERT INTO participants VALUES(?,?,1,0)").run("older", wallet);
    expect(() => store.challenge(wallet, code, joinedAt)).toThrow(
      /first Walletor swap/,
    );
  });
  it("records only one qualification and keeps attribution and reward evidence immutable", () => {
    const { store, db } = setup();
    const owner = Keypair.generate().publicKey.toBase58();
    const user = Keypair.generate();
    join(store, owner, user);
    const wallet = user.publicKey.toBase58();
    db.prepare("INSERT INTO participants VALUES(?,?,1,1)").run("round", wallet);
    expect(
      store.award(wallet, "round", "tx", "2026-09-16T00:59:00.000Z"),
    ).toBeNull();
    expect(store.award(wallet, "round", "tx", joinedAt)).toBe(owner);
    expect(store.award(wallet, "other", "tx2", joinedAt)).toBeNull();
    expect(store.count(owner)).toBe(1);
    expect(
      store.state(owner, {
        round_id: "round",
        start_time: "2026-09-16T00:00:00.000Z",
        end_time: "2026-09-17T00:00:00.000Z",
      }).bonusPoints,
    ).toBe("100");
    expect(() => {
      db.exec("UPDATE wallet_referrals SET joined_at='changed'");
    }).toThrow(/immutable/);
    expect(() => {
      db.exec("DELETE FROM wallet_referral_rewards");
    }).toThrow(/immutable/);
  });
  it("caps round boost at 50%, requires own eligibility and never boosts earlier rounds", () => {
    const { store, db } = setup();
    const owner = Keypair.generate().publicKey.toBase58();
    for (let i = 0; i < 7; i++) {
      const user = Keypair.generate();
      join(store, owner, user);
      db.prepare("INSERT INTO participants VALUES(?,?,1,1)").run(
        "daily",
        user.publicKey.toBase58(),
      );
      store.award(
        user.publicKey.toBase58(),
        "daily",
        `tx${String(i)}`,
        joinedAt,
      );
    }
    expect(store.boost(owner, "daily", "2026-09-15T00:00:00.000Z")).toBe(0);
    expect(store.boost(owner, "next", "2026-09-17T00:00:00.000Z")).toBe(0);
    const round = {
      round_id: "daily",
      start_time: "2026-09-16T00:00:00.000Z",
      end_time: "2026-09-17T00:00:00.000Z",
    };
    expect(store.state(owner, round).boostBps).toBe(0);
    db.prepare("INSERT INTO participants VALUES(?,?,1,1)").run("daily", owner);
    expect(store.state(owner, round).boostBps).toBe(5000);
  });
});

it("freezes V4 referral weights in proofs, preserves fee leaders and rejects boosts on V3", async () => {
  const inputs: PrizeDrawParticipantInput[] = Array.from(
    { length: 5 },
    (_, i) => ({
      walletAddress: Keypair.generate().publicKey.toBase58(),
      eligibleSwapCount: 1,
      eligibleVolumeCents: 1000n,
      eligibleFeeContributionMicroUsd: BigInt(100 - i * 10),
      multiplierBps: 10000,
      referralBoostBps: i === 3 ? 5000 : 0,
    }),
  );
  await expect(buildPrizeDrawSnapshot("round", 4, inputs)).rejects.toThrow(
    /V4/,
  );
  const baseline = await buildPrizeDrawSnapshot(
    "round",
    4,
    inputs.map((p) => ({ ...p, referralBoostBps: 0 })),
    REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION,
  );
  const boosted = await buildPrizeDrawSnapshot(
    "round",
    4,
    inputs,
    REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION,
  );
  const wallet = inputs[3]?.walletAddress;
  expect(
    boosted.participants.find((p) => p.walletAddress === wallet)?.weight,
  ).toBe(105n);
  expect(boosted.participantMerkleRoot).not.toBe(
    baseline.participantMerkleRoot,
  );
  const winners = await selectPrizeDrawWinners(boosted, "ab".repeat(32));
  expect(winners.slice(0, 2).map((w) => w.walletAddress)).toEqual(
    inputs.slice(0, 2).map((p) => p.walletAddress),
  );
  expect(new Set(winners.map((w) => w.walletAddress)).size).toBe(4);
});
