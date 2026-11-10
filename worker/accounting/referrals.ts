import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";
import {
  referralMessage,
  REFERRAL_POINTS,
  ReferralProofSchema,
  ReferralStateSchema,
  type ReferralProof,
} from "../../shared/referral-contracts";

export const REFERRAL_SQL = `
CREATE TABLE IF NOT EXISTS wallet_referral_codes(wallet_address TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS wallet_referral_challenges(wallet_address TEXT PRIMARY KEY, code TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wallet_referrals(wallet_address TEXT PRIMARY KEY, referrer_address TEXT NOT NULL, joined_at TEXT NOT NULL, CHECK(wallet_address != referrer_address));
CREATE TABLE IF NOT EXISTS wallet_referral_rewards(wallet_address TEXT PRIMARY KEY, referrer_address TEXT NOT NULL, round_id TEXT NOT NULL, transaction_hash TEXT NOT NULL UNIQUE, awarded_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS wallet_referral_rewards_owner ON wallet_referral_rewards(referrer_address, round_id);
CREATE TABLE IF NOT EXISTS wallet_referral_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1), boost_starts_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS wallet_referrals_immutable BEFORE UPDATE ON wallet_referrals BEGIN SELECT RAISE(ABORT,'Referral attribution is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wallet_referrals_no_delete BEFORE DELETE ON wallet_referrals BEGIN SELECT RAISE(ABORT,'Referral attribution is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wallet_referral_rewards_immutable BEFORE UPDATE ON wallet_referral_rewards BEGIN SELECT RAISE(ABORT,'Referral reward is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wallet_referral_rewards_no_delete BEFORE DELETE ON wallet_referral_rewards BEGIN SELECT RAISE(ABORT,'Referral reward is immutable'); END;
`;

