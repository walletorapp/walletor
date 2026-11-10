import { z } from "zod";

const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/);

type SwapRiskConfigKey =
  "WALLET_SWAP_LIMIT_ENABLED" | "WALLET_SWAP_ROLLING_LIMIT_USD";

type SwapRiskConfigEnvironment = Partial<Record<SwapRiskConfigKey, string>>;

export interface SwapRiskConfig {
  enabled: boolean;
  rollingLimitMicroUsd: bigint;
  rollingWindowHours: 24;
}

function decimalToMicroUsd(name: string, raw: string): bigint {
  const parsed = decimalString.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${name} must be a nonnegative decimal string.`);
  }
  const [whole = "0", fraction = ""] = parsed.data.split(".");
  if (fraction.length > 6) {
    throw new Error(`${name} cannot have more than six decimal places.`);
  }
  return BigInt(`${whole}${fraction.padEnd(6, "0")}`);
}

export function readSwapRiskConfig(
  env: SwapRiskConfigEnvironment,
): SwapRiskConfig {
  const rollingLimitMicroUsd = decimalToMicroUsd(
    "WALLET_SWAP_ROLLING_LIMIT_USD",
    env.WALLET_SWAP_ROLLING_LIMIT_USD ?? "5000.00",
  );
  if (rollingLimitMicroUsd <= 0n) {
    throw new Error("WALLET_SWAP_ROLLING_LIMIT_USD must be greater than zero.");
  }
  if (rollingLimitMicroUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("WALLET_SWAP_ROLLING_LIMIT_USD is too large.");
  }
  return {
    enabled: env.WALLET_SWAP_LIMIT_ENABLED === "true",
    rollingLimitMicroUsd,
    rollingWindowHours: 24,
  };
}
