PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  wallet_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  chain_id TEXT NOT NULL,
  chain_family TEXT NOT NULL CHECK (chain_family IN ('SOLANA', 'EVM')),
  network_name TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  lifetime_total_swaps INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_total_swaps >= 0),
  lifetime_eligible_swaps INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_eligible_swaps >= 0),
  lifetime_verified_volume_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_verified_volume_cents >= 0),
  lifetime_rewards_allocated_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_rewards_allocated_cents >= 0),
  lifetime_rewards_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_rewards_paid_cents >= 0),
  lifetime_wlt_points INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_wlt_points >= 0),
  pending_wlt_points INTEGER NOT NULL DEFAULT 0 CHECK (pending_wlt_points >= 0),
  converted_wlt_points INTEGER NOT NULL DEFAULT 0 CHECK (converted_wlt_points >= 0),
  UNIQUE (chain_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS prize_pools (
  pool_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  chain_family TEXT NOT NULL CHECK (chain_family IN ('SOLANA', 'EVM')),
  network_name TEXT NOT NULL,
  accounting_asset TEXT NOT NULL DEFAULT 'USD_CENTS',
  current_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (current_balance_cents >= 0),
  total_organic_contributions_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_organic_contributions_cents >= 0),
  total_treasury_seed_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_treasury_seed_cents >= 0),
  total_collected_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_collected_cents >= 0),
  total_distributed_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_distributed_cents >= 0),
  total_platform_revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_platform_revenue_cents >= 0),
  active_round_id TEXT,
  distributions_paused INTEGER NOT NULL DEFAULT 0 CHECK (distributions_paused IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE (chain_id, network_name)
);

CREATE TABLE IF NOT EXISTS rounds (
  round_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES prize_pools(pool_id),
  chain_id TEXT NOT NULL,
  chain_family TEXT NOT NULL CHECK (chain_family IN ('SOLANA', 'EVM')),
  network_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'LOCKING', 'LOCKED', 'CALCULATING', 'ALLOCATED', 'PAYING', 'PARTIALLY_PAID', 'COMPLETED', 'FAILED')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  locked_at TEXT,
  completed_at TEXT,
  total_pool_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_pool_cents >= 0),
  total_eligible_swaps INTEGER NOT NULL DEFAULT 0 CHECK (total_eligible_swaps >= 0),
  total_actual_swaps INTEGER NOT NULL DEFAULT 0 CHECK (total_actual_swaps >= 0),
  total_eligible_volume_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_eligible_volume_cents >= 0),
  eligible_wallet_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_wallet_count >= 0),
  allocation_checksum TEXT,
  payout_transaction_references TEXT,
  remainder_cents INTEGER NOT NULL DEFAULT 0 CHECK (remainder_cents >= 0),
  failure_reason TEXT,
  closure_idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (pool_id, start_time),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS swaps (
  swap_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  round_id TEXT NOT NULL REFERENCES rounds(round_id),
  chain_id TEXT NOT NULL,
  chain_family TEXT NOT NULL CHECK (chain_family IN ('SOLANA', 'EVM')),
  network_name TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  treasury_address TEXT NOT NULL,
  input_asset_address TEXT NOT NULL,
  output_asset_address TEXT NOT NULL,
  input_amount_atomic TEXT NOT NULL CHECK (input_amount_atomic GLOB '[0-9]*'),
  output_amount_atomic TEXT NOT NULL CHECK (output_amount_atomic GLOB '[0-9]*'),
  verified_swap_value_cents INTEGER NOT NULL CHECK (verified_swap_value_cents >= 0),
  walletor_fee_asset_address TEXT NOT NULL,
  walletor_fee_amount_atomic TEXT NOT NULL CHECK (walletor_fee_amount_atomic GLOB '[0-9]*'),
  walletor_fee_cents INTEGER NOT NULL CHECK (walletor_fee_cents >= 0),
  routing_fee_amount_atomic TEXT,
  network_fee_amount_atomic TEXT,
  block_number_or_slot TEXT NOT NULL,
  block_time TEXT NOT NULL,
  confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('FINALIZED')),
  verification_version TEXT NOT NULL,
  actual_swap INTEGER NOT NULL DEFAULT 1 CHECK (actual_swap IN (0, 1)),
  reward_eligible INTEGER NOT NULL DEFAULT 0 CHECK (reward_eligible IN (0, 1)),
  eligibility_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (chain_id, transaction_hash)
);

