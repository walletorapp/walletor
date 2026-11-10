// Apply paid-round exclusions before the limit so historical distributions
// cannot hide an older unpaid liability. The ledger remains authoritative.
export const ADMIN_UNFUNDED_DRAWS_SQL = `
  SELECT d.*, r.total_pool_cents, r.start_time
  FROM prize_draws AS d
  INNER JOIN rounds AS r ON r.round_id = d.round_id
  WHERE r.end_time <= ? AND r.total_pool_cents > 0
    AND d.participant_count > 0
    AND d.round_id NOT IN (SELECT value FROM json_each(?))
  ORDER BY r.start_time ASC, d.round_id ASC
  LIMIT 100`;
