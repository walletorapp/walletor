import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import {
  INFLUENCER_POLICY,
  InfluencerProofSchema,
  InfluencerRequestSchema,
  InfluencerReportQuerySchema,
  InfluencerReportSchema,
  InfluencerStatusSchema,
  InfluencerProfileSchema,
  influencerCode,
  influencerName,
  isDirectInfluencerCode,
  influencerMessage,
  type InfluencerProof,
  type InfluencerReportQuery,
} from "../../shared/influencer-contracts";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";
import { splitAffiliateFee } from "./affiliate-commission";

interface Sql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): T[] };
}
export const INFLUENCER_SQL = `
CREATE TABLE IF NOT EXISTS influencer_policy (policy TEXT PRIMARY KEY, starts_at TEXT NOT NULL, kol_bps INTEGER NOT NULL, platform_bps_of_kol INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS influencer_registry (code TEXT PRIMARY KEY, influencer_id TEXT NOT NULL, name TEXT NOT NULL, owner_wallet TEXT NOT NULL, approved_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS influencer_challenges (wallet_address TEXT NOT NULL, purpose TEXT NOT NULL, code TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, PRIMARY KEY(wallet_address,purpose));
CREATE INDEX IF NOT EXISTS influencer_challenges_expiry ON influencer_challenges(expires_at);
CREATE TABLE IF NOT EXISTS influencer_links (wallet_address TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES influencer_registry(code), policy TEXT NOT NULL REFERENCES influencer_policy(policy), joined_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS influencer_commissions (id INTEGER PRIMARY KEY, chain_id TEXT NOT NULL, transaction_hash TEXT NOT NULL, wallet_address TEXT NOT NULL, code TEXT NOT NULL, policy TEXT NOT NULL, fee_mint TEXT NOT NULL, gross_atomic TEXT NOT NULL, influencer_atomic TEXT NOT NULL, segmento_atomic TEXT NOT NULL, confirmed_at TEXT NOT NULL, UNIQUE(chain_id,transaction_hash), FOREIGN KEY(chain_id,transaction_hash) REFERENCES fee_reserve_receipts(chain_id,transaction_hash));
CREATE INDEX IF NOT EXISTS influencer_commissions_code_time ON influencer_commissions(code,confirmed_at,id);
CREATE INDEX IF NOT EXISTS influencer_commissions_time ON influencer_commissions(confirmed_at,id);
CREATE TABLE IF NOT EXISTS influencer_totals (code TEXT NOT NULL, fee_mint TEXT NOT NULL, day TEXT NOT NULL, gross_atomic TEXT NOT NULL, influencer_atomic TEXT NOT NULL, segmento_atomic TEXT NOT NULL, receipt_count INTEGER NOT NULL, PRIMARY KEY(code,fee_mint,day));
CREATE INDEX IF NOT EXISTS influencer_totals_day ON influencer_totals(day,code);
CREATE TRIGGER IF NOT EXISTS influencer_links_no_update BEFORE UPDATE ON influencer_links BEGIN SELECT RAISE(ABORT,'Lifetime attribution is immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_links_no_delete BEFORE DELETE ON influencer_links BEGIN SELECT RAISE(ABORT,'Lifetime attribution is immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_registry_no_update BEFORE UPDATE ON influencer_registry BEGIN SELECT RAISE(ABORT,'Influencer ownership is immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_registry_no_delete BEFORE DELETE ON influencer_registry BEGIN SELECT RAISE(ABORT,'Influencer ownership is immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_policy_no_update BEFORE UPDATE ON influencer_policy BEGIN SELECT RAISE(ABORT,'Influencer policy is immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_policy_no_delete BEFORE DELETE ON influencer_policy BEGIN SELECT RAISE(ABORT,'Influencer policy is immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_commissions_no_update BEFORE UPDATE ON influencer_commissions BEGIN SELECT RAISE(ABORT,'Commission receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS influencer_commissions_no_delete BEFORE DELETE ON influencer_commissions BEGIN SELECT RAISE(ABORT,'Commission receipts are immutable'); END;
`;
function reject(message: string): never {
  throw new ApiFailure(400, "INFLUENCER_REFERRAL_UNAVAILABLE", message, false);
}
function validWallet(wallet: string) {
  if (!isSolanaAddress(wallet)) reject("Use a valid Solana wallet.");
}
interface RegistryRow extends Record<string, SqlStorageValue> {
  code: string;
  influencer_id: string;
  name: string;
  owner_wallet: string;
}
interface CommissionRow extends Record<string, SqlStorageValue> {
  id: number;
  chain_id: string;
  transaction_hash: string;
  wallet_address: string;
  code: string;
  fee_mint: string;
  gross_atomic: string;
  influencer_atomic: string;
  segmento_atomic: string;
  confirmed_at: string;
}
interface TotalRow extends Record<string, SqlStorageValue> {
  code: string;
  fee_mint: string;
  gross_atomic: string;
  influencer_atomic: string;
  segmento_atomic: string;
  receipt_count: number;
}

