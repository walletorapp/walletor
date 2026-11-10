// Presentation only: rates come from normalized Worker responses. This never
// calculates or credits token balances, fees, or rewards.
function formatScaledPercent(value: bigint, decimalPlaces: number): string {
  const scale = 10n ** BigInt(decimalPlaces);
  const fraction = (value % scale)
    .toString()
    .padStart(decimalPlaces, "0")
    .replace(/0+$/, "");
  return `${(value / scale).toString()}${fraction ? `.${fraction}` : ""}%`;
}

function validBps(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

export function formatBasisPoints(bps: number | null): string {
  return validBps(bps) ? formatScaledPercent(BigInt(bps), 2) : "Unavailable";
}

export function referralFeeBreakdown(
  referralBps: number | null,
  partnerShareBps: number | null,
): { referral: string; walletor: string; jupiter: string } | null {
  if (
    !validBps(referralBps) ||
    !validBps(partnerShareBps) ||
    partnerShareBps > 10_000
  ) {
    return null;
  }
  const rate = BigInt(referralBps);
  const walletorShare = BigInt(partnerShareBps);
  return {
    referral: formatBasisPoints(referralBps),
    walletor: formatScaledPercent(rate * walletorShare, 6),
    jupiter: formatScaledPercent(rate * (10_000n - walletorShare), 6),
  };
}
