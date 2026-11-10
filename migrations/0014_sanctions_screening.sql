CREATE TABLE IF NOT EXISTS compliance_sources (
  source_id TEXT PRIMARY KEY CHECK (source_id = 'ofac-sdn-sol'),
  fetched_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
);

CREATE TABLE IF NOT EXISTS compliance_source_versions (
  source_hash TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
);
CREATE TRIGGER IF NOT EXISTS compliance_source_versions_no_update BEFORE UPDATE ON compliance_source_versions
BEGIN SELECT RAISE(ABORT, 'Source evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS compliance_source_versions_no_delete BEFORE DELETE ON compliance_source_versions
BEGIN SELECT RAISE(ABORT, 'Source evidence requires an approved retention migration'); END;

CREATE TABLE IF NOT EXISTS compliance_events (
  event_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  action TEXT NOT NULL,
  reference TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('NO_DIRECT_MATCH', 'RESTRICTED', 'UNAVAILABLE')),
  policy_version TEXT NOT NULL,
  source_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compliance_events_time ON compliance_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_events_wallet ON compliance_events(wallet_address, created_at DESC);
CREATE TRIGGER IF NOT EXISTS compliance_events_no_update BEFORE UPDATE ON compliance_events
BEGIN SELECT RAISE(ABORT, 'Compliance evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS compliance_events_no_delete BEFORE DELETE ON compliance_events
BEGIN SELECT RAISE(ABORT, 'Compliance evidence requires an approved retention migration'); END;
