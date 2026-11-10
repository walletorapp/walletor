import { WinnerSchema } from "../../shared/leaderboard-contracts";

// Only activated, funded distributions belong in the public winners history.
// Apply the same launch boundary as the claim endpoint; never expose staged draws.
export const PUBLIC_WINNERS_SQL = `WITH winners AS (
  SELECT e.entitlement_id AS id, e.round_id AS roundId,
    e.winner_address AS walletAddress, e.winner_rank AS rank,
    e.net_amount_atomic AS netAmountAtomic,
    d.gross_prize_amount_atomic AS poolAmountAtomic,
    e.status, d.activated_at AS date,
    d.clawback_unix_timestamp AS deadlineUnix,
    e.claim_transaction_signature AS claimSignature,
    d.create_transaction_signature AS fundingSignature,
    d.randomness_commit_transaction_signature AS requestSignature,
    d.randomness_reveal_transaction_signature AS revealSignature,
    d.randomness_account AS randomnessAccount,
    CASE WHEN d.magicblock_evidence_json IS NOT NULL THEN 'MagicBlock' ELSE 'Switchboard' END AS randomnessProvider,
    d.merkle_root AS merkleRoot, d.status AS distributionStatus
  FROM usdc_claim_entitlements e
  JOIN usdc_claim_distributions d ON d.round_id = e.round_id
  WHERE d.status IN ('ACTIVE', 'CLOSED') AND d.activated_at IS NOT NULL
    AND (? IS NULL OR d.staged_at >= ?)
)`;

export function publicWinner(row: Record<string, unknown>, now: Date) {
  const deadlineUnix = String(row.deadlineUnix);
  if (!/^\d{1,12}$/.test(deadlineUnix))
    throw new Error("Invalid claim deadline");
  const deadline = new Date(Number(deadlineUnix) * 1000).toISOString();
  return WinnerSchema.parse({
    ...row,
    deadline,
    status:
      row.status === "CLAIMED"
        ? "CLAIMED"
        : row.status === "EXPIRED" ||
            Date.parse(deadline) <= now.getTime() ||
            row.distributionStatus === "CLOSED"
          ? "EXPIRED"
          : row.status === "CLAIMABLE"
            ? "CLAIMABLE"
            : "PENDING",
  });
}
