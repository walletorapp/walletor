PRAGMA foreign_keys = ON;

-- Durable, retry-safe evidence for the server-signed mainnet settlement path.
-- Signed transactions are public network payloads; the automation private key
-- remains exclusively in the Worker secret binding.
CREATE TABLE IF NOT EXISTS automatic_claim_settlements (
  round_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN (
    'INITIALIZED',
    'COMMITTING',
    'COMMITTED',
    'REVEALING',
    'REVEALED',
    'FUNDING',
    'STAGED',
    'ACTIVE'
  )),
  authority_address TEXT NOT NULL,
  randomness_account TEXT NOT NULL UNIQUE,
  distribution_seed_address TEXT NOT NULL UNIQUE,
  commit_transaction_signature TEXT UNIQUE,
  commit_signed_transaction TEXT,
  commit_last_valid_block_height TEXT,
  reveal_transaction_signature TEXT UNIQUE,
  reveal_signed_transaction TEXT,
  reveal_last_valid_block_height TEXT,
  preparation_id TEXT UNIQUE,
  funding_transaction_signature TEXT UNIQUE,
  funding_signed_transaction TEXT,
  funding_last_valid_block_height TEXT,
  manifest_checksum TEXT,
  distribution_address TEXT UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (status = 'ACTIVE' AND completed_at IS NOT NULL)
    OR (status != 'ACTIVE' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_automatic_claim_settlements_status
  ON automatic_claim_settlements(status, updated_at);

CREATE TRIGGER IF NOT EXISTS automatic_claim_settlements_identity_immutable
BEFORE UPDATE OF round_id, authority_address, randomness_account,
  distribution_seed_address
ON automatic_claim_settlements
BEGIN
  SELECT RAISE(ABORT, 'Automatic claim settlement identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS automatic_claim_settlements_no_delete
BEFORE DELETE ON automatic_claim_settlements
BEGIN
  SELECT RAISE(ABORT, 'Automatic claim settlement evidence cannot be deleted');
END;
