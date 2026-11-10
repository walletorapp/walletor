PRAGMA defer_foreign_keys = TRUE;

-- Preserve every historical V2 distribution while allowing newly locked V3
-- hybrid rounds. SQLite cannot widen a CHECK constraint in place, so both the
-- parent and child tables are rebuilt together.
DROP TRIGGER IF EXISTS usdc_claim_entitlements_immutable_terms;
DROP TRIGGER IF EXISTS usdc_claim_entitlements_no_delete;
DROP TRIGGER IF EXISTS usdc_claim_distributions_immutable_terms;
DROP TRIGGER IF EXISTS usdc_claim_distributions_no_delete;
DROP INDEX IF EXISTS idx_usdc_claim_entitlements_wallet;
DROP INDEX IF EXISTS idx_usdc_claim_distributions_status;

ALTER TABLE usdc_claim_distributions
  RENAME TO usdc_claim_distributions_v2;
ALTER TABLE usdc_claim_entitlements
  RENAME TO usdc_claim_entitlements_v2;

CREATE TABLE usdc_claim_distributions (
  round_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('STAGED', 'ACTIVE', 'CLOSED', 'FAILED')),
  source_revision TEXT NOT NULL,
  prize_draw_algorithm_version TEXT NOT NULL CHECK (
    prize_draw_algorithm_version IN (
      'SWITCHBOARD_WEIGHTED_UNIQUE_V2',
      'SWITCHBOARD_HYBRID_FEE_VOLUME_V3'
    )
  ),
  randomness_account TEXT NOT NULL,
  randomness_value TEXT NOT NULL,
  randomness_commit_transaction_signature TEXT NOT NULL UNIQUE,
  randomness_reveal_transaction_signature TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL CHECK (network = 'MAINNET'),
  provider TEXT NOT NULL CHECK (provider = 'SOLANA_FOUNDATION_REWARDS'),
  program_id TEXT NOT NULL,
  mint_address TEXT NOT NULL,
  mint_symbol TEXT NOT NULL CHECK (mint_symbol = 'USDC'),
  mint_decimals INTEGER NOT NULL CHECK (mint_decimals = 6),
  authority_address TEXT NOT NULL,
  seed_address TEXT NOT NULL UNIQUE,
  distribution_address TEXT NOT NULL UNIQUE,
  distribution_vault_address TEXT NOT NULL UNIQUE,
  merkle_root TEXT NOT NULL,
  gross_prize_amount_atomic TEXT NOT NULL,
  claim_fee_amount_atomic TEXT NOT NULL,
  net_distribution_amount_atomic TEXT NOT NULL,
  claim_fee_bps INTEGER NOT NULL CHECK (claim_fee_bps = 250),
  clawback_unix_timestamp TEXT NOT NULL,
  create_transaction_signature TEXT NOT NULL UNIQUE,
  manifest_checksum TEXT NOT NULL UNIQUE,
  staged_at TEXT NOT NULL,
  staged_by TEXT NOT NULL,
  activated_at TEXT,
  activated_by TEXT,
  failure_reason TEXT
);

CREATE TABLE usdc_claim_entitlements (
  entitlement_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES usdc_claim_distributions(round_id),
  winner_address TEXT NOT NULL,
  winner_rank INTEGER NOT NULL CHECK (winner_rank BETWEEN 1 AND 100),
  gross_amount_atomic TEXT NOT NULL,
  claim_fee_amount_atomic TEXT NOT NULL,
  net_amount_atomic TEXT NOT NULL,
  leaf_hash TEXT NOT NULL,
  proof_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMABLE', 'CLAIMED', 'EXPIRED')),
  claim_transaction_signature TEXT UNIQUE,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (round_id, winner_address),
  UNIQUE (round_id, winner_rank)
);

INSERT INTO usdc_claim_distributions
SELECT * FROM usdc_claim_distributions_v2;

INSERT INTO usdc_claim_entitlements
SELECT * FROM usdc_claim_entitlements_v2;

DROP TABLE usdc_claim_entitlements_v2;
DROP TABLE usdc_claim_distributions_v2;

CREATE INDEX idx_usdc_claim_entitlements_wallet
  ON usdc_claim_entitlements(winner_address, status, round_id);
CREATE INDEX idx_usdc_claim_distributions_status
  ON usdc_claim_distributions(status, staged_at);

CREATE TRIGGER usdc_claim_distributions_immutable_terms
BEFORE UPDATE OF source_revision, prize_draw_algorithm_version,
  randomness_account, randomness_value,
  randomness_commit_transaction_signature,
  randomness_reveal_transaction_signature, network, provider, program_id,
  mint_address, mint_symbol, mint_decimals, authority_address, seed_address,
  distribution_address, distribution_vault_address, merkle_root,
  gross_prize_amount_atomic, claim_fee_amount_atomic,
  net_distribution_amount_atomic, claim_fee_bps, clawback_unix_timestamp,
  create_transaction_signature, manifest_checksum
ON usdc_claim_distributions
BEGIN
  SELECT RAISE(ABORT, 'USDC claim distribution terms are immutable');
END;

CREATE TRIGGER usdc_claim_distributions_no_delete
BEFORE DELETE ON usdc_claim_distributions
BEGIN
  SELECT RAISE(ABORT, 'USDC claim distributions cannot be deleted');
END;

CREATE TRIGGER usdc_claim_entitlements_immutable_terms
BEFORE UPDATE OF entitlement_id, round_id, winner_address, winner_rank,
  gross_amount_atomic, claim_fee_amount_atomic, net_amount_atomic,
  leaf_hash, proof_json
ON usdc_claim_entitlements
BEGIN
  SELECT RAISE(ABORT, 'USDC claim entitlement terms are immutable');
END;

CREATE TRIGGER usdc_claim_entitlements_no_delete
BEFORE DELETE ON usdc_claim_entitlements
BEGIN
  SELECT RAISE(ABORT, 'USDC claim entitlements cannot be deleted');
END;
