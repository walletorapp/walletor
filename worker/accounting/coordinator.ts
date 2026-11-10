import { DurableObject } from "cloudflare:workers";
import { QuestlineLedger, recordQuestlineSwap } from "./questline";
import { readQuestlineConfig, deliverQuestline } from "../services/questline";
import { InfluencerLedger } from "./influencer-ledger";
import type {
  InfluencerProof,
  InfluencerReportQuery,
} from "../../shared/influencer-contracts";
import { FEE_RESERVE_BPS } from "../../shared/fee-reserve-contracts";
import {
  initializeFeeReserve,
  feeReserveStart,
  splitFeeReserve,
  recordFeeReserve,
  readFeeReserve,
} from "./fee-reserve";
import { readAffiliateReport } from "./affiliate-report";
import type { AffiliateReportQuery } from "../../shared/affiliate-report-contracts";
import {
  applyDailyPrizeSeed,
  PRIZE_SEED_SQL,
  seedCampaign,
  SEED_DAY_MS,
} from "./prize-seed";
import { PrizeSeedStateSchema } from "../../shared/prize-seed-contracts";
import {
  ZEALY_SCHEMA_SQL,
  ZealyVerificationSchema,
  verifyZealyDailySwap,
  type ZealyVerification,
} from "./zealy";
import { exportLedgerSql } from "./backup";
import { RANKINGS_SQL } from "./leaderboard";
import {
  RankingsSchema,
  type LeaderboardQuery,
} from "../../shared/leaderboard-contracts";
import { REFERRAL_SQL, WalletReferrals } from "./referrals";
import {
  REFERRAL_POINTS,
  type ReferralProof,
} from "../../shared/referral-contracts";
import { ADMIN_UNFUNDED_DRAWS_SQL } from "./admin-draws";
import {
  EARLY_CLOSE_ROUND_ID,
  isRollingDailyRound,
} from "../../shared/round-schedule";

import {
  type AdminCanaryRoundCloseResult,
  AdminLedgerSnapshotSchema,
  type AdminLedgerSnapshot,
  type AdminSwap,
} from "../../shared/admin-contracts";
import {
  ClaimRewardsStateSchema,
  JupiterSwapExecutionEvidenceSchema,
  JupiterSwapOrderEvidenceSchema,
  PrizePoolStateSchema,
  PublicDistributionCalendarSchema,
  PublicDistributionRoundDetailSchema,
  WalletEngineStateSchema,
  VerifiedSwapCreditInputSchema,
  VerifiedSwapCreditResultSchema,
  type ClaimRewardsState,
  type JupiterSwapExecutionEvidence,
  type JupiterSwapOrderEvidence,
  type PrizePoolState,
  type PublicDistributionCalendar,
  type PublicDistributionRoundDetail,
  type PublicRound,
  type WalletEngineState,
  type VerifiedSwapCreditInput,
  type VerifiedSwapCreditResult,
} from "../../shared/accounting-contracts";
import {
  LEGACY_PRIZE_DRAW_ALGORITHM_VERSION,
  PRIZE_DRAW_ALGORITHM_VERSION,
  REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION,
  WEIGHTED_PRIZE_DRAW_ALGORITHM_VERSION,
  PublicPrizeDrawSnapshotSchema,
  type PrizeDrawStatus,
  type PublicPrizeDrawSnapshot,
} from "../../shared/prize-draw-contracts";
import { buildPrizeDrawSnapshot } from "./draw";
import { evaluateSwapEligibility } from "./eligibility";
import { splitWalletorFee } from "./math";
import {
  deriveExecutedReferralFee,
  microUsdToCents,
  usdDecimalToCents,
} from "./jupiter";
import {
  allocateRoundRewards,
  calculateRewardWeight,
  calculateWltPoints,
  REWARD_TIERS,
  rewardTier,
  type RewardParticipant,
} from "./rewards";
import {
  canaryContinuationRoundWindow,
  rollingDailyRoundWindow,
  nextRoundWindow,
  alignedOpenRoundEnd,
  type RoundWindow,
  utcRoundWindow,
} from "./rounds";

export interface CoordinatorIdentity {
  poolId: string;
  chainId: string;
  chainFamily: "SOLANA" | "EVM";
  networkName: string;
}

export interface CoordinatorRules {
  accountingEnabled: boolean;
  prizePoolWinnerCount: number;
  prizePoolClaimFeeBps: number;
  chainId: string;
  treasuryAddress: string | null;
  feeAssetMint: string | null;
  standardSwapFeeAtomic: string | null;
  standardSwapFeeCents: string;
  advancedTradeFeeCents: string;
  prizePoolPercentageBps: string;
  platformRevenuePercentageBps: string;
  roundDurationHours: number;
  minimumRewardEligibleSwapCents: string;
  newWalletReviewDays: number;
  wltBasePointsPerEligibleSwap: string;
  referralAccount: string | null;
  referralFeeBps: number | null;
  partnerShareBps: number | null;
}

export type CanaryRoundCloseOutcome =
  | { status: "CLOSED"; result: AdminCanaryRoundCloseResult }
  | {
      status: "REJECTED";
      reason:
        | "ACTIVE_ROUND_CHANGED"
        | "ALREADY_SPLIT"
        | "NO_ELIGIBLE_PARTICIPANTS"
        | "EMPTY_PRIZE_POOL"
        | "OUTSIDE_ACTIVE_WINDOW";
    };

export interface PrizeDrawOperationalSummary {
  roundId: string;
  status: PrizeDrawStatus;
  participantCount: number;
  winnerCount: number;
  grossPoolCents: string;
  createdAt: string;
}

interface PoolRow extends Record<string, SqlStorageValue> {
  pool_id: string;
  chain_id: string;
  chain_family: "SOLANA" | "EVM";
  network_name: string;
  current_balance_cents: number;
  organic_contributions_cents: number;
  treasury_seed_cents: number;
  total_collected_cents: number;
  total_distributed_cents: number;
  platform_revenue_cents: number;
  remainder_carried_cents: number;
  active_round_id: string;
  distributions_paused: number;
  current_balance_microusd: string;
  organic_contributions_microusd: string;
  total_collected_microusd: string;
}

interface RoundRow extends Record<string, SqlStorageValue> {
  round_id: string;
  status: PublicRound["status"];
  start_time: string;
  end_time: string;
  locked_at: string | null;
  completed_at: string | null;
  total_pool_cents: number;
  total_eligible_swaps: number;
  total_eligible_volume_cents: number;
  eligible_wallet_count: number;
  allocation_checksum: string | null;
  remainder_cents: number;
  draw_winner_count: number;
  draw_claim_fee_bps: number;
}

interface ParticipantRow extends Record<string, SqlStorageValue> {
  wallet_address: string;
  actual_swap_count: number;
  eligible_swap_count: number;
  eligible_volume_cents: number;
  eligible_fee_contribution_microusd: string;
  multiplier_bps: number;
  last_eligible_swap_at: string | null;
}

interface LockedRoundSnapshot {
  round: RoundRow;
  lockedPoolCents: bigint;
  participants: ParticipantRow[];
}

