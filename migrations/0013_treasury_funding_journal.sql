-- Signed payloads are private financial records, never public API responses.
CREATE TABLE treasury_round_lock (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  round_id TEXT NOT NULL UNIQUE
);
CREATE TABLE automatic_claim_transaction_attempts (
  signature TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  signed_transaction TEXT NOT NULL,
  last_valid_block_height TEXT NOT NULL,
  resolved_status TEXT NOT NULL CHECK (resolved_status = 'EXPIRED'),
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER automatic_claim_attempt_no_update BEFORE UPDATE ON automatic_claim_transaction_attempts
BEGIN SELECT RAISE(ABORT, 'transaction history is immutable'); END;
CREATE TRIGGER automatic_claim_attempt_no_delete BEFORE DELETE ON automatic_claim_transaction_attempts
BEGIN SELECT RAISE(ABORT, 'transaction history is immutable'); END;
CREATE TABLE treasury_operations (
  operation_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('COLLECT', 'CONVERT', 'UNWRAP')),
  mint TEXT NOT NULL,
  input_amount_atomic TEXT NOT NULL CHECK (input_amount_atomic <> '' AND input_amount_atomic NOT GLOB '*[^0-9]*'),
  minimum_output_atomic TEXT NOT NULL CHECK (minimum_output_atomic <> '' AND minimum_output_atomic NOT GLOB '*[^0-9]*'),
  status TEXT NOT NULL CHECK (status IN ('SIGNED', 'FINALIZED', 'EXPIRED', 'FAILED')),
  signature TEXT NOT NULL UNIQUE,
  signed_transaction TEXT NOT NULL,
  last_valid_block_height TEXT NOT NULL,
  jupiter_request_id TEXT,
  jupiter_result_json TEXT,
  output_amount_atomic TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT
);
-- No concurrent spending from the automation wallet. An uncertain transaction
-- holds this lock until finalized or proven expired at a finalized block height.
CREATE UNIQUE INDEX treasury_single_inflight_operation
  ON treasury_operations ((1)) WHERE status = 'SIGNED';
CREATE UNIQUE INDEX treasury_successful_round_operation
  ON treasury_operations (round_id, kind, mint) WHERE status IN ('SIGNED', 'FINALIZED');
CREATE TRIGGER treasury_operation_identity_immutable
BEFORE UPDATE OF operation_id, round_id, kind, mint, input_amount_atomic,
  minimum_output_atomic, signature, signed_transaction, last_valid_block_height,
  jupiter_request_id, created_at ON treasury_operations
BEGIN SELECT RAISE(ABORT, 'treasury operation identity is immutable'); END;
CREATE TRIGGER treasury_finalized_operation_immutable
BEFORE UPDATE ON treasury_operations WHEN OLD.status <> 'SIGNED'
BEGIN SELECT RAISE(ABORT, 'resolved treasury operation is immutable'); END;
CREATE TRIGGER treasury_operation_no_delete BEFORE DELETE ON treasury_operations
BEGIN SELECT RAISE(ABORT, 'treasury operations are append-only'); END;

CREATE TABLE round_fee_sources (
  source_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  transaction_signature TEXT NOT NULL UNIQUE,
  mint TEXT NOT NULL,
  fee_amount_atomic TEXT NOT NULL CHECK (fee_amount_atomic <> '' AND fee_amount_atomic NOT GLOB '*[^0-9]*')
);
CREATE TRIGGER round_fee_sources_no_update BEFORE UPDATE ON round_fee_sources
BEGIN SELECT RAISE(ABORT, 'round fee sources are immutable'); END;
CREATE TRIGGER round_fee_sources_no_delete BEFORE DELETE ON round_fee_sources
BEGIN SELECT RAISE(ABORT, 'round fee sources are immutable'); END;

CREATE TABLE round_usdc_funding (
  round_id TEXT PRIMARY KEY,
  authority_address TEXT NOT NULL,
  amount_atomic TEXT NOT NULL CHECK (amount_atomic <> '' AND amount_atomic NOT GLOB '*[^0-9]*' AND amount_atomic <> '0'),
  evidence_json TEXT NOT NULL,
  reserved_at TEXT NOT NULL
);
CREATE TRIGGER round_usdc_funding_no_update BEFORE UPDATE ON round_usdc_funding
BEGIN SELECT RAISE(ABORT, 'confirmed round funding is immutable'); END;
CREATE TRIGGER round_usdc_funding_no_delete BEFORE DELETE ON round_usdc_funding
BEGIN SELECT RAISE(ABORT, 'confirmed round funding is immutable'); END;