CREATE TABLE IF NOT EXISTS fee_events (
  fee_event_id TEXT PRIMARY KEY,
  swap_id TEXT NOT NULL UNIQUE REFERENCES swaps(swap_id),
  chain_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('STANDARD_SWAP_FEE_COLLECTED', 'ADVANCED_TRADE_FEE_COLLECTED')),
  fee_asset_address TEXT NOT NULL,
  fee_amount_atomic TEXT NOT NULL CHECK (fee_amount_atomic GLOB '[0-9]*'),
  verified_fee_cents INTEGER NOT NULL CHECK (verified_fee_cents >= 0),
  prize_pool_contribution_cents INTEGER NOT NULL CHECK (prize_pool_contribution_cents >= 0),
  platform_revenue_cents INTEGER NOT NULL CHECK (platform_revenue_cents >= 0),
  treasury_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (chain_id, transaction_hash)
);

CREATE TABLE IF NOT EXISTS pool_ledger (
  ledger_entry_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES prize_pools(pool_id),
  round_id TEXT REFERENCES rounds(round_id),
  chain_id TEXT NOT NULL,
  transaction_hash TEXT,
  action TEXT NOT NULL CHECK (action IN ('SWAP_FEE_COLLECTED', 'ADVANCED_TRADE_FEE_COLLECTED', 'PRIZE_POOL_CREDIT', 'PLATFORM_REVENUE_CREDIT', 'TREASURY_SEED', 'ROUND_LOCKED', 'REWARD_ALLOCATED', 'PAYOUT_SENT', 'PAYOUT_FAILED', 'PAYOUT_RETRIED', 'ROUND_REMAINDER', 'ADMIN_ADJUSTMENT', 'REVERSAL')),
  amount_cents INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  reverses_ledger_entry_id TEXT REFERENCES pool_ledger(ledger_entry_id),
  reason TEXT NOT NULL,
  public_description TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (amount_cents != 0 OR action = 'ROUND_LOCKED')
);

CREATE TRIGGER IF NOT EXISTS pool_ledger_no_update
BEFORE UPDATE ON pool_ledger
BEGIN
  SELECT RAISE(ABORT, 'pool_ledger is append-only');
END;

CREATE TRIGGER IF NOT EXISTS pool_ledger_no_delete
BEFORE DELETE ON pool_ledger
BEGIN
  SELECT RAISE(ABORT, 'pool_ledger is append-only');
END;

