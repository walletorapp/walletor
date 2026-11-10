DROP INDEX IF EXISTS idx_token_search_creation_signature;

CREATE INDEX IF NOT EXISTS idx_token_search_creation_signature
ON token_search_index(creation_signature)
WHERE creation_signature IS NOT NULL;
