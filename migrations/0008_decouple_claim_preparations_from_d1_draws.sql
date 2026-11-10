PRAGMA defer_foreign_keys = TRUE;

-- Prize Draw rounds are authoritative in PrizePoolCoordinator Durable Object
-- storage, not in D1. Keeping a D1 foreign key here rejects every valid round
-- because the legacy D1 rounds/prize_draws tables are intentionally empty.
DROP TRIGGER IF EXISTS usdc_claim_preparations_immutable_terms;
DROP TRIGGER IF EXISTS usdc_claim_preparations_no_delete;
DROP INDEX IF EXISTS idx_usdc_claim_preparations_status;

ALTER TABLE usdc_claim_preparations
  RENAME TO usdc_claim_preparations_with_d1_draw_fk;

CREATE TABLE usdc_claim_preparations (
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
  staged_at TEXT
);

INSERT INTO usdc_claim_preparations (
  round_id, preparation_id, status, manifest_draft_json,
  unsigned_transaction, blockhash, last_valid_block_height,
  prepared_at, prepared_by, request_id, staged_at
)
SELECT
  round_id, preparation_id, status, manifest_draft_json,
  unsigned_transaction, blockhash, last_valid_block_height,
  prepared_at, prepared_by, request_id, staged_at
FROM usdc_claim_preparations_with_d1_draw_fk;

DROP TABLE usdc_claim_preparations_with_d1_draw_fk;

CREATE INDEX idx_usdc_claim_preparations_status
  ON usdc_claim_preparations(status, prepared_at);

CREATE TRIGGER usdc_claim_preparations_immutable_terms
BEFORE UPDATE OF preparation_id, round_id, manifest_draft_json,
  unsigned_transaction, blockhash, last_valid_block_height,
  prepared_at, prepared_by, request_id
ON usdc_claim_preparations
BEGIN
  SELECT RAISE(ABORT, 'USDC claim preparation terms are immutable');
END;

CREATE TRIGGER usdc_claim_preparations_no_delete
BEFORE DELETE ON usdc_claim_preparations
BEGIN
  SELECT RAISE(ABORT, 'USDC claim preparations cannot be deleted');
END;
