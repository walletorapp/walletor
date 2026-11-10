PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS referral_fee_mints (
  mint TEXT PRIMARY KEY,
  referral_account TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'INITIALIZING', 'READY', 'FAILED', 'DISABLED')
  ),
  observed_input_mint TEXT NOT NULL,
  observed_output_mint TEXT NOT NULL,
  configured_fee_bps INTEGER NOT NULL CHECK (
    configured_fee_bps BETWEEN 50 AND 255
  ),
  observed_platform_fee_bps INTEGER,
  referral_token_account TEXT,
  initialization_signature TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  initialization_started_at TEXT,
  ready_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_referral_fee_mints_status_seen
ON referral_fee_mints(status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_fee_mints_updated_at
ON referral_fee_mints(updated_at DESC);
