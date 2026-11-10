PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS token_search_index (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  source TEXT NOT NULL CHECK (source IN ('pumpfun', 'jupiter', 'helius')),
  token_program TEXT,
  creation_signature TEXT,
  created_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_token_search_source_created
ON token_search_index(source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_search_retention
ON token_search_index(is_verified, created_at, last_used_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_token_search_creation_signature
ON token_search_index(creation_signature)
WHERE creation_signature IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS token_search_fts USING fts5(
  mint,
  symbol,
  name,
  content='token_search_index',
  content_rowid='row_id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS token_search_fts_insert
AFTER INSERT ON token_search_index
BEGIN
  INSERT INTO token_search_fts(rowid, mint, symbol, name)
  VALUES (new.row_id, new.mint, new.symbol, new.name);
END;

CREATE TRIGGER IF NOT EXISTS token_search_fts_delete
AFTER DELETE ON token_search_index
BEGIN
  INSERT INTO token_search_fts(token_search_fts, rowid, mint, symbol, name)
  VALUES ('delete', old.row_id, old.mint, old.symbol, old.name);
END;

CREATE TRIGGER IF NOT EXISTS token_search_fts_update
AFTER UPDATE OF mint, symbol, name ON token_search_index
BEGIN
  INSERT INTO token_search_fts(token_search_fts, rowid, mint, symbol, name)
  VALUES ('delete', old.row_id, old.mint, old.symbol, old.name);
  INSERT INTO token_search_fts(rowid, mint, symbol, name)
  VALUES (new.row_id, new.mint, new.symbol, new.name);
END;