export class InfluencerLedger {
  constructor(private readonly sql: Sql) {}
  initialize(now: string) {
    this.sql.exec(INFLUENCER_SQL);
    if (!Number.isFinite(Date.parse(now)))
      throw new Error("Invalid influencer activation time.");
    this.sql.exec(
      "INSERT OR IGNORE INTO influencer_policy VALUES (?,?,1000,0)",
      INFLUENCER_POLICY,
      now,
    );
    const policy = this.sql
      .exec<{ kol_bps: number; platform_bps_of_kol: number }>(
        "SELECT kol_bps,platform_bps_of_kol FROM influencer_policy WHERE policy=?",
        INFLUENCER_POLICY,
      )
      .toArray()[0];
    if (policy && (policy.kol_bps !== 1000 || policy.platform_bps_of_kol !== 0))
      throw new Error(
        "Lifetime commission rates do not match the immutable policy.",
      );
  }
  startsAt(): string | null {
    return (
      this.sql
        .exec<{ starts_at: string }>(
          "SELECT starts_at FROM influencer_policy WHERE policy=?",
          INFLUENCER_POLICY,
        )
        .toArray()[0]?.starts_at ?? null
    );
  }
  private creator(code: string) {
    if (!isDirectInfluencerCode(code)) return undefined;
    return this.sql
      .exec<RegistryRow>("SELECT * FROM influencer_registry WHERE code=?", code)
      .toArray()[0];
  }
  profile(wallet: string) {
    validWallet(wallet);
    const code = influencerCode(wallet);
    const creator = this.creator(code);
    const start = this.startsAt();
    if (!start) throw new Error("Direct influencer policy is not initialized.");
    return InfluencerProfileSchema.parse({
      registered: creator?.owner_wallet === wallet,
      code,
      name: creator?.name ?? null,
      referralUrl: `https://walletor.com/?ref=${encodeURIComponent(code)}`,
      startsAt: start,
      policy: INFLUENCER_POLICY,
      kolBps: 1000,
    });
  }
  private link(wallet: string) {
    return this.sql
      .exec<{ code: string; joined_at: string }>(
        "SELECT code,joined_at FROM influencer_links WHERE wallet_address=?",
        wallet,
      )
      .toArray()[0];
  }
  assertNativeReferral(wallet: string, nativeCode: string) {
    const link = this.link(wallet);
    if (!link) return;
    const nativeOwner = this.sql
      .exec<{ wallet_address: string }>(
        "SELECT wallet_address FROM wallet_referral_codes WHERE code=?",
        nativeCode,
      )
      .toArray()[0];
    if (nativeOwner?.wallet_address !== this.creator(link.code)?.owner_wallet)
      reject("This wallet is already registered with a different influencer.");
  }
  private canJoin(wallet: string, owner: string) {
    // Bind before the first order, so delayed confirmations cannot be captured.
    if (wallet === owner || this.link(wallet)) return false;
    if (
      this.sql
        .exec(
          "SELECT 1 FROM participants WHERE wallet_address=? AND actual_swap_count>0 LIMIT 1",
          wallet,
        )
        .toArray().length
    )
      return false;
    if (
      this.sql
        .exec(
          "SELECT 1 FROM jupiter_swap_orders WHERE json_extract(evidence_json,'$.walletAddress')=? LIMIT 1",
          wallet,
        )
        .toArray().length
    )
      return false;
    const native = this.sql
      .exec<{ referrer_address: string }>(
        "SELECT referrer_address FROM wallet_referrals WHERE wallet_address=?",
        wallet,
      )
      .toArray()[0];
    return !native || native.referrer_address === owner;
  }
  status(wallet: string, code: string) {
    validWallet(wallet);
    const creator = this.creator(code);
    return InfluencerStatusSchema.parse({
      approved: !!creator,
      name: creator?.name ?? null,
      canJoin:
        !!creator &&
        !!this.startsAt() &&
        this.canJoin(wallet, creator.owner_wallet),
      joined: this.link(wallet)?.code === code,
      startsAt: this.startsAt(),
      policy: INFLUENCER_POLICY,
      kolBps: 1000,
    });
  }
  challenge(
    raw: {
      walletAddress: string;
      code: string;
      purpose: "ENROLL" | "JOIN" | "REPORT";
    },
    now: string,
  ) {
    const input = InfluencerRequestSchema.parse(raw);
    validWallet(input.walletAddress);
    this.sql.exec("DELETE FROM influencer_challenges WHERE expires_at<=?", now);
    const creator = this.creator(input.code);
    if (input.purpose === "ENROLL") {
      if (
        input.code !== influencerCode(input.walletAddress) ||
        creator ||
        !this.startsAt()
      )
        reject("Use your own wallet to create a new influencer link.");
    } else if (!creator || !this.startsAt())
      reject("This creator is not registered for lifetime commissions yet.");
    if (
      input.purpose !== "ENROLL" &&
      (!creator ||
        (input.purpose === "JOIN"
          ? !this.canJoin(input.walletAddress, creator.owner_wallet)
          : input.walletAddress !== creator.owner_wallet))
    )
      reject("This wallet cannot perform this referral action.");
    const existing = this.sql
      .exec<{ code: string; nonce: string; expires_at: string }>(
        "SELECT code,nonce,expires_at FROM influencer_challenges WHERE wallet_address=? AND purpose=?",
        input.walletAddress,
        input.purpose,
      )
      .toArray()[0];
    if (existing && existing.expires_at > now && existing.code !== input.code)
      reject("An existing referral request must expire before changing codes.");
    const nonce =
      existing && existing.expires_at > now
        ? existing.nonce
        : crypto.randomUUID();
    const expiresAt =
      existing && existing.expires_at > now
        ? existing.expires_at
        : new Date(Date.parse(now) + 300_000).toISOString();
    this.sql.exec(
      "INSERT INTO influencer_challenges VALUES (?,?,?,?,?) ON CONFLICT(wallet_address,purpose) DO UPDATE SET code=excluded.code,nonce=excluded.nonce,expires_at=excluded.expires_at",
      input.walletAddress,
      input.purpose,
      input.code,
      nonce,
      expiresAt,
    );
    return {
      nonce,
      expiresAt,
      message: influencerMessage(input, nonce, expiresAt),
    };
  }
  private consume(
    raw: InfluencerProof,
    purpose: "ENROLL" | "JOIN" | "REPORT",
    now: string,
  ) {
    const proof = InfluencerProofSchema.parse(raw);
    validWallet(proof.walletAddress);
    const challenge = this.sql
      .exec<{ code: string; nonce: string; expires_at: string }>(
        "SELECT code,nonce,expires_at FROM influencer_challenges WHERE wallet_address=? AND purpose=?",
        proof.walletAddress,
        purpose,
      )
      .toArray()[0];
    if (
      proof.purpose !== purpose ||
      challenge?.code !== proof.code ||
      challenge.nonce !== proof.nonce ||
      challenge.expires_at <= now
    )
      reject("Referral signature expired or already used.");
    let verified: boolean;
    try {
      verified = ed25519.verify(
        bs58.decode(proof.signature),
        new TextEncoder().encode(
          influencerMessage(proof, proof.nonce, challenge.expires_at),
        ),
        bs58.decode(proof.walletAddress),
        { zip215: false },
      );
    } catch {
      verified = false;
    }
    if (!verified) reject("Signature does not match this wallet.");
    this.sql.exec(
      "DELETE FROM influencer_challenges WHERE wallet_address=? AND purpose=?",
      proof.walletAddress,
      purpose,
    );
    return proof;
  }
  enroll(raw: InfluencerProof, now: string) {
    const proof = this.consume(raw, "ENROLL", now);
    if (
      proof.code !== influencerCode(proof.walletAddress) ||
      this.creator(proof.code)
    )
      reject(
        "This influencer wallet is already registered or the code is invalid.",
      );
    this.sql.exec(
      "INSERT INTO influencer_registry VALUES (?,?,?,?,?)",
      proof.code,
      `direct:${proof.walletAddress}`,
      influencerName(proof.walletAddress),
      proof.walletAddress,
      now,
    );
    return this.profile(proof.walletAddress);
  }
  join(raw: InfluencerProof, now: string) {
    const proof = this.consume(raw, "JOIN", now);
    const creator = this.creator(proof.code);
    const start = this.startsAt();
    if (
      !creator ||
      !start ||
      now < start ||
      !this.canJoin(proof.walletAddress, creator.owner_wallet)
    )
      reject(
        "Referral must be registered once, before the wallet's first order.",
      );
    this.sql.exec(
      "INSERT INTO influencer_links VALUES (?,?,?,?)",
      proof.walletAddress,
      proof.code,
      INFLUENCER_POLICY,
      now,
    );
  }
  /** Called synchronously inside the authoritative fee-credit transaction.
   * Liabilities are earmarked WITHIN the 11% reserve, never deducted again. */
  credit(input: {
    wallet: string;
    orderStartedAt: string;
    confirmedAt: string;
    chainId: string;
    signature: string;
    mint: string;
    gross: bigint;
    reserved: bigint;
  }) {
    const start = this.startsAt();
    const link = this.link(input.wallet);
    if (
      !start ||
      !link ||
      input.orderStartedAt < start ||
      input.orderStartedAt < link.joined_at ||
      input.confirmedAt < input.orderStartedAt ||
      input.gross === 0n
    )
      return;
    // Fixed v1 terms, deliberately independent of hypothetical preview settings.
    const split = splitAffiliateFee(input.gross, {
      kolBps: 1000,
      platformBpsOfKol: 0,
    });
    if (split.kolAtomic + split.platformAtomic > input.reserved)
      throw new Error("Influencer liability exceeds reserved fees.");
    const reserve = this.sql
      .exec<{
        fee_mint: string;
        gross_atomic: string;
        reserved_atomic: string;
      }>(
        "SELECT fee_mint,gross_atomic,reserved_atomic FROM fee_reserve_receipts WHERE chain_id=? AND transaction_hash=?",
        input.chainId,
        input.signature,
      )
      .toArray()[0];
    if (
      reserve?.fee_mint !== input.mint ||
      reserve.gross_atomic !== input.gross.toString() ||
      reserve.reserved_atomic !== input.reserved.toString()
    )
      throw new Error("Commission is missing its verified reserve receipt.");
    this.sql.exec(
      "INSERT INTO influencer_commissions(chain_id,transaction_hash,wallet_address,code,policy,fee_mint,gross_atomic,influencer_atomic,segmento_atomic,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      input.chainId,
      input.signature,
      input.wallet,
      link.code,
      INFLUENCER_POLICY,
      input.mint,
      input.gross.toString(),
      split.kolAtomic.toString(),
      split.platformAtomic.toString(),
      input.confirmedAt,
    );
    for (const day of [
      "LIFETIME",
      new Date(input.confirmedAt).toISOString().slice(0, 10),
    ]) {
      const previous = this.sql
        .exec<TotalRow>(
          "SELECT * FROM influencer_totals WHERE code=? AND fee_mint=? AND day=?",
          link.code,
          input.mint,
          day,
        )
        .toArray()[0];
      this.sql.exec(
        "INSERT INTO influencer_totals VALUES (?,?,?,?,?,?,?) ON CONFLICT(code,fee_mint,day) DO UPDATE SET gross_atomic=excluded.gross_atomic,influencer_atomic=excluded.influencer_atomic,segmento_atomic=excluded.segmento_atomic,receipt_count=excluded.receipt_count",
        link.code,
        input.mint,
        day,
        (BigInt(previous?.gross_atomic ?? "0") + input.gross).toString(),
        (
          BigInt(previous?.influencer_atomic ?? "0") + split.kolAtomic
        ).toString(),
        (
          BigInt(previous?.segmento_atomic ?? "0") + split.platformAtomic
        ).toString(),
        (previous?.receipt_count ?? 0) + 1,
      );
    }
  }
  private totals(rows: TotalRow[], registry: RegistryRow[]) {
    const groups = new Map<
      string,
      {
        code: string;
        influencerId: string;
        name: string;
        feeMint: string;
        gross: bigint;
        kol: bigint;
        platform: bigint;
        count: number;
      }
    >();
    for (const r of rows) {
      const creator = registry.find((c) => c.code === r.code);
      if (!creator) throw new Error("Commission owner is missing.");
      const key = `${r.code}:${r.fee_mint}`;
      const group = groups.get(key) ?? {
        code: r.code,
        influencerId: creator.influencer_id,
        name: creator.name,
        feeMint: r.fee_mint,
        gross: 0n,
        kol: 0n,
        platform: 0n,
        count: 0,
      };
      group.gross += BigInt(r.gross_atomic);
      group.kol += BigInt(r.influencer_atomic);
      group.platform += BigInt(r.segmento_atomic);
      group.count += r.receipt_count;
      groups.set(key, group);
    }
    return [...groups.values()].map((g) => ({
      code: g.code,
      influencerId: g.influencerId,
      name: g.name,
      feeMint: g.feeMint,
      grossFeeAtomic: g.gross.toString(),
      influencerAtomic: g.kol.toString(),
      platformAtomic: g.platform.toString(),
      receiptCount: g.count,
    }));
  }
  report(raw: InfluencerReportQuery, now: string) {
    const query = InfluencerReportQuerySchema.parse(raw);
    const registry = this.sql
      .exec<RegistryRow>(
        "SELECT * FROM influencer_registry WHERE code LIKE 'wlr-%' AND (? IS NULL OR code=?) ORDER BY code",
        query.code ?? null,
        query.code ?? null,
      )
      .toArray();
    const lifetime = this.sql
      .exec<TotalRow>(
        "SELECT * FROM influencer_totals WHERE day='LIFETIME' AND (? IS NULL OR code=?) ORDER BY code,fee_mint",
        query.code ?? null,
        query.code ?? null,
      )
      .toArray();
    const period = this.sql
      .exec<TotalRow>(
        "SELECT * FROM influencer_totals WHERE day>=? AND day<? AND (? IS NULL OR code=?) ORDER BY code,fee_mint,day",
        query.from.slice(0, 10),
        query.to.slice(0, 10),
        query.code ?? null,
        query.code ?? null,
      )
      .toArray();
    const page = this.sql
      .exec<CommissionRow>(
        "SELECT * FROM influencer_commissions WHERE confirmed_at>=? AND confirmed_at<? AND id>? AND (? IS NULL OR code=?) ORDER BY id LIMIT 101",
        query.from,
        query.to,
        query.after,
        query.code ?? null,
        query.code ?? null,
      )
      .toArray();
    return InfluencerReportSchema.parse({
      policy: INFLUENCER_POLICY,
      startsAt: this.startsAt(),
      generatedAt: now,
      payoutMode: "MANUAL",
      paymentRecordingEnabled: false,
      registeredInfluencers: registry.map((r) => ({
        code: r.code,
        influencerId: r.influencer_id,
        name: r.name,
        ownerWallet: r.owner_wallet,
      })),
      query,
      periodTotals: this.totals(period, registry),
      lifetimeTotals: this.totals(lifetime, registry),
      receipts: page.slice(0, 100).map((r) => ({
        id: r.id,
        code: r.code,
        chainId: r.chain_id,
        transactionHash: r.transaction_hash,
        walletAddress: r.wallet_address,
        feeMint: r.fee_mint,
        grossFeeAtomic: r.gross_atomic,
        influencerAtomic: r.influencer_atomic,
        platformAtomic: r.segmento_atomic,
        confirmedAt: r.confirmed_at,
      })),
      nextCursor: page.length > 100 ? page[99]?.id : null,
    });
  }
  privateReport(
    proof: InfluencerProof,
    query: InfluencerReportQuery,
    now: string,
  ) {
    const signed = this.consume(proof, "REPORT", now);
    if (this.creator(signed.code)?.owner_wallet !== signed.walletAddress)
      reject("This wallet is not the registered influencer.");
    return this.report({ ...query, code: signed.code }, now);
  }
}