CREATE TABLE IF NOT EXISTS round_participants (
  participant_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(round_id),
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  wallet_address TEXT NOT NULL,
  actual_swap_count INTEGER NOT NULL DEFAULT 0 CHECK (actual_swap_count >= 0),
  eligible_swap_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_swap_count >= 0),
  eligible_volume_cents INTEGER NOT NULL DEFAULT 0 CHECK (eligible_volume_cents >= 0),
  current_multiplier_bps INTEGER NOT NULL DEFAULT 10000 CHECK (current_multiplier_bps >= 10000),
  achieved_tier INTEGER NOT NULL DEFAULT 1 CHECK (achieved_tier IN (1, 3, 5, 10)),
  next_tier INTEGER CHECK (next_tier IN (3, 5, 10)),
  swaps_until_next_tier INTEGER NOT NULL DEFAULT 0 CHECK (swaps_until_next_tier >= 0),
  calculated_weight INTEGER NOT NULL DEFAULT 0 CHECK (calculated_weight >= 0),
  last_eligible_swap_at TEXT,
  flagged_for_review INTEGER NOT NULL DEFAULT 0 CHECK (flagged_for_review IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE (round_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS reward_allocations (
  allocation_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(round_id),
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  wallet_address TEXT NOT NULL,
  eligible_swap_count INTEGER NOT NULL CHECK (eligible_swap_count > 0),
  eligible_volume_cents INTEGER NOT NULL CHECK (eligible_volume_cents >= 0),
  multiplier_bps INTEGER NOT NULL CHECK (multiplier_bps >= 10000),
  calculated_weight INTEGER NOT NULL CHECK (calculated_weight > 0),
  share_numerator TEXT NOT NULL CHECK (share_numerator GLOB '[0-9]*'),
  share_denominator TEXT NOT NULL CHECK (share_denominator GLOB '[0-9]*'),
  reward_cents INTEGER NOT NULL CHECK (reward_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('ALLOCATED', 'PENDING_PAYOUT', 'CLAIM_UNAVAILABLE_BETA', 'PROCESSING', 'PAID', 'FAILED', 'MANUAL_REVIEW')),
  payout_tx_hash TEXT,
  claimed_at TEXT,
  failure_reason TEXT,
  allocation_idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (round_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS payout_jobs (
  payout_job_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL UNIQUE REFERENCES reward_allocations(allocation_id),
  chain_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_retry_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY_PENDING', 'COMPLETED', 'PERMANENTLY_FAILED', 'MANUAL_REVIEW')),
  final_tx_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL UNIQUE REFERENCES reward_allocations(allocation_id),
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  wallet_address TEXT NOT NULL,
  nonce_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'UNAVAILABLE_BETA')),
  payout_tx_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  nonce_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('SESSION', 'CLAIM', 'ADMIN')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  session_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS wlt_points_ledger (
  wlt_entry_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  round_id TEXT NOT NULL REFERENCES rounds(round_id),
  swap_id TEXT REFERENCES swaps(swap_id),
  wallet_address TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta != 0),
  reason TEXT NOT NULL,
  source_transaction TEXT,
  resulting_balance INTEGER NOT NULL CHECK (resulting_balance >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  reverses_wlt_entry_id TEXT REFERENCES wlt_points_ledger(wlt_entry_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS wlt_points_ledger_no_update
BEFORE UPDATE ON wlt_points_ledger
BEGIN
  SELECT RAISE(ABORT, 'wlt_points_ledger is append-only');
END;

CREATE TRIGGER IF NOT EXISTS wlt_points_ledger_no_delete
BEFORE DELETE ON wlt_points_ledger
BEGIN
  SELECT RAISE(ABORT, 'wlt_points_ledger is append-only');
END;

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  round_id TEXT,
  chain_id TEXT,
  wallet_address TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'WALLET', 'ADMIN', 'QUEUE', 'CRON')),
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TABLE IF NOT EXISTS reconciliation_alerts (
  alert_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES prize_pools(pool_id),
  round_id TEXT REFERENCES rounds(round_id),
  chain_id TEXT NOT NULL,
  expected_balance_cents INTEGER NOT NULL,
  actual_balance_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  threshold_cents INTEGER NOT NULL CHECK (threshold_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE')),
  distributions_paused INTEGER NOT NULL CHECK (distributions_paused IN (0, 1)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS flagged_wallets (
  flag_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id),
  round_id TEXT REFERENCES rounds(round_id),
  wallet_address TEXT NOT NULL,
  flag_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('DETERMINISTIC_RULE', 'WALLETOR_INTELLIGENCE', 'ADMIN')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CLEARED', 'CONFIRMED', 'APPEALED')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('INTEGER', 'DECIMAL_STRING', 'BOOLEAN', 'STRING', 'JSON')),
  public INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_swaps_round_wallet ON swaps(round_id, wallet_id);
CREATE INDEX IF NOT EXISTS idx_swaps_wallet_created ON swaps(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_events_round ON fee_events(swap_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pool_ledger_round ON pool_ledger(round_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rounds_pool_status ON rounds(pool_id, status, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_participants_round_weight ON round_participants(round_id, calculated_weight DESC);
CREATE INDEX IF NOT EXISTS idx_allocations_round_status ON reward_allocations(round_id, status);
CREATE INDEX IF NOT EXISTS idx_payout_jobs_retry ON payout_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_wlt_wallet_created ON wlt_points_ledger(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_round_created ON audit_logs(round_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON reconciliation_alerts(status, created_at DESC);
