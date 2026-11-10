import { DAILY_SEED_CENTS } from "../../../shared/prize-seed-contracts";

/** Display only: an unfunded pledge must never enter accounting or claims. */
export function prizePromotion(recordedMicroUsd: string, seededCents = "0") {
  const dailyBase = BigInt(DAILY_SEED_CENTS) * 10_000n;
  const seeded = BigInt(seededCents) * 10_000n;
  const pledge = seeded >= dailyBase ? 0n : dailyBase - seeded;
  return {
    totalMicroUsd: (BigInt(recordedMicroUsd) + pledge).toString(),
    unfundedPledgeMicroUsd: pledge.toString(),
  };
}
