-- Keep pre-launch execution evidence for audit, but prevent old unsigned RWA
-- permits from being reused after the public launch cutover.
UPDATE rwa_swap_orders
SET status = 'EXPIRED', updated_at = '2026-09-06T14:10:16.000Z'
WHERE status IN ('QUOTED', 'SUBMITTED');

INSERT OR IGNORE INTO audit_logs (
  audit_log_id, request_id, round_id, chain_id, wallet_address,
  action, entity_type, entity_id, actor_type, details_json, created_at
) VALUES (
  'public-launch-cutover-v1',
  'public-launch-cutover-v1',
  NULL,
  'solana-mainnet',
  NULL,
  'PUBLIC_LAUNCH_CUTOVER',
  'ACCOUNTING_EPOCH',
  'public-launch-v1',
  'SYSTEM',
  '{"previousEpoch":"prelaunch","preservedOnchainEvidence":true,"clearedPublicHistory":true}',
  '2026-09-06T14:10:16.000Z'
);
