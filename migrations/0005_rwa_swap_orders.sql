CREATE TABLE IF NOT EXISTS rwa_swap_orders (
  request_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  router TEXT,
  quote_id TEXT,
  maker TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('QUOTED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED')
  ),
  expires_at TEXT NOT NULL,
  transaction_signature TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rwa_swap_orders_wallet_created
  ON rwa_swap_orders(wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rwa_swap_orders_status_expiry
  ON rwa_swap_orders(status, expires_at);