function reject(message: string): never {
  throw new ApiFailure(400, "REFERRAL_NOT_AVAILABLE", message, false);
}
export function referralCode(wallet: string): string {
  if (!isSolanaAddress(wallet)) reject("Connect a valid Solana wallet.");
  return Array.from(
    sha256(new TextEncoder().encode(`walletor:referral:v1:${wallet}`)).slice(
      0,
      16,
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}

export interface ReferralSql {
  exec<
    T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: (string | number)[]
  ): Pick<SqlStorageCursor<T>, "toArray" | "one" | "rowsWritten">;
}
export class WalletReferrals {
  constructor(private readonly sql: ReferralSql) {}
  code(wallet: string): string {
    const code = referralCode(wallet);
    this.sql.exec(
      "INSERT OR IGNORE INTO wallet_referral_codes(wallet_address,code) VALUES (?,?)",
      wallet,
      code,
    );
    const registered = this.sql
      .exec<{ code: string }>(
        "SELECT code FROM wallet_referral_codes WHERE wallet_address=?",
        wallet,
      )
      .toArray()[0];
    if (!registered) throw new Error("Referral code could not be allocated.");
    return registered.code;
  }
  joined(wallet: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM wallet_referrals WHERE wallet_address=?", wallet)
        .toArray().length > 0
    );
  }
  hasActivity(wallet: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM participants WHERE wallet_address=? AND actual_swap_count>0 LIMIT 1",
          wallet,
        )
        .toArray().length > 0
    );
  }
  private owner(code: string): string {
    const owner = this.sql
      .exec<{ wallet_address: string }>(
        "SELECT wallet_address FROM wallet_referral_codes WHERE code=?",
        code,
      )
      .toArray()[0];
    if (!owner) reject("This referral link is not valid.");
    return owner.wallet_address;
  }
  challenge(wallet: string, code: string, now: string) {
    if (!isSolanaAddress(wallet)) reject("Connect a valid Solana wallet.");
    if (this.owner(code) === wallet)
      reject("You cannot refer your own wallet.");
    if (this.joined(wallet) || this.hasActivity(wallet))
      reject(
        "Referrals must be registered before your first Walletor swap, and can only be registered once.",
      );
    const previous = this.sql
      .exec<{ nonce: string; expires_at: string; code: string }>(
        "SELECT nonce,expires_at,code FROM wallet_referral_challenges WHERE wallet_address=?",
        wallet,
      )
      .toArray()[0];
    if (previous && previous.expires_at > now) {
      if (previous.code !== code)
        reject(
          "A referral signature request is already open. Wait five minutes before changing it.",
        );
      return {
        nonce: previous.nonce,
        expiresAt: previous.expires_at,
        message: referralMessage(
          wallet,
          code,
          previous.nonce,
          previous.expires_at,
        ),
      };
    }
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.parse(now) + 5 * 60_000).toISOString();
    this.sql.exec(
      "INSERT INTO wallet_referral_challenges(wallet_address,code,nonce,expires_at) VALUES (?,?,?,?) ON CONFLICT(wallet_address) DO UPDATE SET code=excluded.code,nonce=excluded.nonce,expires_at=excluded.expires_at",
      wallet,
      code,
      nonce,
      expiresAt,
    );
    return {
      nonce,
      expiresAt,
      message: referralMessage(wallet, code, nonce, expiresAt),
    };
  }
  join(raw: ReferralProof, now: string): void {
    const proof = ReferralProofSchema.parse(raw);
    const challenge = this.sql
      .exec<{ nonce: string; expires_at: string; code: string }>(
        "SELECT nonce,expires_at,code FROM wallet_referral_challenges WHERE wallet_address=?",
        proof.walletAddress,
      )
      .toArray()[0];
    if (
      challenge?.nonce !== proof.nonce ||
      challenge.code !== proof.code ||
      challenge.expires_at <= now
    )
      reject("Referral signature expired. Request a new message.");
    let valid: boolean;
    try {
      valid = ed25519.verify(
        bs58.decode(proof.signature),
        new TextEncoder().encode(
          referralMessage(
            proof.walletAddress,
            proof.code,
            proof.nonce,
            challenge.expires_at,
          ),
        ),
        bs58.decode(proof.walletAddress),
      );
    } catch {
      valid = false;
    }
    if (!valid) reject("The referral signature does not match this wallet.");
    const owner = this.owner(proof.code);
    if (
      owner === proof.walletAddress ||
      this.joined(proof.walletAddress) ||
      this.hasActivity(proof.walletAddress)
    )
      reject("This wallet is not eligible for a new referral.");
    this.sql.exec(
      "INSERT INTO wallet_referrals(wallet_address,referrer_address,joined_at) VALUES (?,?,?)",
      proof.walletAddress,
      owner,
      now,
    );
    this.sql.exec(
      "DELETE FROM wallet_referral_challenges WHERE wallet_address=?",
      proof.walletAddress,
    );
  }
  award(
    wallet: string,
    roundId: string,
    transaction: string,
    confirmedAt: string,
    startedAt: string = confirmedAt,
  ): string | null {
    const relation = this.sql
      .exec<{ referrer_address: string; joined_at: string }>(
        "SELECT referrer_address,joined_at FROM wallet_referrals WHERE wallet_address=?",
        wallet,
      )
      .toArray()[0];
    if (!relation || relation.joined_at > startedAt) return null;
    const eligible = this.sql
      .exec<{ count: number }>(
        "SELECT COALESCE(SUM(eligible_swap_count),0) AS count FROM participants WHERE wallet_address=?",
        wallet,
      )
      .one().count;
    if (eligible !== 1) return null;
    const inserted = this.sql.exec(
      "INSERT OR IGNORE INTO wallet_referral_rewards(wallet_address,referrer_address,round_id,transaction_hash,awarded_at) VALUES (?,?,?,?,?)",
      wallet,
      relation.referrer_address,
      roundId,
      transaction,
      confirmedAt,
    );
    return inserted.rowsWritten > 0 ? relation.referrer_address : null;
  }
  startsAt(): string {
    return this.sql
      .exec<{ boost_starts_at: string }>(
        "SELECT boost_starts_at FROM wallet_referral_policy WHERE singleton=1",
      )
      .one().boost_starts_at;
  }
  count(wallet: string, roundId?: string): number {
    return this.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM wallet_referral_rewards WHERE referrer_address=?${roundId ? " AND round_id=?" : ""}`,
        wallet,
        ...(roundId ? [roundId] : []),
      )
      .one().count;
  }
  boost(wallet: string, roundId: string, roundStart: string): number {
    return roundStart >= this.startsAt()
      ? Math.min(this.count(wallet, roundId), 5) * 1000
      : 0;
  }
  state(
    wallet: string,
    round: { round_id: string; start_time: string; end_time: string },
  ) {
    const count = this.count(wallet);
    const eligible =
      this.sql
        .exec(
          "SELECT 1 FROM participants WHERE round_id=? AND wallet_address=? AND eligible_swap_count>0",
          round.round_id,
          wallet,
        )
        .toArray().length > 0;
    return ReferralStateSchema.parse({
      walletAddress: wallet,
      code: this.code(wallet),
      qualifiedReferrals: count,
      bonusPoints: (BigInt(count) * BigInt(REFERRAL_POINTS)).toString(),
      joined: this.joined(wallet),
      canJoin: !this.joined(wallet) && !this.hasActivity(wallet),
      activeRoundId: round.round_id,
      roundEndsAt: round.end_time,
      boostStartsAt: this.startsAt(),
      roundQualifiedReferrals: this.count(wallet, round.round_id),
      boostBps: eligible
        ? this.boost(wallet, round.round_id, round.start_time)
        : 0,
      eligibleForBoost: eligible,
    });
  }
}
