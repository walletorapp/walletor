// Covers the base fee, a priority fee, and a possible output-token account
// when the user selects their full native SOL balance. Jupiter and the wallet
// remain authoritative for the exact cost of a particular transaction.
export const SOL_MAX_NETWORK_FEE_BUFFER_LAMPORTS = 3_000_000n;

export function fractionOfAvailableBalance(
  available: bigint,
  numerator: bigint,
  denominator: bigint,
  reserveForNativeSol: boolean,
): bigint {
  if (available < 0n || numerator < 0n || denominator <= 0n) {
    throw new RangeError("Balance fraction inputs must be non-negative.");
  }

  const selected = (available * numerator) / denominator;
  const selectedFullBalance = selected === available;
  if (!reserveForNativeSol || !selectedFullBalance) return selected;
  return selected > SOL_MAX_NETWORK_FEE_BUFFER_LAMPORTS
    ? selected - SOL_MAX_NETWORK_FEE_BUFFER_LAMPORTS
    : 0n;
}
