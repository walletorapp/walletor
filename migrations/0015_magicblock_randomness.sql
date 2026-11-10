-- Immutable round-to-request binding. No private keys or spend authorization.
CREATE TABLE magicblock_draw_requests (
  round_id TEXT PRIMARY KEY,
  authority_address TEXT NOT NULL,
  randomness_account TEXT NOT NULL UNIQUE,
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash) = 64),
  minimum_request_slot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TRIGGER magicblock_draw_requests_no_update BEFORE UPDATE ON magicblock_draw_requests
BEGIN SELECT RAISE(ABORT, 'Randomness bindings are immutable'); END;
CREATE TRIGGER magicblock_draw_requests_no_delete BEFORE DELETE ON magicblock_draw_requests
BEGIN SELECT RAISE(ABORT, 'Randomness bindings cannot be deleted'); END;
ALTER TABLE usdc_claim_distributions ADD COLUMN magicblock_evidence_json TEXT;
