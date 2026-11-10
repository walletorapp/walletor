/** Exact calculator shared by previews and the verified lifetime ledger.
 * Only the lifetime ledger records liabilities, within the existing reserve.
 * This module never executes payouts. */
export interface AffiliateCommissionPolicy {
  kolBps: number;
  /** Applied to KOL earnings, not to swap volume or the entire fee. */
  platformBpsOfKol: number;
}

export const PROPOSED_SEGMENTO_POLICY: Readonly<AffiliateCommissionPolicy> = {
  kolBps: 1000,
  platformBpsOfKol: 1000,
};

/** Split actual Walletor receipts per mint using atomic integers. */
export function splitAffiliateFee(
  walletorFeeAtomic: bigint,
  policy: Readonly<AffiliateCommissionPolicy>,
) {
  if (walletorFeeAtomic < 0n) throw new Error("Fee cannot be negative.");
  for (const bps of [policy.kolBps, policy.platformBpsOfKol]) {
    if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000)
      throw new Error(
        "Commission basis points must be integers from 0 to 10000.",
      );
  }
  // Validate the policy even for tiny fees that would otherwise round to zero.
  if (policy.kolBps * (10_000 + policy.platformBpsOfKol) > 100_000_000)
    throw new Error("Commissions cannot exceed Walletor's fee.");
  const kolAtomic = (walletorFeeAtomic * BigInt(policy.kolBps)) / 10_000n;
  const platformAtomic =
    (kolAtomic * BigInt(policy.platformBpsOfKol)) / 10_000n;
  return {
    kolAtomic,
    platformAtomic,
    poolAtomic: walletorFeeAtomic - kolAtomic - platformAtomic,
  };
}