interface JupiterOrderRow extends Record<string, SqlStorageValue> {
  request_id: string;
  evidence_json: string;
  status: "PENDING" | "CREDITED";
  transaction_hash: string | null;
  result_json: string | null;
  execution_evidence_json: string | null;
  accounting_error: string | null;
  accounting_attempts: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface AdminTraderRow extends Record<string, SqlStorageValue> {
  wallet_address: string;
  first_active_at: string | null;
  last_active_at: string | null;
  confirmed_swaps: number;
  eligible_swaps: number;
  eligible_volume_cents: number;
  lifetime_points: number;
  pending_points: number;
}

interface AdminReferralFeeRow extends Record<string, SqlStorageValue> {
  request_id: string;
  walletor_fee_atomic: string;
}

interface LegacyRewardCreditRow extends Record<string, SqlStorageValue> {
  transaction_hash: string;
  result_json: string;
  evidence_json: string;
  created_at: string;
}

interface ReferralFeeAssetRow extends Record<string, SqlStorageValue> {
  fee_mint: string;
  total_fee_atomic: string;
  walletor_fee_atomic: string;
  estimated_walletor_microusd: string;
}

interface ClaimAllocationRow extends Record<string, SqlStorageValue> {
  allocation_id: string;
  round_id: string;
  round_end_time: string;
  reward_cents: number;
  status:
    | "CLAIM_UNAVAILABLE_BETA"
    | "PENDING_PAYOUT"
    | "PROCESSING"
    | "PAID"
    | "FAILED"
    | "MANUAL_REVIEW";
  payout_transaction_hash: string | null;
  created_at: string;
}

interface PublicAllocationRow extends Record<string, SqlStorageValue> {
  allocation_id: string;
  wallet_address: string;
  eligible_swap_count: number;
  multiplier_bps: number;
  reward_cents: number;
  status: ClaimAllocationRow["status"];
  payout_transaction_hash: string | null;
  created_at: string;
}

interface PrizeDrawRow extends Record<string, SqlStorageValue> {
  round_id: string;
  status: PrizeDrawStatus;
  algorithm_version: string;
  configured_winner_count: number;
  winner_count: number;
  participant_count: number;
  total_weight: string;
  participant_checksum: string;
  participant_merkle_root: string;
  claim_fee_bps: number;
  randomness_account: string | null;
  commit_transaction_signature: string | null;
  reveal_transaction_signature: string | null;
  settlement_transaction_signature: string | null;
  created_at: string;
  updated_at: string;
}

interface PrizeDrawOperationalRow extends PrizeDrawRow {
  total_pool_cents: number;
  start_time: string;
}

interface PrizeDrawParticipantRow extends Record<string, SqlStorageValue> {
  participant_index: number;
  wallet_address: string;
  eligible_swap_count: number;
  eligible_volume_cents: string;
  eligible_fee_contribution_microusd: string;
  multiplier_bps: 10_000 | 11_000 | 12_500 | 15_000;
  weight: string;
  range_start: string;
  range_end: string;
  leaf_hash: string;
}

const DISTRIBUTION_EXPLANATION =
  "Allocations are calculated automatically from published confirmed-swap counts, deterministic tiers, and a sublinear volume score. No team member or hidden AI selects recipients or can replace a finalized allocation; each finalized round publishes an allocation checksum.";
const VALUATION_EXPLANATION =
  "USD values are quote-time estimates; the ledger preserves each confirmed Jupiter referral fee in exact atomic token units.";

function toSafeInteger(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the supported integer range.`);
  }
  return Number(value);
}

function centsToUsdDecimal(value: string): string {
  const cents = BigInt(value);
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}`;
}

function parseJsonResult(value: string): VerifiedSwapCreditResult {
  const parsed = VerifiedSwapCreditResultSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error("Stored swap result is invalid.");
  return parsed.data;
}

function parseJupiterOrderEvidence(value: string): JupiterSwapOrderEvidence {
  const parsed = JupiterSwapOrderEvidenceSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error("Stored Jupiter order is invalid.");
  return parsed.data;
}

export class PrizePoolCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => {
      this.migrate();
      return Promise.resolve();
    });
  }

  private migrate(): void {
    initializeFeeReserve(this.ctx.storage.sql, new Date().toISOString());
    this.ctx.storage.sql.exec(PRIZE_SEED_SQL);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations",
      )
      .one().version;
    if (version < 1) {
      this.ctx.storage.sql.exec(`
      CREATE TABLE pool_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        pool_id TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        chain_family TEXT NOT NULL,
        network_name TEXT NOT NULL,
        current_balance_cents INTEGER NOT NULL,
        organic_contributions_cents INTEGER NOT NULL,
        treasury_seed_cents INTEGER NOT NULL,
        total_collected_cents INTEGER NOT NULL,
        total_distributed_cents INTEGER NOT NULL,
        platform_revenue_cents INTEGER NOT NULL,
        remainder_carried_cents INTEGER NOT NULL,
        active_round_id TEXT NOT NULL,
        distributions_paused INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE rounds (
        round_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        locked_at TEXT,
        completed_at TEXT,
        total_pool_cents INTEGER NOT NULL,
        total_eligible_swaps INTEGER NOT NULL,
        total_eligible_volume_cents INTEGER NOT NULL,
        eligible_wallet_count INTEGER NOT NULL,
        allocation_checksum TEXT,
        remainder_cents INTEGER NOT NULL,
        failure_reason TEXT,
        closure_idempotency_key TEXT NOT NULL UNIQUE,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE participants (
        round_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        actual_swap_count INTEGER NOT NULL,
        eligible_swap_count INTEGER NOT NULL,
        eligible_volume_cents INTEGER NOT NULL,
        multiplier_bps INTEGER NOT NULL,
        achieved_tier INTEGER NOT NULL,
        next_tier INTEGER,
        swaps_until_next_tier INTEGER NOT NULL,
        calculated_weight INTEGER NOT NULL,
        last_eligible_swap_at TEXT,
        flagged_for_review INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (round_id, wallet_address)
      );
      CREATE TABLE processed_swaps (
        chain_id TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        swap_id TEXT NOT NULL UNIQUE,
        round_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (chain_id, transaction_hash)
      );
      CREATE TABLE ledger (
        ledger_entry_id TEXT PRIMARY KEY,
        round_id TEXT,
        chain_id TEXT NOT NULL,
        transaction_hash TEXT,
        action TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE allocations (
        allocation_id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        eligible_swap_count INTEGER NOT NULL,
        eligible_volume_cents INTEGER NOT NULL,
        multiplier_bps INTEGER NOT NULL,
        calculated_weight INTEGER NOT NULL,
        share_numerator TEXT NOT NULL,
        share_denominator TEXT NOT NULL,
        reward_cents INTEGER NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        UNIQUE (round_id, wallet_address)
      );
      CREATE TABLE wlt_balances (
        wallet_address TEXT PRIMARY KEY,
        lifetime_points INTEGER NOT NULL,
        pending_points INTEGER NOT NULL,
        converted_points INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE wlt_ledger (
        entry_id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        source_transaction TEXT NOT NULL,
        delta INTEGER NOT NULL,
        resulting_balance INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN
        SELECT RAISE(ABORT, 'ledger is append-only');
      END;
      CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN
        SELECT RAISE(ABORT, 'ledger is append-only');
      END;
      CREATE TRIGGER wlt_ledger_no_update BEFORE UPDATE ON wlt_ledger BEGIN
        SELECT RAISE(ABORT, 'wlt_ledger is append-only');
      END;
      CREATE TRIGGER wlt_ledger_no_delete BEFORE DELETE ON wlt_ledger BEGIN
        SELECT RAISE(ABORT, 'wlt_ledger is append-only');
      END;
      INSERT INTO _sql_schema_migrations (id, applied_at)
      VALUES (1, datetime('now'));
      `);
    }

    if (version < 2) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE pool_state
          ADD COLUMN current_balance_microusd TEXT NOT NULL DEFAULT '0';
        ALTER TABLE pool_state
          ADD COLUMN organic_contributions_microusd TEXT NOT NULL DEFAULT '0';
        ALTER TABLE pool_state
          ADD COLUMN total_collected_microusd TEXT NOT NULL DEFAULT '0';
        UPDATE pool_state SET
          current_balance_microusd = CAST(current_balance_cents AS TEXT) || '0000',
          organic_contributions_microusd = CAST(organic_contributions_cents AS TEXT) || '0000',
          total_collected_microusd = CAST(total_collected_cents AS TEXT) || '0000';
        CREATE TABLE jupiter_swap_orders (
          request_id TEXT PRIMARY KEY,
          evidence_json TEXT NOT NULL,
          status TEXT NOT NULL,
          transaction_hash TEXT UNIQUE,
          result_json TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_jupiter_swap_orders_status_expiry
          ON jupiter_swap_orders(status, expires_at);
        CREATE TABLE referral_fee_assets (
          fee_mint TEXT PRIMARY KEY,
          total_fee_atomic TEXT NOT NULL,
          walletor_fee_atomic TEXT NOT NULL,
          estimated_walletor_microusd TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE referral_fee_ledger (
          entry_id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          transaction_hash TEXT NOT NULL UNIQUE,
          wallet_address TEXT NOT NULL,
          fee_mint TEXT NOT NULL,
          total_fee_atomic TEXT NOT NULL,
          walletor_fee_atomic TEXT NOT NULL,
          estimated_total_fee_microusd TEXT NOT NULL,
          estimated_walletor_fee_microusd TEXT NOT NULL,
          referral_fee_bps INTEGER NOT NULL,
          partner_share_bps INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TRIGGER referral_fee_ledger_no_update
        BEFORE UPDATE ON referral_fee_ledger BEGIN
          SELECT RAISE(ABORT, 'referral fee ledger is append-only');
        END;
        CREATE TRIGGER referral_fee_ledger_no_delete
        BEFORE DELETE ON referral_fee_ledger BEGIN
          SELECT RAISE(ABORT, 'referral fee ledger is append-only');
        END;
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (2, datetime('now'));
      `);
    }

    if (version < 3) {
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_allocations_wallet_created
          ON allocations(wallet_address, created_at DESC);
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (3, datetime('now'));
      `);
    }

    if (version < 4) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE allocations
          ADD COLUMN payout_transaction_hash TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_payout_signature
          ON allocations(payout_transaction_hash)
          WHERE payout_transaction_hash IS NOT NULL;
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (4, datetime('now'));
      `);
    }

    if (version < 5) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE jupiter_swap_orders
          ADD COLUMN execution_evidence_json TEXT;
        ALTER TABLE jupiter_swap_orders
          ADD COLUMN accounting_error TEXT;
        ALTER TABLE jupiter_swap_orders
          ADD COLUMN accounting_attempts INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_jupiter_swap_orders_transaction_hash
          ON jupiter_swap_orders(transaction_hash);
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (5, datetime('now'));
      `);
    }

    if (version < 6) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE rounds
          ADD COLUMN draw_winner_count INTEGER NOT NULL DEFAULT 20
          CHECK (draw_winner_count BETWEEN 1 AND 100);
        ALTER TABLE rounds
          ADD COLUMN draw_claim_fee_bps INTEGER NOT NULL DEFAULT 250
          CHECK (draw_claim_fee_bps BETWEEN 0 AND 10000);
        CREATE TABLE prize_draws (
          round_id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN (
            'SNAPSHOT_LOCKED', 'RANDOMNESS_COMMITTED',
            'RANDOMNESS_REVEALED', 'WINNERS_SELECTED',
            'ONCHAIN_SETTLED', 'COMPLETED', 'FAILED'
          )),
          algorithm_version TEXT NOT NULL,
          configured_winner_count INTEGER NOT NULL
            CHECK (configured_winner_count BETWEEN 1 AND 100),
          winner_count INTEGER NOT NULL CHECK (winner_count BETWEEN 0 AND 100),
          participant_count INTEGER NOT NULL CHECK (participant_count >= 0),
          total_weight TEXT NOT NULL CHECK (total_weight GLOB '[0-9]*'),
          participant_checksum TEXT NOT NULL,
          participant_merkle_root TEXT NOT NULL,
          claim_fee_bps INTEGER NOT NULL CHECK (claim_fee_bps BETWEEN 0 AND 10000),
          randomness_account TEXT,
          commit_transaction_signature TEXT,
          reveal_transaction_signature TEXT,
          settlement_transaction_signature TEXT,
          failure_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (round_id) REFERENCES rounds(round_id)
        );
        CREATE TABLE prize_draw_participants (
          round_id TEXT NOT NULL,
          participant_index INTEGER NOT NULL CHECK (participant_index >= 0),
          wallet_address TEXT NOT NULL,
          eligible_swap_count INTEGER NOT NULL CHECK (eligible_swap_count > 0),
          multiplier_bps INTEGER NOT NULL CHECK (
            multiplier_bps IN (10000, 11000, 12500, 15000)
          ),
          weight TEXT NOT NULL CHECK (weight GLOB '[0-9]*'),
          range_start TEXT NOT NULL CHECK (range_start GLOB '[0-9]*'),
          range_end TEXT NOT NULL CHECK (range_end GLOB '[0-9]*'),
          leaf_hash TEXT NOT NULL,
          PRIMARY KEY (round_id, participant_index),
          UNIQUE (round_id, wallet_address),
          FOREIGN KEY (round_id) REFERENCES prize_draws(round_id)
        );
        CREATE TABLE prize_draw_winners (
          round_id TEXT NOT NULL,
          winner_rank INTEGER NOT NULL CHECK (winner_rank BETWEEN 1 AND 100),
          wallet_address TEXT NOT NULL,
          participant_index INTEGER NOT NULL CHECK (participant_index >= 0),
          winning_ticket TEXT NOT NULL CHECK (winning_ticket GLOB '[0-9]*'),
          attempts_json TEXT NOT NULL,
          gross_winnings_lamports TEXT,
          claim_fee_lamports TEXT,
          net_winnings_lamports TEXT,
          claim_status TEXT NOT NULL DEFAULT 'PENDING_SETTLEMENT' CHECK (
            claim_status IN (
              'PENDING_SETTLEMENT', 'CLAIMABLE', 'CLAIMED', 'EXPIRED', 'FAILED'
            )
          ),
          claim_transaction_signature TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (round_id, winner_rank),
          UNIQUE (round_id, wallet_address),
          FOREIGN KEY (round_id) REFERENCES prize_draws(round_id)
        );
        CREATE INDEX idx_prize_draws_status_created
          ON prize_draws(status, created_at);
        CREATE INDEX idx_prize_draw_participants_wallet
          ON prize_draw_participants(wallet_address, round_id);
        CREATE INDEX idx_prize_draw_winners_wallet
          ON prize_draw_winners(wallet_address, round_id);
        CREATE TRIGGER prize_draw_policy_no_update
        BEFORE UPDATE OF algorithm_version, configured_winner_count,
          winner_count, participant_count, total_weight,
          participant_checksum, participant_merkle_root, claim_fee_bps
        ON prize_draws BEGIN
          SELECT RAISE(ABORT, 'locked prize draw policy is immutable');
        END;
        CREATE TRIGGER prize_draws_no_delete
        BEFORE DELETE ON prize_draws BEGIN
          SELECT RAISE(ABORT, 'prize draws cannot be deleted');
        END;
        CREATE TRIGGER prize_draw_participants_no_update
        BEFORE UPDATE ON prize_draw_participants BEGIN
          SELECT RAISE(ABORT, 'prize draw participants are immutable');
        END;
        CREATE TRIGGER prize_draw_participants_no_delete
        BEFORE DELETE ON prize_draw_participants BEGIN
          SELECT RAISE(ABORT, 'prize draw participants are immutable');
        END;
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (6, datetime('now'));
      `);
    }

    if (version < 7) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE participants
          ADD COLUMN eligible_fee_contribution_microusd TEXT NOT NULL DEFAULT '0';
        ALTER TABLE prize_draw_participants
          ADD COLUMN eligible_volume_cents TEXT NOT NULL DEFAULT '0';
        ALTER TABLE prize_draw_participants
          ADD COLUMN eligible_fee_contribution_microusd TEXT NOT NULL DEFAULT '0';
        UPDATE participants
        SET eligible_fee_contribution_microusd = CAST(COALESCE((
          SELECT SUM(CAST(f.estimated_walletor_fee_microusd AS INTEGER))
          FROM referral_fee_ledger AS f
          INNER JOIN processed_swaps AS s
            ON s.transaction_hash = f.transaction_hash
          WHERE s.round_id = participants.round_id
            AND f.wallet_address = participants.wallet_address
            AND json_extract(s.result_json, '$.rewardEligible') = 1
        ), 0) AS TEXT);
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (7, datetime('now'));
      `);
    }

    if (version < 8) {
      this.ctx.storage.sql.exec(`
        UPDATE rounds
        SET draw_winner_count = 22
        WHERE status = 'OPEN';
        INSERT INTO _sql_schema_migrations (id, applied_at)
        VALUES (8, datetime('now'));
      `);
    }
    if (version < 9) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(REFERRAL_SQL);
        this.ctx.storage.sql.exec(
          "CREATE INDEX IF NOT EXISTS participants_referral_wallet ON participants(wallet_address)",
        );
        const now = new Date();
        const startsAt = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
          ),
        ).toISOString();
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO wallet_referral_policy(singleton,boost_starts_at) VALUES (1,?)",
          startsAt,
        );
        this.ctx.storage.sql.exec(
          "ALTER TABLE prize_draw_participants ADD COLUMN referral_boost_bps INTEGER NOT NULL DEFAULT 0",
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations(id,applied_at) VALUES (9,datetime('now'))",
        );
      });
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS jupiter_orders_influencer_wallet ON jupiter_swap_orders(json_extract(evidence_json,'$.walletAddress'))",
      );
      new InfluencerLedger(this.ctx.storage.sql).initialize(
        new Date().toISOString(),
      );
      new QuestlineLedger(this.ctx.storage.sql).initialize();
    });
  }

  getPrizeSeedState(authority: string, depositAccount: string) {
    const campaign = seedCampaign(this.ctx.storage.sql);
    if (
      campaign &&
      (campaign.authority_address !== authority ||
        campaign.deposit_account !== depositAccount)
    ) {
      throw new Error(
        "Daily prize reserve belongs to a different distribution wallet.",
      );
    }
    const seededRounds = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM prize_seed_rounds",
      )
      .one().count;
    return PrizeSeedStateSchema.parse({
      authorityAddress: authority,
      depositAccount,
      requestedAt: campaign?.requested_at ?? null,
      fundedAt: campaign?.funded_at ?? null,
      startsAt: campaign?.starts_at ?? null,
      endsAt: campaign?.ends_at ?? null,
      depositSignature: campaign?.deposit_signature ?? null,
      seededRounds,
      remainingCents: campaign?.funded_at ? 70_000 - seededRounds * 10_000 : 0,
    });
  }

  preparePrizeSeed(authority: string, depositAccount: string, now: string) {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO prize_seed_campaign
      (singleton, authority_address, deposit_account, requested_at) VALUES (1, ?, ?, ?)`,
      authority,
      depositAccount,
      now,
    );
    return this.getPrizeSeedState(authority, depositAccount);
  }

  async activatePrizeSeed(
    authority: string,
    depositAccount: string,
    signature: string,
    now: string,
    rules: CoordinatorRules,
  ) {
    await this.rollDueRounds(now, rules);
    return this.ctx.storage.transactionSync(() => {
      const state = this.getPrizeSeedState(authority, depositAccount);
      if (!state.requestedAt)
        throw new Error("Prepare the daily reserve before funding it.");
      if (state.depositSignature) {
        if (state.depositSignature !== signature)
          throw new Error(
            "The seven-day reserve is already funded. Do not send another deposit.",
          );
        return state;
      }
      const active = this.round(this.pool().active_round_id);
      if (
        Date.parse(active.end_time) - Date.parse(active.start_time) !==
          SEED_DAY_MS ||
        rules.roundDurationHours !== 24
      ) {
        throw new Error(
          "The daily seed requires a full 24-hour round schedule.",
        );
      }
      const startsAt = active.end_time;
      const endsAt = new Date(
        Date.parse(startsAt) + 7 * SEED_DAY_MS,
      ).toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE prize_seed_campaign SET funded_at = ?, deposit_signature = ?, starts_at = ?, ends_at = ? WHERE singleton = 1 AND funded_at IS NULL`,
        now,
        signature,
        startsAt,
        endsAt,
      );
      this.insertLedger(
        active.round_id,
        this.pool().chain_id,
        signature,
        "TREASURY_SEED_RESERVE_FUNDED",
        70_000n,
        `seed-reserve:${signature}`,
        "700 USDC reserve verified for seven daily 100 USDC seeds, beginning with the next full round.",
        now,
      );
      return this.getPrizeSeedState(authority, depositAccount);
    });
  }

  verifyZealyDailyTask(
    input: ZealyVerification,
    campaignStartsAt: string,
    now: string,
  ) {
    const parsed = ZealyVerificationSchema.parse(input);
    return this.ctx.storage.transactionSync(() => {
      // Isolated verification metadata; never writes reward balances or trades.
      this.ctx.storage.sql.exec(ZEALY_SCHEMA_SQL);
      return verifyZealyDailySwap(
        this.ctx.storage.sql,
        parsed,
        campaignStartsAt,
        now,
      );
    });
  }

  getQuestlineStatus() {
    const config = readQuestlineConfig(this.env);
    return {
      enabled: config !== null,
      configured: Boolean(this.env.QUESTLINE_API_KEY),
      campaign: config,
      counts: config
        ? new QuestlineLedger(this.ctx.storage.sql).summary(config.questId)
        : [],
    };
  }

  async flushQuestlineCompletions() {
    const config = readQuestlineConfig(this.env);
    if (!config || !this.env.QUESTLINE_API_KEY)
      return { enabled: false, attempted: 0, accepted: 0 };
    const ledger = new QuestlineLedger(this.ctx.storage.sql);
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      ledger.configure(config);
      ledger.enqueue(config, now);
    });
    let attempted = 0;
    let accepted = 0;
    const deadline = Date.now() + 20_000;
    while (attempted < 10 && Date.now() < deadline) {
      const job = this.ctx.storage.transactionSync(() =>
        ledger.claim(config.questId, new Date().toISOString()),
      );
      if (!job) break;
      const outcome = await deliverQuestline(job, this.env.QUESTLINE_API_KEY);
      ledger.settle(job, outcome, new Date().toISOString());
      attempted++;
      if (outcome.status === "ACCEPTED") accepted++;
      if (outcome.stop) break;
    }
    return { enabled: true, attempted, accepted };
  }

  async getReferralState(wallet: string, now: string, rules: CoordinatorRules) {
    await this.rollDueRounds(now, rules);
    return new WalletReferrals(this.ctx.storage.sql).state(
      wallet,
      this.round(this.pool().active_round_id),
    );
  }
  referralChallenge(wallet: string, code: string, now: string) {
    new InfluencerLedger(this.ctx.storage.sql).assertNativeReferral(
      wallet,
      code,
    );
    return new WalletReferrals(this.ctx.storage.sql).challenge(
      wallet,
      code,
      now,
    );
  }
  influencerStatus(wallet: string, code: string) {
    return new InfluencerLedger(this.ctx.storage.sql).status(wallet, code);
  }
  influencerProfile(wallet: string) {
    return new InfluencerLedger(this.ctx.storage.sql).profile(wallet);
  }
  enrollInfluencer(proof: InfluencerProof, now: string) {
    return this.ctx.storage.transactionSync(() =>
      new InfluencerLedger(this.ctx.storage.sql).enroll(proof, now),
    );
  }
  influencerChallenge(
    input: {
      walletAddress: string;
      code: string;
      purpose: "ENROLL" | "JOIN" | "REPORT";
    },
    now: string,
  ) {
    return new InfluencerLedger(this.ctx.storage.sql).challenge(input, now);
  }
  joinInfluencer(proof: InfluencerProof, now: string) {
    this.ctx.storage.transactionSync(() => {
      new InfluencerLedger(this.ctx.storage.sql).join(proof, now);
    });
  }
  getInfluencerReport(query: InfluencerReportQuery, now: string) {
    return new InfluencerLedger(this.ctx.storage.sql).report(query, now);
  }
  getPrivateInfluencerReport(
    proof: InfluencerProof,
    query: InfluencerReportQuery,
    now: string,
  ) {
    return this.ctx.storage.transactionSync(() =>
      new InfluencerLedger(this.ctx.storage.sql).privateReport(
        proof,
        query,
        now,
      ),
    );
  }
  joinReferral(proof: ReferralProof, now: string): void {
    this.ctx.storage.transactionSync(() => {
      new InfluencerLedger(this.ctx.storage.sql).assertNativeReferral(
        proof.walletAddress,
        proof.code,
      );
      new WalletReferrals(this.ctx.storage.sql).join(proof, now);
    });
  }
  private creditReferral(
    wallet: string,
    roundId: string,
    transaction: string,
    now: string,
    startedAt: string,
  ): void {
    const referrer = new WalletReferrals(this.ctx.storage.sql).award(
      wallet,
      roundId,
      transaction,
      now,
      startedAt,
    );
    if (referrer)
      this.creditWlt(
        roundId,
        referrer,
        `referral:${wallet}`,
        BigInt(REFERRAL_POINTS),
        now,
      );
  }

  roundFeeSources(roundId: string): {
    sourceId: string;
    transactionSignature: string;
    mint: string;
    amountAtomic: string;
  }[] {
    const round = this.ctx.storage.sql
      .exec<{ status: string }>(
        "SELECT status FROM rounds WHERE round_id = ?",
        roundId,
      )
      .toArray()[0];
    if (!round || round.status === "OPEN")
      throw new Error("Fee funding requires a closed round.");
    return this.ctx.storage.sql
      .exec<{
        entry_id: string;
        transaction_hash: string;
        fee_mint: string;
        walletor_fee_atomic: string;
      }>(
        `SELECT f.entry_id, f.transaction_hash, f.fee_mint,
          COALESCE(r.pool_atomic, f.walletor_fee_atomic) AS walletor_fee_atomic
       FROM referral_fee_ledger AS f INNER JOIN processed_swaps AS s
       ON s.transaction_hash = f.transaction_hash
       LEFT JOIN fee_reserve_receipts AS r ON r.chain_id = s.chain_id
         AND r.transaction_hash = f.transaction_hash
       WHERE s.round_id = ? ORDER BY f.entry_id`,
        roundId,
      )
      .toArray()
      .map((row) => ({
        sourceId: row.entry_id,
        transactionSignature: row.transaction_hash,
        mint: row.fee_mint,
        amountAtomic: row.walletor_fee_atomic,
      }));
  }

  initialize(
    identity: CoordinatorIdentity,
    serverTime: string,
    roundDurationHours = 24,
  ): void {
    const timestamp = new Date(serverTime);
    const window = utcRoundWindow(
      timestamp,
      identity.poolId,
      roundDurationHours,
    );
    this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<PoolRow>("SELECT * FROM pool_state WHERE singleton = 1")
        .toArray()[0];
      if (existing) {
        if (
          existing.pool_id !== identity.poolId ||
          existing.chain_id !== identity.chainId ||
          existing.chain_family !== identity.chainFamily ||
          existing.network_name !== identity.networkName
        ) {
          throw new Error("Prize Pool coordinator identity cannot change.");
        }
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO rounds (
          round_id, status, start_time, end_time, locked_at, completed_at,
          total_pool_cents, total_eligible_swaps, total_eligible_volume_cents,
          eligible_wallet_count, allocation_checksum, remainder_cents,
          failure_reason, closure_idempotency_key, updated_at
        ) VALUES (?, 'OPEN', ?, ?, NULL, NULL, 0, 0, 0, 0, NULL, 0, NULL, ?, ?)`,
        window.roundId,
        window.startTime,
        window.endTime,
        `round-close:${window.roundId}`,
        serverTime,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO pool_state (
          singleton, pool_id, chain_id, chain_family, network_name,
          current_balance_cents, organic_contributions_cents,
          treasury_seed_cents, total_collected_cents,
          total_distributed_cents, platform_revenue_cents,
          remainder_carried_cents, active_round_id,
          distributions_paused, updated_at
        ) VALUES (1, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, 0, ?)`,
        identity.poolId,
        identity.chainId,
        identity.chainFamily,
        identity.networkName,
        window.roundId,
        serverTime,
      );
    });
  }

  registerJupiterOrder(
    rawInput: JupiterSwapOrderEvidence,
    rules: CoordinatorRules,
  ): void {
    const input = JupiterSwapOrderEvidenceSchema.parse(rawInput);
    if (!rules.accountingEnabled) {
      throw new Error("Prize Pool accounting is disabled.");
    }
    if (
      rules.referralAccount === null ||
      rules.referralFeeBps === null ||
      rules.partnerShareBps === null ||
      input.referralAccount !== rules.referralAccount ||
      input.referralFeeBps !== rules.referralFeeBps ||
      input.partnerShareBps !== rules.partnerShareBps
    ) {
      throw new Error(
        "Jupiter order does not match Walletor's referral configuration.",
      );
    }
    if (
      (input.feeMint === input.inputMint &&
        input.valuationAmountAtomic !== input.inputAmountAtomic) ||
      (input.feeMint === input.outputMint &&
        input.valuationAmountAtomic !== input.outputAmountAtomic) ||
      (input.feeMint !== input.inputMint && input.feeMint !== input.outputMint)
    ) {
      throw new Error("Jupiter order valuation does not match its fee mint.");
    }
    const registeredAtMs = Date.parse(input.registeredAt);
    const expiresAtMs = Date.parse(input.expiresAt);
    if (
      expiresAtMs <= registeredAtMs ||
      expiresAtMs - registeredAtMs > 15 * 60_000
    ) {
      throw new Error("Jupiter order registration has an invalid lifetime.");
    }

    const evidenceJson = JSON.stringify(input);
    const existing = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        "SELECT * FROM jupiter_swap_orders WHERE request_id = ?",
        input.requestId,
      )
      .toArray()[0];
    if (existing) {
      if (existing.evidence_json !== evidenceJson) {
        throw new Error("Jupiter request ID was registered with other data.");
      }
      return;
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO jupiter_swap_orders (
        request_id, evidence_json, status, transaction_hash, result_json,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, 'PENDING', NULL, NULL, ?, ?, ?)`,
      input.requestId,
      evidenceJson,
      input.expiresAt,
      input.registeredAt,
      input.registeredAt,
    );
  }

  stageJupiterExecution(rawInput: JupiterSwapExecutionEvidence): void {
    const input = JupiterSwapExecutionEvidenceSchema.parse(rawInput);
    const orderRow = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        "SELECT * FROM jupiter_swap_orders WHERE request_id = ?",
        input.requestId,
      )
      .toArray()[0];
    if (!orderRow) {
      throw new Error("Confirmed Jupiter order was not registered.");
    }
    if (
      orderRow.transaction_hash !== null &&
      orderRow.transaction_hash !== input.transactionHash
    ) {
      throw new Error(
        "Jupiter order is already linked to another transaction.",
      );
    }
    if (orderRow.status === "CREDITED") return;

    this.ctx.storage.sql.exec(
      `UPDATE jupiter_swap_orders SET transaction_hash = ?,
        execution_evidence_json = ?, accounting_error = NULL,
        updated_at = ? WHERE request_id = ? AND status = 'PENDING'`,
      input.transactionHash,
      JSON.stringify(input),
      input.confirmedAt,
      input.requestId,
    );
  }

  getJupiterOrderByRequestId(
    requestId: string,
  ): JupiterSwapOrderEvidence | null {
    const row = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        "SELECT * FROM jupiter_swap_orders WHERE request_id = ?",
        requestId,
      )
      .toArray()[0];
    return row ? parseJupiterOrderEvidence(row.evidence_json) : null;
  }

  getJupiterExecutionByTransactionHash(
    transactionHash: string,
  ): JupiterSwapExecutionEvidence | null {
    const row = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        "SELECT * FROM jupiter_swap_orders WHERE transaction_hash = ?",
        transactionHash,
      )
      .toArray()[0];
    if (!row?.execution_evidence_json) return null;
    return JupiterSwapExecutionEvidenceSchema.parse(
      JSON.parse(row.execution_evidence_json),
    );
  }

  listPendingJupiterTransactionHashes(limit = 10): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new Error("Pending Jupiter retry limit is invalid.");
    }
    return this.ctx.storage.sql
      .exec<{ transaction_hash: string }>(
        `SELECT transaction_hash FROM jupiter_swap_orders
         WHERE status = 'PENDING' AND transaction_hash IS NOT NULL
         ORDER BY updated_at ASC LIMIT ?`,
        limit,
      )
      .toArray()
      .map((row) => row.transaction_hash);
  }

  findPendingJupiterOrdersForRecovery(
    signerAddresses: string[],
    confirmedAt: string,
  ): JupiterSwapOrderEvidence[] {
    if (signerAddresses.length === 0 || signerAddresses.length > 16) return [];
    return this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        `SELECT * FROM jupiter_swap_orders
         WHERE status = 'PENDING' AND created_at <= ? AND expires_at >= ?
         ORDER BY created_at DESC LIMIT 50`,
        confirmedAt,
        confirmedAt,
      )
      .toArray()
      .map((row) => parseJupiterOrderEvidence(row.evidence_json))
      .filter((order) => signerAddresses.includes(order.walletAddress));
  }

  recordJupiterAccountingFailure(
    requestId: string,
    errorMessage: string,
    updatedAt: string,
  ): void {
    this.ctx.storage.sql.exec(
      `UPDATE jupiter_swap_orders SET accounting_error = ?,
        accounting_attempts = accounting_attempts + 1, updated_at = ?
        WHERE request_id = ? AND status = 'PENDING'`,
      errorMessage.slice(0, 300),
      updatedAt,
      requestId,
    );
  }

  async retryJupiterExecution(
    transactionHash: string,
    rules: CoordinatorRules,
  ): Promise<VerifiedSwapCreditResult | null> {
    const credited = this.ctx.storage.sql
      .exec<{ result_json: string }>(
        "SELECT result_json FROM processed_swaps WHERE chain_id = ? AND transaction_hash = ?",
        rules.chainId,
        transactionHash,
      )
      .toArray()[0];
    if (credited) {
      // This method is also the receipt-status lookup used by the wallet that
      // just submitted the transaction. Return the original verified receipt
      // so that a background retry winning the race does not suppress the
      // one-time celebration for that confirmed swap.
      return parseJsonResult(credited.result_json);
    }

    const orderRow = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        "SELECT * FROM jupiter_swap_orders WHERE transaction_hash = ?",
        transactionHash,
      )
      .toArray()[0];
    if (!orderRow?.execution_evidence_json) return null;
    const evidence = JupiterSwapExecutionEvidenceSchema.parse(
      JSON.parse(orderRow.execution_evidence_json),
    );
    try {
      return await this.creditJupiterExecution(evidence, rules);
    } catch (error) {
      this.recordJupiterAccountingFailure(
        orderRow.request_id,
        error instanceof Error ? error.message : "Unknown accounting error",
        new Date().toISOString(),
      );
      throw error;
    }
  }

  async creditJupiterExecution(
    rawInput: JupiterSwapExecutionEvidence,
    rules: CoordinatorRules,
  ): Promise<VerifiedSwapCreditResult> {
    const input = JupiterSwapExecutionEvidenceSchema.parse(rawInput);
    if (!rules.accountingEnabled) {
      throw new Error("Prize Pool accounting is disabled.");
    }
    const duplicate = this.ctx.storage.sql
      .exec<{ result_json: string }>(
        "SELECT result_json FROM processed_swaps WHERE chain_id = ? AND transaction_hash = ?",
        rules.chainId,
        input.transactionHash,
      )
      .toArray()[0];
    if (duplicate) {
      return { ...parseJsonResult(duplicate.result_json), duplicate: true };
    }

    const orderRow = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        "SELECT * FROM jupiter_swap_orders WHERE request_id = ?",
        input.requestId,
      )
      .toArray()[0];
    if (!orderRow) {
      throw new Error("Confirmed Jupiter order was not registered.");
    }
    if (orderRow.status === "CREDITED") {
      if (!orderRow.result_json) {
        throw new Error("Credited Jupiter order is missing its result.");
      }
      return { ...parseJsonResult(orderRow.result_json), duplicate: true };
    }

    const order = parseJupiterOrderEvidence(orderRow.evidence_json);
    const confirmedAtMs = Date.parse(input.confirmedAt);
    if (
      confirmedAtMs < Date.parse(order.registeredAt) ||
      confirmedAtMs > Date.parse(order.expiresAt)
    ) {
      throw new Error(
        "Confirmed Jupiter execution is outside its order window.",
      );
    }
    const fee = deriveExecutedReferralFee(order, input);
    const reserve = splitFeeReserve(
      fee.walletorFeeAmountAtomic,
      fee.walletorFeeEstimatedMicroUsd,
      input.confirmedAt,
      feeReserveStart(this.ctx.storage.sql),
    );
    // Invalid and duplicate receipts must not change round state.
    await this.rollDueRounds(input.confirmedAt, rules);
    const pool = this.pool();
    if (pool.distributions_paused === 1) {
      throw new Error("Prize Pool accounting is paused for reconciliation.");
    }
    const round = this.round(pool.active_round_id);
    if (round.status !== "OPEN") {
      throw new Error(
        "Swap accounting is waiting for an open Prize Pool round.",
      );
    }
    const existingParticipant = this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM participants WHERE round_id = ? AND wallet_address = ?",
        round.round_id,
        order.walletAddress,
      )
      .toArray()[0];

    const currentMicros = BigInt(pool.current_balance_microusd);
    const organicMicros = BigInt(pool.organic_contributions_microusd);
    const collectedMicros = BigInt(pool.total_collected_microusd);
    const resultingMicros = currentMicros + reserve.poolMicroUsd;
    const resultingPrizePoolCents = microUsdToCents(resultingMicros);
    const contributionCents = microUsdToCents(reserve.poolMicroUsd);
    const swapId = crypto.randomUUID();
    const eligibility = evaluateSwapEligibility({
      finalized: true,
      signerMatches: true,
      swapInstructionPresent: true,
      walletorFeeTransferPresent: true,
      treasuryMatches: true,
      verifiedSwapValueCents: fee.swapEstimatedUsdCents,
      minimumRewardEligibleSwapCents: BigInt(
        rules.minimumRewardEligibleSwapCents,
      ),
      blockTimeMs: confirmedAtMs,
      roundStartMs: Date.parse(round.start_time),
      roundEndMs: Date.parse(round.end_time),
      walletFirstSeenAtMs: null,
      newWalletReviewDays: rules.newWalletReviewDays,
    });
    const oldEligibleCount = existingParticipant?.eligible_swap_count ?? 0;
    const newEligibleCount = oldEligibleCount + (eligibility.eligible ? 1 : 0);
    const tier = rewardTier(newEligibleCount);
    const wltPoints = eligibility.eligible
      ? calculateWltPoints(BigInt(rules.wltBasePointsPerEligibleSwap))
      : 0n;
    const resultingLifetimeWltPoints =
      this.lifetimeWltPoints(order.walletAddress) + wltPoints;
    const result = VerifiedSwapCreditResultSchema.parse({
      duplicate: false,
      swapId,
      roundId: round.round_id,
      rewardEligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      prizePoolContributionMicroUsd: reserve.poolMicroUsd.toString(),
      feeReserveAmountAtomic: reserve.reserved.toString(),
      feeReserveMicroUsd: reserve.reservedMicroUsd.toString(),
      prizePoolContributionCents: contributionCents.toString(),
      platformRevenueCents: "0",
      wltPointsCredited: wltPoints.toString(),
      resultingLifetimeWltPoints: resultingLifetimeWltPoints.toString(),
      resultingPrizePoolMicroUsd: resultingMicros.toString(),
      resultingPrizePoolCents: resultingPrizePoolCents.toString(),
    });
    const existingAsset = this.ctx.storage.sql
      .exec<ReferralFeeAssetRow>(
        "SELECT * FROM referral_fee_assets WHERE fee_mint = ?",
        order.feeMint,
      )
      .toArray()[0];
    const assetTotalFee =
      BigInt(existingAsset?.total_fee_atomic ?? "0") + fee.totalFeeAmountAtomic;
    const assetWalletorFee =
      BigInt(existingAsset?.walletor_fee_atomic ?? "0") +
      fee.walletorFeeAmountAtomic;
    const assetEstimatedMicros =
      BigInt(existingAsset?.estimated_walletor_microusd ?? "0") +
      fee.walletorFeeEstimatedMicroUsd;
    this.ctx.storage.transactionSync(() => {
      recordFeeReserve(
        this.ctx.storage.sql,
        rules.chainId,
        input.transactionHash,
        order.feeMint,
        input.confirmedAt,
        reserve,
      );
      new InfluencerLedger(this.ctx.storage.sql).credit({
        wallet: order.walletAddress,
        orderStartedAt: order.registeredAt,
        confirmedAt: input.confirmedAt,
        chainId: rules.chainId,
        signature: input.transactionHash,
        mint: order.feeMint,
        gross: reserve.gross,
        reserved: reserve.reserved,
      });
      this.ctx.storage.sql.exec(
        `UPDATE pool_state SET
          current_balance_microusd = ?,
          organic_contributions_microusd = ?,
          total_collected_microusd = ?,
          current_balance_cents = ?,
          organic_contributions_cents = ?,
          total_collected_cents = ?,
          updated_at = ? WHERE singleton = 1`,
        resultingMicros.toString(),
        (organicMicros + reserve.poolMicroUsd).toString(),
        (collectedMicros + fee.walletorFeeEstimatedMicroUsd).toString(),
        toSafeInteger(resultingPrizePoolCents, "Prize Pool valuation"),
        toSafeInteger(
          microUsdToCents(organicMicros + reserve.poolMicroUsd),
          "Organic contribution valuation",
        ),
        toSafeInteger(
          microUsdToCents(collectedMicros + fee.walletorFeeEstimatedMicroUsd),
          "Collected-fee valuation",
        ),
        input.confirmedAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO processed_swaps (
          chain_id, transaction_hash, swap_id, round_id, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        rules.chainId,
        input.transactionHash,
        swapId,
        round.round_id,
        JSON.stringify(result),
        input.confirmedAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO referral_fee_assets (
          fee_mint, total_fee_atomic, walletor_fee_atomic,
          estimated_walletor_microusd, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(fee_mint) DO UPDATE SET
          total_fee_atomic = excluded.total_fee_atomic,
          walletor_fee_atomic = excluded.walletor_fee_atomic,
          estimated_walletor_microusd = excluded.estimated_walletor_microusd,
          updated_at = excluded.updated_at`,
        order.feeMint,
        assetTotalFee.toString(),
        assetWalletorFee.toString(),
        assetEstimatedMicros.toString(),
        input.confirmedAt,
      );
      recordQuestlineSwap(this.ctx.storage.sql, {
        chainId: rules.chainId,
        signature: input.transactionHash,
        wallet: order.walletAddress,
        orderStartedAt: order.registeredAt,
        confirmedAt: input.confirmedAt,
        eligible: eligibility.eligible,
        valueCents: fee.swapEstimatedUsdCents,
        questId: order.questlineQuestId,
      });
      this.ctx.storage.sql.exec(
        `INSERT INTO referral_fee_ledger (
          entry_id, request_id, transaction_hash, wallet_address, fee_mint,
          total_fee_atomic, walletor_fee_atomic,
          estimated_total_fee_microusd, estimated_walletor_fee_microusd,
          referral_fee_bps, partner_share_bps, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        order.requestId,
        input.transactionHash,
        order.walletAddress,
        order.feeMint,
        fee.totalFeeAmountAtomic.toString(),
        fee.walletorFeeAmountAtomic.toString(),
        fee.totalFeeEstimatedMicroUsd.toString(),
        fee.walletorFeeEstimatedMicroUsd.toString(),
        order.referralFeeBps,
        order.partnerShareBps,
        input.confirmedAt,
      );
      this.insertLedger(
        round.round_id,
        rules.chainId,
        input.transactionHash,
        "JUPITER_REFERRAL_FEE_ESTIMATED",
        microUsdToCents(fee.walletorFeeEstimatedMicroUsd),
        `fee:${rules.chainId}:${input.transactionHash}`,
        "Quote-time USD estimate of Walletor's exact atomic Jupiter referral share.",
        input.confirmedAt,
      );
      this.insertLedger(
        round.round_id,
        rules.chainId,
        input.transactionHash,
        "PRIZE_POOL_CREDIT_ESTIMATED",
        contributionCents,
        `pool-credit:${rules.chainId}:${input.transactionHash}`,
        "Estimated USD value credited after the Walletor fee reserve.",
        input.confirmedAt,
      );
      this.upsertJupiterParticipant(
        round.round_id,
        order.walletAddress,
        fee.swapEstimatedUsdCents,
        fee.walletorFeeEstimatedMicroUsd,
        input.confirmedAt,
        existingParticipant,
        eligibility.eligible,
        tier,
      );
      if (wltPoints > 0n) {
        this.creditWlt(
          round.round_id,
          order.walletAddress,
          input.transactionHash,
          wltPoints,
          input.confirmedAt,
        );
        this.creditReferral(
          order.walletAddress,
          round.round_id,
          input.transactionHash,
          input.confirmedAt,
          order.registeredAt,
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE jupiter_swap_orders SET status = 'CREDITED',
          transaction_hash = ?, result_json = ?, updated_at = ?
          WHERE request_id = ? AND status = 'PENDING'`,
        input.transactionHash,
        JSON.stringify(result),
        input.confirmedAt,
        order.requestId,
      );
    });

    return result;
  }

  async creditVerifiedSwap(
    rawInput: VerifiedSwapCreditInput,
    rules: CoordinatorRules,
  ): Promise<VerifiedSwapCreditResult> {
    const input = VerifiedSwapCreditInputSchema.parse(rawInput);
    if (!rules.accountingEnabled) {
      throw new Error("Prize Pool accounting is disabled.");
    }
    const expectedFeeCents =
      input.swapType === "STANDARD_SWAP"
        ? rules.standardSwapFeeCents
        : rules.advancedTradeFeeCents;
    if (
      input.chainId !== rules.chainId ||
      rules.treasuryAddress === null ||
      input.treasuryAddress !== rules.treasuryAddress ||
      rules.feeAssetMint === null ||
      input.walletorFeeAssetAddress !== rules.feeAssetMint ||
      input.verifiedWalletorFeeCents !== expectedFeeCents ||
      (input.swapType === "STANDARD_SWAP" &&
        (rules.standardSwapFeeAtomic === null ||
          input.walletorFeeAmountAtomic !== rules.standardSwapFeeAtomic))
    ) {
      throw new Error(
        "Verified fee evidence does not match the configured chain, treasury, asset, or amount.",
      );
    }
    await this.rollDueRounds(input.finalizedAt, rules);

    const duplicate = this.ctx.storage.sql
      .exec<{ result_json: string }>(
        "SELECT result_json FROM processed_swaps WHERE chain_id = ? AND transaction_hash = ?",
        input.chainId,
        input.transactionHash,
      )
      .toArray()[0];
    if (duplicate) {
      return { ...parseJsonResult(duplicate.result_json), duplicate: true };
    }

    const pool = this.pool();
    if (pool.distributions_paused === 1) {
      throw new Error("Prize Pool accounting is paused for reconciliation.");
    }
    const round = this.round(pool.active_round_id);
    const existingParticipant = this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM participants WHERE round_id = ? AND wallet_address = ?",
        round.round_id,
        input.walletAddress,
      )
      .toArray()[0];
    const blockTimeMs = Date.parse(input.blockTime);
    const eligibility = evaluateSwapEligibility({
      finalized: true,
      signerMatches: true,
      swapInstructionPresent: true,
      walletorFeeTransferPresent: true,
      treasuryMatches: input.treasuryAddress === rules.treasuryAddress,
      verifiedSwapValueCents: BigInt(input.verifiedSwapValueCents),
      minimumRewardEligibleSwapCents: BigInt(
        rules.minimumRewardEligibleSwapCents,
      ),
      blockTimeMs,
      roundStartMs: Date.parse(round.start_time),
      roundEndMs: Date.parse(round.end_time),
      walletFirstSeenAtMs: input.walletFirstSeenAt
        ? Date.parse(input.walletFirstSeenAt)
        : null,
      newWalletReviewDays: rules.newWalletReviewDays,
    });
    const reserve = splitFeeReserve(
      BigInt(input.walletorFeeAmountAtomic),
      BigInt(input.verifiedWalletorFeeCents) * 10_000n,
      input.blockTime,
      feeReserveStart(this.ctx.storage.sql),
    );
    const feeSplit = reserve.active
      ? {
          prizePoolContributionCents: microUsdToCents(reserve.poolMicroUsd),
          platformRevenueCents: 0n,
        }
      : splitWalletorFee(
          BigInt(input.verifiedWalletorFeeCents),
          BigInt(rules.prizePoolPercentageBps),
          BigInt(rules.platformRevenuePercentageBps),
        );
    const oldEligibleCount = existingParticipant?.eligible_swap_count ?? 0;
    const newEligibleCount = oldEligibleCount + (eligibility.eligible ? 1 : 0);
    const tier = rewardTier(newEligibleCount);
    const wltPoints = eligibility.eligible
      ? calculateWltPoints(BigInt(rules.wltBasePointsPerEligibleSwap))
      : 0n;
    const resultingLifetimeWltPoints =
      this.lifetimeWltPoints(input.walletAddress) + wltPoints;
    const swapId = crypto.randomUUID();
    const prizePoolContributionMicroUsd = reserve.active
      ? reserve.poolMicroUsd
      : feeSplit.prizePoolContributionCents * 10_000n;
    const resultingPrizePoolMicroUsd =
      BigInt(pool.current_balance_microusd) + prizePoolContributionMicroUsd;
    const resultingPrizePoolCents = microUsdToCents(resultingPrizePoolMicroUsd);
    const result = VerifiedSwapCreditResultSchema.parse({
      duplicate: false,
      swapId,
      roundId: round.round_id,
      rewardEligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      prizePoolContributionMicroUsd: prizePoolContributionMicroUsd.toString(),
      feeReserveAmountAtomic: reserve.reserved.toString(),
      feeReserveMicroUsd: reserve.reservedMicroUsd.toString(),
      prizePoolContributionCents:
        feeSplit.prizePoolContributionCents.toString(),
      platformRevenueCents: feeSplit.platformRevenueCents.toString(),
      wltPointsCredited: wltPoints.toString(),
      resultingLifetimeWltPoints: resultingLifetimeWltPoints.toString(),
      resultingPrizePoolMicroUsd: resultingPrizePoolMicroUsd.toString(),
      resultingPrizePoolCents: resultingPrizePoolCents.toString(),
    });

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE pool_state SET
          current_balance_cents = ?,
          current_balance_microusd = ?,
          organic_contributions_cents = ?,
          organic_contributions_microusd = ?,
          total_collected_cents = total_collected_cents + ?,
          total_collected_microusd = ?,
          platform_revenue_cents = platform_revenue_cents + ?,
          updated_at = ? WHERE singleton = 1`,
        toSafeInteger(resultingPrizePoolCents, "Prize Pool balance"),
        resultingPrizePoolMicroUsd.toString(),
        toSafeInteger(
          microUsdToCents(
            BigInt(pool.organic_contributions_microusd) +
              prizePoolContributionMicroUsd,
          ),
          "Prize Pool contribution",
        ),
        (
          BigInt(pool.organic_contributions_microusd) +
          prizePoolContributionMicroUsd
        ).toString(),
        toSafeInteger(BigInt(input.verifiedWalletorFeeCents), "Verified fee"),
        (
          BigInt(pool.total_collected_microusd) +
          BigInt(input.verifiedWalletorFeeCents) * 10_000n
        ).toString(),
        toSafeInteger(feeSplit.platformRevenueCents, "Platform revenue"),
        input.finalizedAt,
      );
      recordFeeReserve(
        this.ctx.storage.sql,
        input.chainId,
        input.transactionHash,
        input.walletorFeeAssetAddress,
        input.blockTime,
        reserve,
      );
      new InfluencerLedger(this.ctx.storage.sql).credit({
        wallet: input.walletAddress,
        orderStartedAt: input.blockTime,
        confirmedAt: input.blockTime,
        chainId: input.chainId,
        signature: input.transactionHash,
        mint: input.walletorFeeAssetAddress,
        gross: reserve.gross,
        reserved: reserve.reserved,
      });
      this.ctx.storage.sql.exec(
        `INSERT INTO processed_swaps (
          chain_id, transaction_hash, swap_id, round_id, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        input.chainId,
        input.transactionHash,
        swapId,
        round.round_id,
        JSON.stringify(result),
        input.finalizedAt,
      );
      this.insertLedger(
        round.round_id,
        input.chainId,
        input.transactionHash,
        input.swapType === "STANDARD_SWAP"
          ? "SWAP_FEE_COLLECTED"
          : "ADVANCED_TRADE_FEE_COLLECTED",
        BigInt(input.verifiedWalletorFeeCents),
        `fee:${input.chainId}:${input.transactionHash}`,
        "Verified Walletor fee collected on-chain.",
        input.finalizedAt,
      );
      this.insertLedger(
        round.round_id,
        input.chainId,
        input.transactionHash,
        "PRIZE_POOL_CREDIT",
        feeSplit.prizePoolContributionCents,
        `pool-credit:${input.chainId}:${input.transactionHash}`,
        "Configured share of a verified Walletor fee credited to the Prize Pool.",
        input.finalizedAt,
      );
      if (feeSplit.platformRevenueCents > 0n) {
        this.insertLedger(
          round.round_id,
          input.chainId,
          input.transactionHash,
          "PLATFORM_REVENUE_CREDIT",
          feeSplit.platformRevenueCents,
          `platform-credit:${input.chainId}:${input.transactionHash}`,
          "Configured platform-revenue share of a verified Walletor fee.",
          input.finalizedAt,
        );
      }
      this.upsertParticipant(
        round.round_id,
        input,
        existingParticipant,
        eligibility.eligible,
        eligibility.flagNewWalletForReview,
        tier,
      );
      if (wltPoints > 0n) {
        this.creditWlt(
          round.round_id,
          input.walletAddress,
          input.transactionHash,
          wltPoints,
          input.finalizedAt,
        );
        this.creditReferral(
          input.walletAddress,
          round.round_id,
          input.transactionHash,
          input.finalizedAt,
          input.blockTime,
        );
      }
    });
    return result;
  }

  async getPublicState(
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PrizePoolState> {
    this.upgradeLegacyCurrentRoundRewards(rules);
    await this.rollDueRounds(serverTime, rules);
    const pool = this.pool();
    const activeRound = this.publicRound(
      this.round(pool.active_round_id),
      pool.current_balance_cents,
    );
    const completedRounds = this.ctx.storage.sql
      .exec<RoundRow>(
        "SELECT * FROM rounds WHERE status IN ('ALLOCATED', 'COMPLETED', 'PARTIALLY_PAID') AND round_id != ? ORDER BY start_time DESC LIMIT 25",
        activeRound.roundId,
      )
      .toArray()
      .map((round) => this.publicRound(round));
    const participants = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM participants WHERE round_id = ? AND eligible_swap_count > 0",
        activeRound.roundId,
      )
      .one().count;

    return PrizePoolStateSchema.parse({
      accountingStatus: !rules.accountingEnabled
        ? "DISABLED"
        : pool.distributions_paused === 1
          ? "PAUSED"
          : "LIVE",
      valuationStatus: "ESTIMATED",
      valuationExplanation: VALUATION_EXPLANATION,
      poolId: pool.pool_id,
      chainId: pool.chain_id,
      chainFamily: pool.chain_family,
      networkName: pool.network_name,
      currentPrizePoolMicroUsd: pool.current_balance_microusd,
      currentPrizePoolCents: String(pool.current_balance_cents),
      currentRoundSeedCents: String(
        this.ctx.storage.sql
          .exec<{ amount_cents: number }>(
            "SELECT amount_cents FROM prize_seed_rounds WHERE round_id = ?",
            activeRound.roundId,
          )
          .toArray()[0]?.amount_cents ?? 0,
      ),
      organicContributionsMicroUsd: pool.organic_contributions_microusd,
      organicContributionsCents: String(pool.organic_contributions_cents),
      treasurySeedContributionsCents: String(pool.treasury_seed_cents),
      totalCollectedMicroUsd: pool.total_collected_microusd,
      totalCollectedCents: String(pool.total_collected_cents),
      totalDistributedCents: String(pool.total_distributed_cents),
      platformRevenueCents: String(pool.platform_revenue_cents),
      currentParticipants: participants,
      failedPayoutCount: 0,
      remainderCarriedForwardCents: String(pool.remainder_carried_cents),
      activeRound,
      completedRounds,
      serverTime,
      claimStatus: "CLAIM_UNAVAILABLE_BETA",
      distributionExplanation: DISTRIBUTION_EXPLANATION,
      transparency: {
        treasuryAddress: rules.treasuryAddress,
        referralAccount: rules.referralAccount,
        referralFeeBps: rules.referralFeeBps,
        walletorPartnerShareBps: rules.partnerShareBps,
        prizePoolShareBps: 10_000 - FEE_RESERVE_BPS,
        feeReserveBps: FEE_RESERVE_BPS,
        feeReserveStartsAt: feeReserveStart(this.ctx.storage.sql),
        payoutExecutionStatus: "LOCKED_BETA",
        rewardEligibility: {
          everyConfirmedFeeBearingSwapCounts: false,
          minimumEligibleSwapUsd: centsToUsdDecimal(
            rules.minimumRewardEligibleSwapCents,
          ),
          repeatedTradeParametersAllowed: true,
          transactionSignatureCreditedOnce: true,
          weightingFormula: "CONFIRMED_SWAPS_X_TIER_X_LOG2_VOLUME_SCORE",
          tiers: REWARD_TIERS.map((tier) => ({
            confirmedSwaps: tier.swaps,
            multiplierBps: tier.multiplierBps,
          })),
        },
      },
    });
  }

  async getPublicDistributionRound(
    roundId: string,
    offset: number,
    limit: number,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PublicDistributionRoundDetail | null> {
    await this.rollDueRounds(serverTime, rules);
    const round = this.ctx.storage.sql
      .exec<RoundRow>(
        `SELECT * FROM rounds
         WHERE round_id = ?
           AND status IN ('ALLOCATED', 'COMPLETED', 'PARTIALLY_PAID')`,
        roundId,
      )
      .toArray()[0];
    if (!round) return null;

    const totalRecipients = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM allocations WHERE round_id = ?",
        roundId,
      )
      .one().count;
    const rows = this.ctx.storage.sql
      .exec<PublicAllocationRow>(
        `SELECT allocation_id, wallet_address, eligible_swap_count,
          multiplier_bps, reward_cents, status, payout_transaction_hash,
          created_at
         FROM allocations
         WHERE round_id = ?
         ORDER BY wallet_address
         LIMIT ? OFFSET ?`,
        roundId,
        limit,
        offset,
      )
      .toArray();
    const failedPayoutCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM allocations WHERE round_id = ? AND status = 'FAILED'",
        roundId,
      )
      .one().count;
    const payoutTransactionHashes = this.ctx.storage.sql
      .exec<{ payout_transaction_hash: string }>(
        `SELECT payout_transaction_hash FROM allocations
         WHERE round_id = ? AND payout_transaction_hash IS NOT NULL
         ORDER BY wallet_address`,
        roundId,
      )
      .toArray()
      .map((row) => row.payout_transaction_hash);
    const nextOffset = offset + rows.length;

    return PublicDistributionRoundDetailSchema.parse({
      round: {
        ...this.publicRound(round),
        failedPayoutCount,
        payoutTransactionHashes,
      },
      recipients: rows.map((row) => ({
        allocationId: row.allocation_id,
        walletAddress: row.wallet_address,
        eligibleSwapCount: row.eligible_swap_count,
        multiplierBps: row.multiplier_bps,
        rewardCents: String(row.reward_cents),
        status: row.status,
        payoutTransactionHash: row.payout_transaction_hash,
        allocatedAt: row.created_at,
      })),
      pagination: {
        offset,
        limit,
        totalRecipients,
        nextOffset: nextOffset < totalRecipients ? nextOffset : null,
      },
      payoutExecutionStatus: "LOCKED_BETA",
      transparencyNote:
        "Wallet addresses, allocations, statuses, and payout signatures are published from the append-only Walletor ledger. A Solscan transaction link appears only after a real payout signature is recorded.",
      serverTime,
    });
  }

  async getPublicPrizeDrawSnapshot(
    roundId: string,
    offset: number,
    limit: number,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PublicPrizeDrawSnapshot | null> {
    await this.rollDueRounds(serverTime, rules);
    const draw = this.ctx.storage.sql
      .exec<PrizeDrawRow>(
        "SELECT * FROM prize_draws WHERE round_id = ?",
        roundId,
      )
      .toArray()[0];
    if (!draw) return null;
    const round = this.round(roundId);

    const rows = this.ctx.storage.sql
      .exec<PrizeDrawParticipantRow>(
        `SELECT participant_index, wallet_address, eligible_swap_count,
          eligible_volume_cents, eligible_fee_contribution_microusd,
          multiplier_bps, weight, range_start, range_end, leaf_hash, referral_boost_bps
         FROM prize_draw_participants
         WHERE round_id = ?
         ORDER BY participant_index
         LIMIT ? OFFSET ?`,
        roundId,
        limit,
        offset,
      )
      .toArray();
    const nextOffset = offset + rows.length;

    return PublicPrizeDrawSnapshotSchema.parse({
      roundId: draw.round_id,
      status: draw.status,
      algorithmVersion: draw.algorithm_version,
      configuredWinnerCount: draw.configured_winner_count,
      winnerCount: draw.winner_count,
      participantCount: draw.participant_count,
      totalWeight: draw.total_weight,
      grossPoolCents: String(round.total_pool_cents),
      participantChecksum: draw.participant_checksum,
      participantMerkleRoot: draw.participant_merkle_root,
      claimFeeBps: draw.claim_fee_bps,
      randomnessAccount: draw.randomness_account,
      commitTransactionSignature: draw.commit_transaction_signature,
      revealTransactionSignature: draw.reveal_transaction_signature,
      settlementTransactionSignature: draw.settlement_transaction_signature,
      participants: rows.map((row) => {
        return {
          participantIndex: row.participant_index,
          walletAddress: row.wallet_address,
          eligibleSwapCount: row.eligible_swap_count,
          eligibleVolumeCents: row.eligible_volume_cents,
          eligibleFeeContributionMicroUsd:
            row.eligible_fee_contribution_microusd,
          multiplierBps: row.multiplier_bps,
          referralBoostBps: row.referral_boost_bps,
          weight: row.weight,
          rangeStart: row.range_start,
          rangeEnd: row.range_end,
          leafHash: row.leaf_hash,
        };
      }),
      pagination: {
        offset,
        limit,
        totalParticipants: draw.participant_count,
        nextOffset: nextOffset < draw.participant_count ? nextOffset : null,
      },
      payoutExecutionStatus: "LOCKED_BETA",
      transparencyNote:
        "This immutable participant snapshot was produced from unique, finalized, fee-bearing Walletor swaps. A claim becomes available only after verified Switchboard randomness selects the winners and a matching USDC Merkle distribution is funded through the Solana Foundation Rewards program.",
      createdAt: draw.created_at,
      updatedAt: draw.updated_at,
      serverTime,
    });
  }

  async getAdminUnfundedDraws(
    activeRoundIds: string[],
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PrizeDrawOperationalSummary[]> {
    await this.rollDueRounds(serverTime, rules);
    return this.ctx.storage.sql
      .exec<PrizeDrawOperationalRow>(
        ADMIN_UNFUNDED_DRAWS_SQL,
        serverTime,
        JSON.stringify(activeRoundIds),
      )
      .toArray()
      .map((row) => ({
        roundId: row.round_id,
        status: row.status,
        participantCount: row.participant_count,
        winnerCount: row.winner_count,
        grossPoolCents: String(row.total_pool_cents),
        createdAt: row.created_at,
      }));
  }

  async getPrizeDrawSummariesEndingAt(
    endTime: string,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PrizeDrawOperationalSummary[]> {
    await this.rollDueRounds(serverTime, rules);
    return this.ctx.storage.sql
      .exec<PrizeDrawOperationalRow>(
        `SELECT d.*, r.total_pool_cents, r.start_time
         FROM prize_draws AS d
         INNER JOIN rounds AS r ON r.round_id = d.round_id
         WHERE r.end_time = ?
         ORDER BY r.start_time DESC`,
        endTime,
      )
      .toArray()
      .map((row) => ({
        roundId: row.round_id,
        status: row.status,
        participantCount: row.participant_count,
        winnerCount: row.winner_count,
        grossPoolCents: String(row.total_pool_cents),
        createdAt: row.created_at,
      }));
  }

  async getPublicDistributionCalendar(
    requestedMonth: string | null,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PublicDistributionCalendar> {
    await this.rollDueRounds(serverTime, rules);
    const availableMonths = this.ctx.storage.sql
      .exec<{ month: string }>(
        `SELECT DISTINCT substr(end_time, 1, 7) AS month
         FROM rounds
         WHERE status IN ('ALLOCATED', 'COMPLETED', 'PARTIALLY_PAID')
         ORDER BY month DESC`,
      )
      .toArray()
      .map((row) => row.month);
    const month =
      requestedMonth ?? availableMonths.at(0) ?? serverTime.slice(0, 7);
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!match) throw new Error("Invalid public distribution calendar month.");
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const monthStart = new Date(Date.UTC(year, monthIndex, 1)).toISOString();
    const nextMonthStart = new Date(
      Date.UTC(year, monthIndex + 1, 1),
    ).toISOString();
    const rounds = this.ctx.storage.sql
      .exec<RoundRow>(
        `SELECT * FROM rounds
         WHERE status IN ('ALLOCATED', 'COMPLETED', 'PARTIALLY_PAID')
           AND end_time >= ?
           AND end_time < ?
         ORDER BY end_time DESC
         LIMIT 62`,
        monthStart,
        nextMonthStart,
      )
      .toArray()
      .map((round) => this.publicRound(round));

    return PublicDistributionCalendarSchema.parse({
      month,
      availableMonths,
      rounds,
      serverTime,
    });
  }

  async getWalletEngineState(
    walletAddress: string,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<WalletEngineState> {
    this.upgradeLegacyCurrentRoundRewards(rules);
    await this.rollDueRounds(serverTime, rules);
    const pool = this.pool();
    const round = this.round(pool.active_round_id);
    const participant = this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM participants WHERE round_id = ? AND wallet_address = ?",
        round.round_id,
        walletAddress,
      )
      .toArray()[0];
    const balance = this.ctx.storage.sql
      .exec<{
        lifetime_points: number;
        pending_points: number;
        converted_points: number;
      }>(
        `SELECT lifetime_points, pending_points, converted_points
         FROM wlt_balances WHERE wallet_address = ?`,
        walletAddress,
      )
      .toArray()[0];
    const eligibleSwaps = participant?.eligible_swap_count ?? 0;
    const eligibleVolumeCents = BigInt(participant?.eligible_volume_cents ?? 0);
    const tier = rewardTier(eligibleSwaps);
    const serverDate = new Date(serverTime);
    const dayStart = new Date(
      Date.UTC(
        serverDate.getUTCFullYear(),
        serverDate.getUTCMonth(),
        serverDate.getUTCDate(),
      ),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000);
    const currentDay = this.ctx.storage.sql
      .exec<{
        actual_swaps: number;
        eligible_swaps: number;
        eligible_volume_cents: number;
      }>(
        `SELECT
           COALESCE(SUM(p.actual_swap_count), 0) AS actual_swaps,
           COALESCE(SUM(p.eligible_swap_count), 0) AS eligible_swaps,
           COALESCE(SUM(p.eligible_volume_cents), 0) AS eligible_volume_cents
         FROM participants AS p
         INNER JOIN rounds AS r ON r.round_id = p.round_id
         WHERE p.wallet_address = ?
           AND r.start_time >= ?
           AND r.start_time < ?`,
        walletAddress,
        dayStart.toISOString(),
        dayEnd.toISOString(),
      )
      .one();
    const dayTier = rewardTier(currentDay.eligible_swaps);

    return WalletEngineStateSchema.parse({
      accountingStatus: !rules.accountingEnabled
        ? "DISABLED"
        : pool.distributions_paused === 1
          ? "PAUSED"
          : "LIVE",
      walletAddress,
      pointsLabel: "WLT Points",
      futureAllocationLabel: "Future WLT Airdrop Allocation",
      pointsPerEligibleSwap: rules.wltBasePointsPerEligibleSwap,
      eligibilityPolicy: {
        everyConfirmedFeeBearingSwapCounts: false,
        minimumEligibleSwapUsd: centsToUsdDecimal(
          rules.minimumRewardEligibleSwapCents,
        ),
        transactionSignatureCreditedOnce: true,
      },
      activeRound: {
        roundId: round.round_id,
        status: round.status,
        startTime: round.start_time,
        endTime: round.end_time,
      },
      currentRound: {
        actualSwaps: participant?.actual_swap_count ?? 0,
        eligibleSwaps,
        eligibleVolumeCents: eligibleVolumeCents.toString(),
        active: eligibleSwaps > 0,
        multiplierBps: tier.multiplierBps,
        achievedTier: tier.achievedTier,
        nextTier: tier.nextTier,
        swapsUntilNextTier: tier.swapsUntilNextTier,
      },
      currentDay: {
        actualSwaps: currentDay.actual_swaps,
        eligibleSwaps: currentDay.eligible_swaps,
        eligibleVolumeCents: String(currentDay.eligible_volume_cents),
        active: currentDay.eligible_swaps > 0,
        multiplierBps: dayTier.multiplierBps,
        achievedTier: dayTier.achievedTier,
        nextTier: dayTier.nextTier,
        swapsUntilNextTier: dayTier.swapsUntilNextTier,
      },
      lifetimeWltPoints: String(balance?.lifetime_points ?? 0),
      pendingWltPoints: String(balance?.pending_points ?? 0),
      convertedWltPoints: String(balance?.converted_points ?? 0),
      serverTime,
    });
  }

  exportBackup() {
    return exportLedgerSql(this.ctx.storage.sql);
  }

  getFeeReserveReport(now: string) {
    return readFeeReserve(this.ctx.storage.sql, now);
  }

  getAffiliateReport(query: AffiliateReportQuery, now: string) {
    return readAffiliateReport(this.ctx.storage.sql, query, now);
  }

  getPublicRankings(query: LeaderboardQuery) {
    const roundId = this.pool().active_round_id;
    const bindings = [
      query.period,
      query.period,
      roundId,
      query.period,
      roundId,
    ];
    const entries = this.ctx.storage.sql
      .exec(
        `${RANKINGS_SQL} SELECT * FROM ranked WHERE instr(walletAddress, ?) > 0 ORDER BY rank, walletAddress LIMIT 25 OFFSET ?`,
        ...bindings,
        query.search,
        query.offset,
      )
      .toArray();
    const total = this.ctx.storage.sql
      .exec<{ total: number }>(
        `${RANKINGS_SQL} SELECT COUNT(*) AS total FROM ranked WHERE instr(walletAddress, ?) > 0`,
        ...bindings,
        query.search,
      )
      .one().total;
    const yourPosition = query.wallet
      ? (this.ctx.storage.sql
          .exec(
            `${RANKINGS_SQL} SELECT * FROM ranked WHERE walletAddress = ?`,
            ...bindings,
            query.wallet,
          )
          .toArray()[0] ?? null)
      : null;
    return RankingsSchema.parse({
      entries,
      yourPosition,
      pagination: {
        offset: query.offset,
        total,
        nextOffset: query.offset + 25 < total ? query.offset + 25 : null,
      },
    });
  }

  async getWalletClaimState(
    walletAddress: string,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<ClaimRewardsState> {
    this.upgradeLegacyCurrentRoundRewards(rules);
    await this.rollDueRounds(serverTime, rules);
    const pool = this.pool();
    const activeRound = this.round(pool.active_round_id);
    const allocations = this.ctx.storage.sql
      .exec<ClaimAllocationRow>(
        `SELECT a.allocation_id, a.round_id, r.end_time AS round_end_time,
          a.reward_cents, a.status, a.payout_transaction_hash, a.created_at
         FROM allocations AS a
         INNER JOIN rounds AS r ON r.round_id = a.round_id
         WHERE a.wallet_address = ?
         ORDER BY r.end_time DESC
         LIMIT 25`,
        walletAddress,
      )
      .toArray();
    const pendingRewardsCents = allocations.reduce(
      (total, allocation) =>
        allocation.status === "PAID"
          ? total
          : total + BigInt(allocation.reward_cents),
      0n,
    );
    const lifetimePaidCents = allocations.reduce(
      (total, allocation) =>
        allocation.status === "PAID"
          ? total + BigInt(allocation.reward_cents)
          : total,
      0n,
    );

    return ClaimRewardsStateSchema.parse({
      walletAddress,
      claimSystemStatus: "UNAVAILABLE_BETA",
      activeRound: {
        roundId: activeRound.round_id,
        status: activeRound.status,
        startTime: activeRound.start_time,
        endTime: activeRound.end_time,
      },
      claimableRewardsCents: "0",
      pendingRewardsCents: pendingRewardsCents.toString(),
      lifetimePaidCents: lifetimePaidCents.toString(),
      allocations: allocations.map((allocation) => ({
        allocationId: allocation.allocation_id,
        roundId: allocation.round_id,
        roundEndTime: allocation.round_end_time,
        rewardCents: String(allocation.reward_cents),
        status: allocation.status,
        payoutTransactionHash: allocation.payout_transaction_hash,
        createdAt: allocation.created_at,
      })),
      feePolicy: {
        networkFeePayer: "CLAIMANT",
        networkFeeAsset: "SOL",
        estimatedNetworkFeeLamports: null,
        withdrawalFeeBps: rules.prizePoolClaimFeeBps,
        explanation:
          "Walletor withholds a 2.50% claim fee from gross winnings before funding the USDC distribution. The claiming wallet only pays the Solana network fee.",
      },
      serverTime,
    });
  }

  async getAdminSnapshot(
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<AdminLedgerSnapshot> {
    this.upgradeLegacyCurrentRoundRewards(rules);
    await this.rollDueRounds(serverTime, rules);
    const pool = this.pool();
    const activeRound = this.round(pool.active_round_id);
    const traderRows = this.ctx.storage.sql
      .exec<AdminTraderRow>(
        `WITH order_stats AS (
          SELECT
            json_extract(evidence_json, '$.walletAddress') AS wallet_address,
            MIN(created_at) AS first_active_at,
            MAX(updated_at) AS last_active_at,
            SUM(CASE WHEN status = 'CREDITED' THEN 1 ELSE 0 END) AS confirmed_swaps
          FROM jupiter_swap_orders
          GROUP BY json_extract(evidence_json, '$.walletAddress')
        ), participant_stats AS (
          SELECT wallet_address,
            SUM(eligible_swap_count) AS eligible_swaps,
            SUM(eligible_volume_cents) AS eligible_volume_cents
          FROM participants GROUP BY wallet_address
        )
        SELECT o.wallet_address, o.first_active_at, o.last_active_at,
          o.confirmed_swaps,
          COALESCE(p.eligible_swaps, 0) AS eligible_swaps,
          COALESCE(p.eligible_volume_cents, 0) AS eligible_volume_cents,
          COALESCE(w.lifetime_points, 0) AS lifetime_points,
          COALESCE(w.pending_points, 0) AS pending_points
        FROM order_stats AS o
        LEFT JOIN participant_stats AS p ON p.wallet_address = o.wallet_address
        LEFT JOIN wlt_balances AS w ON w.wallet_address = o.wallet_address
        ORDER BY o.last_active_at DESC
        LIMIT 100`,
      )
      .toArray();
    const recentOrderRows = this.ctx.storage.sql
      .exec<JupiterOrderRow>(
        `SELECT * FROM jupiter_swap_orders
         ORDER BY created_at DESC LIMIT 100`,
      )
      .toArray();
    const requestIds = recentOrderRows.map((row) => row.request_id);
    const feeRows =
      requestIds.length === 0
        ? []
        : this.ctx.storage.sql
            .exec<AdminReferralFeeRow>(
              `SELECT request_id, walletor_fee_atomic
               FROM referral_fee_ledger
               WHERE request_id IN (${requestIds.map(() => "?").join(",")})`,
              ...requestIds,
            )
            .toArray();
    const feeByRequest = new Map(
      feeRows.map((row) => [row.request_id, row.walletor_fee_atomic]),
    );
    const recentSwaps: AdminSwap[] = recentOrderRows.map((row) => {
      const evidence = parseJupiterOrderEvidence(row.evidence_json);
      const result = row.result_json
        ? VerifiedSwapCreditResultSchema.safeParse(JSON.parse(row.result_json))
        : null;
      const credit = result?.success ? result.data : null;
      return {
        requestId: row.request_id,
        transactionHash: row.transaction_hash,
        status: row.status,
        walletAddress: evidence.walletAddress,
        inputMint: evidence.inputMint,
        outputMint: evidence.outputMint,
        inputAmountAtomic: evidence.inputAmountAtomic,
        outputAmountAtomic: evidence.outputAmountAtomic,
        feeMint: evidence.feeMint,
        walletorFeeAtomic: feeByRequest.get(row.request_id) ?? null,
        prizePoolContributionMicroUsd:
          credit?.prizePoolContributionMicroUsd ?? null,
        wltPointsCredited: credit?.wltPointsCredited ?? null,
        accountingError: row.accounting_error,
        accountingAttempts: row.accounting_attempts,
        createdAt: row.created_at,
      };
    });
    const confirmedSwapCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jupiter_swap_orders WHERE status = 'CREDITED'",
      )
      .one().count;
    const traderCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(DISTINCT json_extract(evidence_json, '$.walletAddress')) AS count
         FROM jupiter_swap_orders`,
      )
      .one().count;
    const pendingAccountingCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jupiter_swap_orders WHERE status = 'PENDING'",
      )
      .one().count;
    const accountingFailureCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM jupiter_swap_orders
         WHERE status = 'PENDING' AND accounting_error IS NOT NULL`,
      )
      .one().count;
    const currentEligibleWallets = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM participants
         WHERE round_id = ? AND eligible_swap_count > 0`,
        activeRound.round_id,
      )
      .one().count;
    const wltTotal = this.ctx.storage.sql
      .exec<{ total: number }>(
        "SELECT COALESCE(SUM(lifetime_points), 0) AS total FROM wlt_balances",
      )
      .one().total;

    return AdminLedgerSnapshotSchema.parse({
      accountingStatus: !rules.accountingEnabled
        ? "DISABLED"
        : pool.distributions_paused === 1
          ? "PAUSED"
          : "LIVE",
      poolId: pool.pool_id,
      activeRoundId: activeRound.round_id,
      activeRoundEndsAt: activeRound.end_time,
      currentPrizePoolMicroUsd: pool.current_balance_microusd,
      totalCollectedMicroUsd: pool.total_collected_microusd,
      totalDistributedCents: String(pool.total_distributed_cents),
      platformRevenueCents: String(pool.platform_revenue_cents),
      traderCount,
      confirmedSwapCount,
      pendingAccountingCount,
      accountingFailureCount,
      currentEligibleWallets,
      lifetimeWltPoints: String(wltTotal),
      traders: traderRows.map((row) => ({
        walletAddress: row.wallet_address,
        firstActiveAt: row.first_active_at,
        lastActiveAt: row.last_active_at,
        confirmedSwaps: row.confirmed_swaps,
        eligibleSwaps: row.eligible_swaps,
        eligibleVolumeCents: String(row.eligible_volume_cents),
        lifetimeWltPoints: String(row.lifetime_points),
        pendingWltPoints: String(row.pending_points),
      })),
      recentSwaps,
    });
  }

  async closeDueRounds(
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<PrizePoolState> {
    this.upgradeLegacyCurrentRoundRewards(rules);
    await this.rollDueRounds(serverTime, rules);
    return this.getPublicState(serverTime, rules);
  }

  async closeCurrentRoundForCanary(
    expectedRoundId: string,
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<CanaryRoundCloseOutcome> {
    this.upgradeLegacyCurrentRoundRewards(rules);
    await this.recoverLockedRounds(serverTime);
    const pool = this.pool();
    const active = this.round(pool.active_round_id);
    if (active.round_id !== expectedRoundId) {
      return { status: "REJECTED", reason: "ACTIVE_ROUND_CHANGED" };
    }
    if (active.round_id !== EARLY_CLOSE_ROUND_ID || active.status !== "OPEN") {
      return { status: "REJECTED", reason: "ALREADY_SPLIT" };
    }
    if (
      this.ctx.storage.sql
        .exec<{ round_id: string }>(
          "SELECT round_id FROM prize_draws WHERE round_id = ?",
          active.round_id,
        )
        .toArray().length > 0
    ) {
      return { status: "REJECTED", reason: "ALREADY_SPLIT" };
    }
    const participants = this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM participants WHERE round_id = ? AND eligible_swap_count > 0 ORDER BY wallet_address",
        active.round_id,
      )
      .toArray();
    const eligibleSwapCount = participants.reduce(
      (total, participant) => total + participant.eligible_swap_count,
      0,
    );
    if (participants.length === 0 || eligibleSwapCount === 0) {
      return { status: "REJECTED", reason: "NO_ELIGIBLE_PARTICIPANTS" };
    }
    if (pool.current_balance_cents <= 0) {
      return { status: "REJECTED", reason: "EMPTY_PRIZE_POOL" };
    }

    let continuation: RoundWindow;
    try {
      continuation = canaryContinuationRoundWindow(
        {
          roundId: active.round_id,
          startTime: active.start_time,
          endTime: active.end_time,
        },
        new Date(serverTime),
      );
      // Keep the existing active-window validation, then start a full daily
      // window rather than a partial window ending at midnight.
      continuation = rollingDailyRoundWindow(new Date(serverTime));
    } catch {
      return { status: "REJECTED", reason: "OUTSIDE_ACTIVE_WINDOW" };
    }

    const snapshot = this.lockRoundAndOpenNext(
      pool,
      active,
      serverTime,
      rules.prizePoolWinnerCount,
      rules.prizePoolClaimFeeBps,
      rules.roundDurationHours,
      continuation,
    );
    await this.stagePrizeDraw(snapshot, serverTime);
    await this.finalizeLockedRound(snapshot, serverTime);
    return {
      status: "CLOSED",
      result: {
        closedRoundId: active.round_id,
        continuationRoundId: continuation.roundId,
        closedAt: serverTime,
        continuationEndsAt: continuation.endTime,
        participantCount: participants.length,
        eligibleSwapCount,
        grossPoolCents: String(pool.current_balance_cents),
      },
    };
  }

  private pool(): PoolRow {
    return this.ctx.storage.sql
      .exec<PoolRow>("SELECT * FROM pool_state WHERE singleton = 1")
      .one();
  }

  private round(roundId: string): RoundRow {
    return this.ctx.storage.sql
      .exec<RoundRow>("SELECT * FROM rounds WHERE round_id = ?", roundId)
      .one();
  }

  private upgradeLegacyCurrentRoundRewards(rules: CoordinatorRules): void {
    if (!rules.accountingEnabled) return;
    const pointsPerSwap = BigInt(rules.wltBasePointsPerEligibleSwap);
    if (pointsPerSwap <= 0n) return;

    const activeRoundId = this.pool().active_round_id;
    const legacyCredits = this.ctx.storage.sql
      .exec<LegacyRewardCreditRow>(
        `SELECT p.transaction_hash, p.result_json, o.evidence_json, p.created_at
         FROM processed_swaps AS p
         INNER JOIN jupiter_swap_orders AS o
           ON o.transaction_hash = p.transaction_hash
         WHERE p.round_id = ?
         ORDER BY p.created_at ASC`,
        activeRoundId,
      )
      .toArray()
      .filter((row) => {
        const result = parseJsonResult(row.result_json);
        return (
          !result.rewardEligible &&
          (result.eligibilityReason === "BELOW_MINIMUM_SWAP" ||
            result.eligibilityReason === "ROUND_WALLET_CAP_REACHED")
        );
      });

    for (const legacy of legacyCredits) {
      const existingWltCredit = this.ctx.storage.sql
        .exec<{ entry_id: string }>(
          "SELECT entry_id FROM wlt_ledger WHERE idempotency_key = ?",
          `wlt:${legacy.transaction_hash}`,
        )
        .toArray()[0];
      if (existingWltCredit) continue;

      const order = parseJupiterOrderEvidence(legacy.evidence_json);
      const participant = this.ctx.storage.sql
        .exec<ParticipantRow>(
          "SELECT * FROM participants WHERE round_id = ? AND wallet_address = ?",
          activeRoundId,
          order.walletAddress,
        )
        .toArray()[0];
      if (!participant) {
        throw new Error(
          "A legacy confirmed swap is missing its participant record.",
        );
      }

      const swapValueCents = usdDecimalToCents(order.valuationUsdDecimal);
      const eligibleSwapCount = participant.eligible_swap_count + 1;
      const eligibleVolumeCents =
        BigInt(participant.eligible_volume_cents) + swapValueCents;
      const tier = rewardTier(eligibleSwapCount);
      const result = parseJsonResult(legacy.result_json);
      const resultingLifetimeWltPoints =
        this.lifetimeWltPoints(order.walletAddress) + pointsPerSwap;
      const upgradedResult = VerifiedSwapCreditResultSchema.parse({
        ...result,
        rewardEligible: true,
        eligibilityReason: "ELIGIBLE",
        wltPointsCredited: pointsPerSwap.toString(),
        resultingLifetimeWltPoints: resultingLifetimeWltPoints.toString(),
      });
      const eligibleFeeContributionMicroUsd =
        BigInt(participant.eligible_fee_contribution_microusd) +
        BigInt(result.prizePoolContributionMicroUsd ?? "0");

      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `UPDATE participants SET
            eligible_swap_count = ?, eligible_volume_cents = ?,
            eligible_fee_contribution_microusd = ?, multiplier_bps = ?,
            achieved_tier = ?, next_tier = ?,
            swaps_until_next_tier = ?, calculated_weight = ?,
            last_eligible_swap_at = ?, updated_at = ?
           WHERE round_id = ? AND wallet_address = ?`,
          eligibleSwapCount,
          toSafeInteger(eligibleVolumeCents, "Eligible volume valuation"),
          eligibleFeeContributionMicroUsd.toString(),
          tier.multiplierBps,
          tier.achievedTier,
          tier.nextTier,
          tier.swapsUntilNextTier,
          toSafeInteger(
            calculateRewardWeight(
              eligibleSwapCount,
              eligibleVolumeCents,
              tier.multiplierBps,
            ),
            "Reward weight",
          ),
          legacy.created_at,
          legacy.created_at,
          activeRoundId,
          order.walletAddress,
        );
        this.creditWlt(
          activeRoundId,
          order.walletAddress,
          legacy.transaction_hash,
          pointsPerSwap,
          legacy.created_at,
        );
        this.ctx.storage.sql.exec(
          "UPDATE processed_swaps SET result_json = ? WHERE chain_id = ? AND transaction_hash = ?",
          JSON.stringify(upgradedResult),
          rules.chainId,
          legacy.transaction_hash,
        );
        this.ctx.storage.sql.exec(
          "UPDATE jupiter_swap_orders SET result_json = ?, updated_at = ? WHERE transaction_hash = ?",
          JSON.stringify(upgradedResult),
          legacy.created_at,
          legacy.transaction_hash,
        );
      });
    }
  }

  private async rollDueRounds(
    serverTime: string,
    rules: CoordinatorRules,
  ): Promise<void> {
    await this.recoverLockedRounds(serverTime);
    const applySeed = () => {
      if (!rules.accountingEnabled || rules.roundDurationHours !== 24) return;
      this.ctx.storage.transactionSync(() => {
        applyDailyPrizeSeed(
          this.ctx.storage.sql,
          this.env.SOLANA_CLAIM_AUTHORITY_ADDRESS.trim(),
          serverTime,
        );
      });
    };
    applySeed();
    let pool = this.pool();
    let active = this.round(pool.active_round_id);
    active = this.alignOpenRoundToCadence(
      pool,
      active,
      serverTime,
      rules.roundDurationHours,
    );
    while (Date.parse(active.end_time) <= Date.parse(serverTime)) {
      // A historical retry must never reuse a closed round or relock its funds.
      // Preserve its allocations and resume with a fresh partial UTC window.
      if (active.status !== "OPEN") {
        const window = utcRoundWindow(
          new Date(serverTime),
          pool.pool_id,
          rules.roundDurationHours,
        );
        const roundId = `${pool.pool_id}:recovery:${serverTime}`;
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            `INSERT INTO rounds (
              round_id, status, start_time, end_time, locked_at, completed_at,
              total_pool_cents, total_eligible_swaps, total_eligible_volume_cents,
              eligible_wallet_count, allocation_checksum, remainder_cents,
              failure_reason, closure_idempotency_key, updated_at
            ) VALUES (?, 'OPEN', ?, ?, NULL, NULL, 0, 0, 0, 0, NULL, 0, NULL, ?, ?)`,
            roundId,
            serverTime,
            window.endTime,
            `round-close:${roundId}`,
            serverTime,
          );
          this.ctx.storage.sql.exec(
            "UPDATE pool_state SET active_round_id = ?, updated_at = ? WHERE singleton = 1",
            roundId,
            serverTime,
          );
          this.insertLedger(
            roundId,
            pool.chain_id,
            null,
            "ROUND_CURSOR_RECOVERED",
            0n,
            `round-cursor-recovered:${active.round_id}:${roundId}`,
            "Resumed an open UTC round after encountering a closed active round; prior allocations and balances preserved.",
            serverTime,
          );
        });
        return;
      }
      const snapshot = this.lockRoundAndOpenNext(
        pool,
        active,
        serverTime,
        rules.prizePoolWinnerCount,
        rules.prizePoolClaimFeeBps,
        rules.roundDurationHours,
      );
      await this.stagePrizeDraw(snapshot, serverTime);
      await this.finalizeLockedRound(snapshot, serverTime);
      applySeed();
      pool = this.pool();
      active = this.round(pool.active_round_id);
    }
    if (!rules.accountingEnabled) return;
  }

  private alignOpenRoundToCadence(
    pool: PoolRow,
    round: RoundRow,
    serverTime: string,
    roundDurationHours: number,
  ): RoundRow {
    if (isRollingDailyRound(round.round_id)) return round;
    const serverTimeMs = Date.parse(serverTime);
    const currentEndMs = Date.parse(round.end_time);
    const targetEndTime = alignedOpenRoundEnd(
      round.start_time,
      round.end_time,
      serverTime,
      roundDurationHours,
    );
    const targetEndMs = Date.parse(targetEndTime);
    if (
      round.status !== "OPEN" ||
      serverTimeMs < Date.parse(round.start_time) ||
      currentEndMs <= serverTimeMs ||
      targetEndMs === currentEndMs
    ) {
      return round;
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE rounds SET end_time = ?, updated_at = ? WHERE round_id = ? AND status = 'OPEN' AND end_time = ?",
        targetEndTime,
        serverTime,
        round.round_id,
        round.end_time,
      );
      this.insertLedger(
        round.round_id,
        pool.chain_id,
        null,
        "ROUND_CADENCE_UPDATED",
        0n,
        `round-cadence:${round.round_id}:${targetEndTime}`,
        `Open round aligned to the configured ${String(roundDurationHours)}-hour UTC cadence.`,
        serverTime,
      );
    });
    return this.round(round.round_id);
  }

  private async recoverLockedRounds(serverTime: string): Promise<void> {
    const lockedRounds = this.ctx.storage.sql
      .exec<RoundRow>(
        "SELECT * FROM rounds WHERE status = 'LOCKED' ORDER BY start_time",
      )
      .toArray();
    for (const round of lockedRounds) {
      const snapshot = this.lockedRoundSnapshot(round);
      await this.stagePrizeDraw(snapshot, serverTime);
      await this.finalizeLockedRound(snapshot, serverTime);
    }
  }

  private lockedRoundSnapshot(round: RoundRow): LockedRoundSnapshot {
    return {
      round,
      lockedPoolCents: BigInt(round.total_pool_cents),
      participants: this.ctx.storage.sql
        .exec<ParticipantRow>(
          "SELECT * FROM participants WHERE round_id = ? AND eligible_swap_count > 0 ORDER BY wallet_address",
          round.round_id,
        )
        .toArray(),
    };
  }

  private lockRoundAndOpenNext(
    pool: PoolRow,
    round: RoundRow,
    serverTime: string,
    configuredWinnerCount: number,
    claimFeeBps: number,
    roundDurationHours: number,
    nextWindowOverride?: RoundWindow,
  ): LockedRoundSnapshot {
    const participants = this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM participants WHERE round_id = ? AND eligible_swap_count > 0 ORDER BY wallet_address",
        round.round_id,
      )
      .toArray();
    const totalEligibleSwaps = participants.reduce(
      (total, participant) => total + participant.eligible_swap_count,
      0,
    );
    const totalEligibleVolumeCents = participants.reduce(
      (total, participant) => total + participant.eligible_volume_cents,
      0,
    );
    const lockedPoolCents = BigInt(pool.current_balance_cents);
    const carriedMicroUsd =
      BigInt(pool.current_balance_microusd) - lockedPoolCents * 10_000n;
    if (carriedMicroUsd < 0n) {
      throw new Error("Prize Pool micro-USD balance is inconsistent.");
    }
    const nextWindow =
      nextWindowOverride ??
      (isRollingDailyRound(round.round_id)
        ? rollingDailyRoundWindow(new Date(round.end_time))
        : nextRoundWindow(
            new Date(round.end_time),
            pool.pool_id,
            roundDurationHours,
          ));
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE rounds SET status = 'LOCKED', locked_at = ?, end_time = ?,
          total_pool_cents = ?, total_eligible_swaps = ?,
          total_eligible_volume_cents = ?, eligible_wallet_count = ?,
          draw_winner_count = ?, draw_claim_fee_bps = ?, updated_at = ?
          WHERE round_id = ? AND status = 'OPEN'`,
        serverTime,
        nextWindowOverride ? serverTime : round.end_time,
        pool.current_balance_cents,
        totalEligibleSwaps,
        totalEligibleVolumeCents,
        participants.length,
        configuredWinnerCount,
        claimFeeBps,
        serverTime,
        round.round_id,
      );
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO rounds (
          round_id, status, start_time, end_time, locked_at, completed_at,
          total_pool_cents, total_eligible_swaps, total_eligible_volume_cents,
          eligible_wallet_count, allocation_checksum, remainder_cents,
          failure_reason, closure_idempotency_key, updated_at
        ) VALUES (?, 'OPEN', ?, ?, NULL, NULL, 0, 0, 0, 0, NULL, 0, NULL, ?, ?)`,
        nextWindow.roundId,
        nextWindow.startTime,
        nextWindow.endTime,
        `round-close:${nextWindow.roundId}`,
        serverTime,
      );
      this.ctx.storage.sql.exec(
        "UPDATE pool_state SET current_balance_cents = 0, current_balance_microusd = ?, active_round_id = ?, updated_at = ? WHERE singleton = 1",
        carriedMicroUsd.toString(),
        nextWindow.roundId,
        serverTime,
      );
      this.insertLedger(
        round.round_id,
        pool.chain_id,
        null,
        "ROUND_LOCKED",
        0n,
        `round-lock:${round.round_id}`,
        nextWindowOverride
          ? "Authorized one-time early close; next round runs for 24 hours from closure."
          : "Round balance and eligible participants locked at the scheduled boundary.",
        serverTime,
      );
    });
    return {
      round: this.round(round.round_id),
      lockedPoolCents,
      participants,
    };
  }

  private async stagePrizeDraw(
    snapshot: LockedRoundSnapshot,
    serverTime: string,
  ): Promise<void> {
    const existing = this.ctx.storage.sql
      .exec<PrizeDrawRow>(
        "SELECT * FROM prize_draws WHERE round_id = ?",
        snapshot.round.round_id,
      )
      .toArray()[0];
    if (existing) {
      if (
        (existing.algorithm_version !== REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION &&
          existing.algorithm_version !== PRIZE_DRAW_ALGORITHM_VERSION &&
          existing.algorithm_version !==
            WEIGHTED_PRIZE_DRAW_ALGORITHM_VERSION &&
          existing.algorithm_version !== LEGACY_PRIZE_DRAW_ALGORITHM_VERSION) ||
        existing.configured_winner_count !== snapshot.round.draw_winner_count ||
        existing.claim_fee_bps !== snapshot.round.draw_claim_fee_bps
      ) {
        throw new Error("Locked Prize Draw policy cannot change.");
      }
      return;
    }

    const draw = await buildPrizeDrawSnapshot(
      snapshot.round.round_id,
      snapshot.round.draw_winner_count,
      snapshot.participants.map((participant) => ({
        walletAddress: participant.wallet_address,
        eligibleSwapCount: participant.eligible_swap_count,
        eligibleVolumeCents: BigInt(participant.eligible_volume_cents),
        eligibleFeeContributionMicroUsd: BigInt(
          participant.eligible_fee_contribution_microusd,
        ),
        multiplierBps: rewardTier(participant.eligible_swap_count)
          .multiplierBps,
        referralBoostBps: new WalletReferrals(this.ctx.storage.sql).boost(
          participant.wallet_address,
          snapshot.round.round_id,
          snapshot.round.start_time,
        ),
      })),
      snapshot.round.start_time >=
        new WalletReferrals(this.ctx.storage.sql).startsAt()
        ? REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION
        : PRIZE_DRAW_ALGORITHM_VERSION,
    );

    this.ctx.storage.transactionSync(() => {
      const inserted = this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO prize_draws (
          round_id, status, algorithm_version, configured_winner_count,
          winner_count, participant_count, total_weight,
          participant_checksum, participant_merkle_root, claim_fee_bps,
          randomness_account, commit_transaction_signature,
          reveal_transaction_signature, settlement_transaction_signature,
          failure_reason, created_at, updated_at
        ) VALUES (?, 'SNAPSHOT_LOCKED', ?, ?, ?, ?, ?, ?, ?, ?,
          NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        draw.roundId,
        draw.algorithmVersion,
        draw.configuredWinnerCount,
        draw.winnerCount,
        draw.participantCount,
        draw.totalWeight.toString(),
        draw.participantChecksum,
        draw.participantMerkleRoot,
        snapshot.round.draw_claim_fee_bps,
        serverTime,
        serverTime,
      );
      if (inserted.rowsWritten === 0) return;
      for (const participant of draw.participants) {
        this.ctx.storage.sql.exec(
          `INSERT INTO prize_draw_participants (
            round_id, participant_index, wallet_address,
            eligible_swap_count, eligible_volume_cents,
            eligible_fee_contribution_microusd, multiplier_bps, weight,
            range_start, range_end, leaf_hash, referral_boost_bps
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          draw.roundId,
          participant.participantIndex,
          participant.walletAddress,
          participant.eligibleSwapCount,
          participant.eligibleVolumeCents.toString(),
          participant.eligibleFeeContributionMicroUsd.toString(),
          participant.multiplierBps,
          participant.weight.toString(),
          participant.rangeStart.toString(),
          participant.rangeEnd.toString(),
          participant.leafHash,
          participant.referralBoostBps ?? 0,
        );
      }
    });
  }

  private async finalizeLockedRound(
    snapshot: LockedRoundSnapshot,
    serverTime: string,
  ): Promise<void> {
    const participants: RewardParticipant[] = snapshot.participants.map(
      (participant) => {
        const eligibleVolumeCents = BigInt(participant.eligible_volume_cents);
        return {
          walletAddress: participant.wallet_address,
          eligibleSwapCount: participant.eligible_swap_count,
          eligibleVolumeCents,
          multiplierBps: rewardTier(participant.eligible_swap_count)
            .multiplierBps,
        };
      },
    );
    const result = await allocateRoundRewards(
      snapshot.lockedPoolCents,
      participants,
    );
    this.ctx.storage.transactionSync(() => {
      for (const allocation of result.allocations) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO allocations (
            allocation_id, round_id, wallet_address, eligible_swap_count,
            eligible_volume_cents, multiplier_bps, calculated_weight,
            share_numerator, share_denominator, reward_cents, status,
            idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLAIM_UNAVAILABLE_BETA', ?, ?)`,
          crypto.randomUUID(),
          snapshot.round.round_id,
          allocation.walletAddress,
          allocation.eligibleSwapCount,
          toSafeInteger(allocation.eligibleVolumeCents, "Eligible volume"),
          allocation.multiplierBps,
          toSafeInteger(allocation.calculatedWeight, "Reward weight"),
          allocation.shareNumerator.toString(),
          allocation.shareDenominator.toString(),
          toSafeInteger(allocation.rewardCents, "Reward allocation"),
          `allocation:${snapshot.round.round_id}:${allocation.walletAddress}`,
          serverTime,
        );
      }
      const status =
        result.allocations.length === 0 ? "COMPLETED" : "ALLOCATED";
      this.ctx.storage.sql.exec(
        `UPDATE rounds SET status = ?, allocation_checksum = ?,
          remainder_cents = ?, completed_at = ?, updated_at = ?
          WHERE round_id = ? AND status = 'LOCKED'`,
        status,
        result.checksum,
        toSafeInteger(result.remainderCents, "Round remainder"),
        status === "COMPLETED" ? serverTime : null,
        serverTime,
        snapshot.round.round_id,
      );
      if (result.remainderCents > 0n) {
        const currentPool = this.pool();
        const resultingBalanceCents =
          BigInt(currentPool.current_balance_cents) + result.remainderCents;
        const resultingBalanceMicroUsd =
          BigInt(currentPool.current_balance_microusd) +
          result.remainderCents * 10_000n;
        this.ctx.storage.sql.exec(
          `UPDATE pool_state SET
            current_balance_cents = ?,
            current_balance_microusd = ?,
            remainder_carried_cents = remainder_carried_cents + ?,
            updated_at = ? WHERE singleton = 1`,
          toSafeInteger(resultingBalanceCents, "Prize Pool balance"),
          resultingBalanceMicroUsd.toString(),
          toSafeInteger(result.remainderCents, "Round remainder"),
          serverTime,
        );
        this.insertLedger(
          snapshot.round.round_id,
          this.pool().chain_id,
          null,
          "ROUND_REMAINDER",
          result.remainderCents,
          `round-remainder:${snapshot.round.round_id}`,
          "Deterministic cent-flooring remainder carried into the next round.",
          serverTime,
        );
      }
    });
  }

  private insertLedger(
    roundId: string,
    chainId: string,
    transactionHash: string | null,
    action: string,
    amountCents: bigint,
    idempotencyKey: string,
    reason: string,
    createdAt: string,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO ledger (
        ledger_entry_id, round_id, chain_id, transaction_hash, action,
        amount_cents, idempotency_key, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      roundId,
      chainId,
      transactionHash,
      action,
      toSafeInteger(amountCents, "Ledger amount"),
      idempotencyKey,
      reason,
      createdAt,
    );
  }

  private upsertParticipant(
    roundId: string,
    input: VerifiedSwapCreditInput,
    existing: ParticipantRow | undefined,
    eligible: boolean,
    flaggedForReview: boolean,
    tier: ReturnType<typeof rewardTier>,
  ): void {
    const actualSwapCount = (existing?.actual_swap_count ?? 0) + 1;
    const eligibleSwapCount =
      (existing?.eligible_swap_count ?? 0) + (eligible ? 1 : 0);
    const eligibleVolumeCents =
      BigInt(existing?.eligible_volume_cents ?? 0) +
      (eligible ? BigInt(input.verifiedSwapValueCents) : 0n);
    const eligibleFeeContributionMicroUsd =
      BigInt(existing?.eligible_fee_contribution_microusd ?? "0") +
      (eligible ? BigInt(input.verifiedWalletorFeeCents) * 10_000n : 0n);
    this.ctx.storage.sql.exec(
      `INSERT INTO participants (
        round_id, wallet_address, actual_swap_count, eligible_swap_count,
        eligible_volume_cents, eligible_fee_contribution_microusd,
        multiplier_bps, achieved_tier, next_tier, swaps_until_next_tier,
        calculated_weight, last_eligible_swap_at, flagged_for_review, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(round_id, wallet_address) DO UPDATE SET
        actual_swap_count = excluded.actual_swap_count,
        eligible_swap_count = excluded.eligible_swap_count,
        eligible_volume_cents = excluded.eligible_volume_cents,
        eligible_fee_contribution_microusd = excluded.eligible_fee_contribution_microusd,
        multiplier_bps = excluded.multiplier_bps,
        achieved_tier = excluded.achieved_tier,
        next_tier = excluded.next_tier,
        swaps_until_next_tier = excluded.swaps_until_next_tier,
        calculated_weight = excluded.calculated_weight,
        last_eligible_swap_at = excluded.last_eligible_swap_at,
        flagged_for_review = MAX(participants.flagged_for_review, excluded.flagged_for_review),
        updated_at = excluded.updated_at`,
      roundId,
      input.walletAddress,
      actualSwapCount,
      eligibleSwapCount,
      toSafeInteger(eligibleVolumeCents, "Eligible volume"),
      eligibleFeeContributionMicroUsd.toString(),
      tier.multiplierBps,
      tier.achievedTier,
      tier.nextTier,
      tier.swapsUntilNextTier,
      eligibleSwapCount > 0
        ? toSafeInteger(
            calculateRewardWeight(
              eligibleSwapCount,
              eligibleVolumeCents,
              tier.multiplierBps,
            ),
            "Reward weight",
          )
        : 0,
      eligible ? input.blockTime : (existing?.last_eligible_swap_at ?? null),
      flaggedForReview ? 1 : 0,
      input.finalizedAt,
    );
  }

  private upsertJupiterParticipant(
    roundId: string,
    walletAddress: string,
    swapEstimatedUsdCents: bigint,
    walletorFeeEstimatedMicroUsd: bigint,
    confirmedAt: string,
    existing: ParticipantRow | undefined,
    eligible: boolean,
    tier: ReturnType<typeof rewardTier>,
  ): void {
    const actualSwapCount = (existing?.actual_swap_count ?? 0) + 1;
    const eligibleSwapCount =
      (existing?.eligible_swap_count ?? 0) + (eligible ? 1 : 0);
    const eligibleVolumeCents =
      BigInt(existing?.eligible_volume_cents ?? 0) +
      (eligible ? swapEstimatedUsdCents : 0n);
    const eligibleFeeContributionMicroUsd =
      BigInt(existing?.eligible_fee_contribution_microusd ?? "0") +
      (eligible ? walletorFeeEstimatedMicroUsd : 0n);
    this.ctx.storage.sql.exec(
      `INSERT INTO participants (
        round_id, wallet_address, actual_swap_count, eligible_swap_count,
        eligible_volume_cents, eligible_fee_contribution_microusd,
        multiplier_bps, achieved_tier, next_tier, swaps_until_next_tier,
        calculated_weight, last_eligible_swap_at, flagged_for_review, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(round_id, wallet_address) DO UPDATE SET
        actual_swap_count = excluded.actual_swap_count,
        eligible_swap_count = excluded.eligible_swap_count,
        eligible_volume_cents = excluded.eligible_volume_cents,
        eligible_fee_contribution_microusd = excluded.eligible_fee_contribution_microusd,
        multiplier_bps = excluded.multiplier_bps,
        achieved_tier = excluded.achieved_tier,
        next_tier = excluded.next_tier,
        swaps_until_next_tier = excluded.swaps_until_next_tier,
        calculated_weight = excluded.calculated_weight,
        last_eligible_swap_at = excluded.last_eligible_swap_at,
        updated_at = excluded.updated_at`,
      roundId,
      walletAddress,
      actualSwapCount,
      eligibleSwapCount,
      toSafeInteger(eligibleVolumeCents, "Eligible volume valuation"),
      eligibleFeeContributionMicroUsd.toString(),
      tier.multiplierBps,
      tier.achievedTier,
      tier.nextTier,
      tier.swapsUntilNextTier,
      eligibleSwapCount > 0
        ? toSafeInteger(
            calculateRewardWeight(
              eligibleSwapCount,
              eligibleVolumeCents,
              tier.multiplierBps,
            ),
            "Reward weight",
          )
        : 0,
      eligible ? confirmedAt : (existing?.last_eligible_swap_at ?? null),
      confirmedAt,
    );
  }

  private creditWlt(
    roundId: string,
    walletAddress: string,
    sourceTransaction: string,
    delta: bigint,
    createdAt: string,
  ): void {
    const resultingBalance = this.lifetimeWltPoints(walletAddress) + delta;
    this.ctx.storage.sql.exec(
      `INSERT INTO wlt_balances (
        wallet_address, lifetime_points, pending_points, converted_points, updated_at
      ) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET
        lifetime_points = excluded.lifetime_points,
        pending_points = excluded.pending_points,
        updated_at = excluded.updated_at`,
      walletAddress,
      toSafeInteger(resultingBalance, "WLT lifetime points"),
      toSafeInteger(resultingBalance, "WLT pending points"),
      createdAt,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO wlt_ledger (
        entry_id, round_id, wallet_address, source_transaction, delta,
        resulting_balance, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      roundId,
      walletAddress,
      sourceTransaction,
      toSafeInteger(delta, "WLT point credit"),
      toSafeInteger(resultingBalance, "WLT lifetime points"),
      `wlt:${sourceTransaction}`,
      createdAt,
    );
  }

  private lifetimeWltPoints(walletAddress: string): bigint {
    const lifetimePoints =
      this.ctx.storage.sql
        .exec<{ lifetime_points: number }>(
          "SELECT lifetime_points FROM wlt_balances WHERE wallet_address = ?",
          walletAddress,
        )
        .toArray()[0]?.lifetime_points ?? 0;
    return BigInt(lifetimePoints);
  }

  private publicRound(round: RoundRow, openPoolCents?: number): PublicRound {
    return {
      roundId: round.round_id,
      status: round.status,
      startTime: round.start_time,
      endTime: round.end_time,
      lockedAt: round.locked_at,
      completedAt: round.completed_at,
      totalPoolCents: String(openPoolCents ?? round.total_pool_cents),
      totalEligibleSwaps: round.total_eligible_swaps,
      totalEligibleVolumeCents: String(round.total_eligible_volume_cents),
      eligibleWalletCount: round.eligible_wallet_count,
      allocationChecksum: round.allocation_checksum,
      remainderCents: String(round.remainder_cents),
      failedPayoutCount: 0,
      payoutTransactionHashes: [],
    };
  }
}
