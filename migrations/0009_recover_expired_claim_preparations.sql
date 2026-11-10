PRAGMA defer_foreign_keys = TRUE;

-- Preserve every signed preparation attempt for audit while permitting a new
-- attempt only after the previous blockhash expired and no distribution was
-- created on-chain. The Worker performs those two checks before transitioning
-- PREPARED -> EXPIRED.
DROP TRIGGER IF EXISTS usdc_claim_preparations_immutable_terms;
DROP TRIGGER IF EXISTS usdc_claim_preparations_no_delete;
DROP INDEX IF EXISTS idx_usdc_claim_preparations_status;

ALTER TABLE usdc_claim_preparations
  RENAME TO usdc_claim_preparations_single_attempt;

CREATE TABLE usdc_claim_preparations (
  preparation_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREPARED', 'STAGED', 'EXPIRED')),
  manifest_draft_json TEXT NOT NULL,
  unsigned_transaction TEXT NOT NULL,
  blockhash TEXT NOT NULL,
  last_valid_block_height TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  staged_at TEXT,
  expired_at TEXT,
  expiration_reason TEXT,
  CHECK (
    (status = 'EXPIRED' AND expired_at IS NOT NULL AND expiration_reason IS NOT NULL)
    OR (status != 'EXPIRED' AND expired_at IS NULL AND expiration_reason IS NULL)
  )
);

INSERT INTO usdc_claim_preparations (
  preparation_id, round_id, status, manifest_draft_json,
  unsigned_transaction, blockhash, last_valid_block_height,
  prepared_at, prepared_by, request_id, staged_at,
  expired_at, expiration_reason
)
SELECT
  preparation_id, round_id, status, manifest_draft_json,
  unsigned_transaction, blockhash, last_valid_block_height,
  prepared_at, prepared_by, request_id, staged_at,
  NULL, NULL
FROM usdc_claim_preparations_single_attempt;

DROP TABLE usdc_claim_preparations_single_attempt;

CREATE UNIQUE INDEX idx_usdc_claim_preparations_active_round
  ON usdc_claim_preparations(round_id)
  WHERE status IN ('PREPARED', 'STAGED');

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

CREATE TRIGGER usdc_claim_preparations_status_transition
BEFORE UPDATE OF status ON usdc_claim_preparations
WHEN NOT (
  OLD.status = 'PREPARED'
  AND NEW.status IN ('STAGED', 'EXPIRED')
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid USDC claim preparation status transition');
END;

CREATE TRIGGER usdc_claim_preparations_expiration_immutable
BEFORE UPDATE OF expired_at, expiration_reason ON usdc_claim_preparations
WHEN NOT (
  OLD.status = 'PREPARED'
  AND NEW.status = 'EXPIRED'
  AND OLD.expired_at IS NULL
  AND OLD.expiration_reason IS NULL
  AND NEW.expired_at IS NOT NULL
  AND NEW.expiration_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'USDC claim preparation expiration is immutable');
END;

CREATE TRIGGER usdc_claim_preparations_no_delete
BEFORE DELETE ON usdc_claim_preparations
BEGIN
  SELECT RAISE(ABORT, 'USDC claim preparations cannot be deleted');
END;
