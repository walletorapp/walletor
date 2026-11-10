PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS discovered_tokens (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  logo_url TEXT,
  metadata_uri TEXT,
  creator_address TEXT,
  token_program TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('pumpfun', 'jupiter')),
  creation_signature TEXT,
  created_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  jupiter_indexed INTEGER NOT NULL DEFAULT 0 CHECK (jupiter_indexed IN (0, 1)),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  organic_score REAL,
  organic_score_label TEXT CHECK (organic_score_label IN ('high', 'medium', 'low')),
  price_usd REAL,
  market_cap_usd REAL,
  liquidity_usd REAL,
  holders INTEGER CHECK (holders IS NULL OR holders >= 0),
  mint_authority_disabled INTEGER CHECK (mint_authority_disabled IN (0, 1)),
  freeze_authority_disabled INTEGER CHECK (freeze_authority_disabled IN (0, 1)),
  top_holders_percent REAL
);

CREATE INDEX IF NOT EXISTS idx_discovered_tokens_created_at
ON discovered_tokens(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_tokens_source_created_at
ON discovered_tokens(source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_tokens_symbol
ON discovered_tokens(symbol COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_discovered_tokens_creation_signature
ON discovered_tokens(creation_signature);

CREATE VIRTUAL TABLE IF NOT EXISTS discovered_tokens_fts USING fts5(
  mint,
  symbol,
  name,
  content='discovered_tokens',
  content_rowid='row_id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS discovered_tokens_fts_insert
AFTER INSERT ON discovered_tokens
BEGIN
  INSERT INTO discovered_tokens_fts(rowid, mint, symbol, name)
  VALUES (new.row_id, new.mint, new.symbol, new.name);
END;

CREATE TRIGGER IF NOT EXISTS discovered_tokens_fts_delete
AFTER DELETE ON discovered_tokens
BEGIN
  INSERT INTO discovered_tokens_fts(discovered_tokens_fts, rowid, mint, symbol, name)
  VALUES ('delete', old.row_id, old.mint, old.symbol, old.name);
END;

CREATE TRIGGER IF NOT EXISTS discovered_tokens_fts_update
AFTER UPDATE OF mint, symbol, name ON discovered_tokens
BEGIN
  INSERT INTO discovered_tokens_fts(discovered_tokens_fts, rowid, mint, symbol, name)
  VALUES ('delete', old.row_id, old.mint, old.symbol, old.name);
  INSERT INTO discovered_tokens_fts(rowid, mint, symbol, name)
  VALUES (new.row_id, new.mint, new.symbol, new.name);
END;
