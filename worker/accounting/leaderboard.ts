// Rank before filtering so wallet searches preserve the wallet's actual position.
// Values stay in SQLite integers and are returned as decimal strings.
export const RANKINGS_SQL = `WITH points AS (
  SELECT wallet_address, lifetime_points AS points FROM wlt_balances WHERE ? = 'all'
  UNION ALL
  SELECT wallet_address, SUM(delta) AS points FROM wlt_ledger
    WHERE ? = 'round' AND round_id = ? GROUP BY wallet_address
), swaps AS (
  SELECT wallet_address, SUM(eligible_swap_count) AS eligible_swaps
  FROM participants WHERE ? = 'all' OR round_id = ? GROUP BY wallet_address
), ranked AS (
  SELECT RANK() OVER (ORDER BY p.points DESC) AS rank,
    p.wallet_address AS walletAddress, CAST(p.points AS TEXT) AS points,
    COALESCE(s.eligible_swaps, 0) AS eligibleSwaps
  FROM points p LEFT JOIN swaps s ON s.wallet_address = p.wallet_address
  WHERE p.points > 0
)`;
