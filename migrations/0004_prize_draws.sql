PRAGMA foreign_keys = ON;

ALTER TABLE rounds
  ADD COLUMN draw_winner_count INTEGER NOT NULL DEFAULT 20
  CHECK (draw_winner_count BETWEEN 1 AND 100);

ALTER TABLE rounds
  ADD COLUMN draw_claim_fee_bps INTEGER NOT NULL DEFAULT 50
  CHECK (draw_claim_fee_bps BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS prize_draws (
  round_id TEXT PRIMARY KEY REFERENCES rounds(round_id),
  status TEXT NOT NULL CHECK (status IN (
    'SNAPSHOT_LOCKED',
    'RANDOMNESS_COMMITTED',
    'RANDOMNESS_REVEALED',
    'WINNERS_SELECTED',
    'ONCHAIN_SETTLED',
    'COMPLETED',
    'FAILED'
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
  gross_pool_lamports TEXT,
  round_vault_address TEXT,
  vault_funding_transaction_signature TEXT,
  randomness_account TEXT,
  randomness_commit_slot TEXT,
  commit_transaction_signature TEXT,
  reveal_transaction_signature TEXT,
  settlement_transaction_signature TEXT,
  public_snapshot_url TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prize_draw_participants (
  round_id TEXT NOT NULL REFERENCES prize_draws(round_id),
  participant_index INTEGER NOT NULL CHECK (participant_index >= 0),
  wallet_address TEXT NOT NULL,
  eligible_swap_count INTEGER NOT NULL CHECK (eligible_swap_count > 0),
  multiplier_bps INTEGER NOT NULL
    CHECK (multiplier_bps IN (10000, 11000, 12500, 15000)),
  weight TEXT NOT NULL CHECK (weight GLOB '[0-9]*'),
  range_start TEXT NOT NULL CHECK (range_start GLOB '[0-9]*'),
  range_end TEXT NOT NULL CHECK (range_end GLOB '[0-9]*'),
  leaf_hash TEXT NOT NULL,
  PRIMARY KEY (round_id, participant_index),
  UNIQUE (round_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS prize_draw_winners (
  round_id TEXT NOT NULL REFERENCES prize_draws(round_id),
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
      'PENDING_SETTLEMENT',
      'CLAIMABLE',
      'CLAIMED',
      'EXPIRED',
      'FAILED'
    )
  ),
  claim_transaction_signature TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (round_id, winner_rank),
  UNIQUE (round_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_prize_draws_status_created
  ON prize_draws(status, created_at);
CREATE INDEX IF NOT EXISTS idx_prize_draw_participants_wallet
  ON prize_draw_participants(wallet_address, round_id);
CREATE INDEX IF NOT EXISTS idx_prize_draw_winners_wallet
  ON prize_draw_winners(wallet_address, round_id);

CREATE TRIGGER IF NOT EXISTS prize_draw_policy_no_update
BEFORE UPDATE OF algorithm_version, configured_winner_count,
  winner_count, participant_count, total_weight,
  participant_checksum, participant_merkle_root, claim_fee_bps
ON prize_draws
BEGIN
  SELECT RAISE(ABORT, 'locked prize draw policy is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prize_draws_no_delete
BEFORE DELETE ON prize_draws
BEGIN
  SELECT RAISE(ABORT, 'prize draws cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS prize_draw_participants_no_update
BEFORE UPDATE ON prize_draw_participants
BEGIN
  SELECT RAISE(ABORT, 'prize draw participants are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prize_draw_participants_no_delete
BEFORE DELETE ON prize_draw_participants
BEGIN
  SELECT RAISE(ABORT, 'prize draw participants are immutable');
END;
