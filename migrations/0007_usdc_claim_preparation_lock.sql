PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usdc_claim_preparations (
  round_id TEXT PRIMARY KEY,
  preparation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PREPARED', 'STAGED')),
  manifest_draft_json TEXT NOT NULL,
  unsigned_transaction TEXT NOT NULL,
  blockhash TEXT NOT NULL,
  last_valid_block_height TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  staged_at TEXT,
  FOREIGN KEY (round_id) REFERENCES prize_draws(round_id)
);

CREATE INDEX IF NOT EXISTS idx_usdc_claim_preparations_status
  ON usdc_claim_preparations(status, prepared_at);

CREATE TRIGGER IF NOT EXISTS usdc_claim_preparations_immutable_terms
BEFORE UPDATE OF preparation_id, round_id, manifest_draft_json,
  unsigned_transaction, blockhash, last_valid_block_height,
  prepared_at, prepared_by, request_id
ON usdc_claim_preparations
BEGIN
  SELECT RAISE(ABORT, 'USDC claim preparation terms are immutable');
END;

CREATE TRIGGER IF NOT EXISTS usdc_claim_preparations_no_delete
BEFORE DELETE ON usdc_claim_preparations
BEGIN
  SELECT RAISE(ABORT, 'USDC claim preparations cannot be deleted');
END;
