import { z } from "zod";

const integerString = z.string().regex(/^\d+$/);
const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/);

type AccountingConfigKey =
  | "ACCOUNTING_ENABLED"
  | "PAYOUTS_ENABLED"
  | "PRIZE_POOL_WINNER_COUNT"
  | "PRIZE_POOL_CLAIM_FEE_BPS"
  | "STANDARD_SWAP_FEE_USD"
  | "ADVANCED_TRADE_FEE_USD"
  | "PRIZE_POOL_PERCENTAGE"
  | "PLATFORM_REVENUE_PERCENTAGE"
  | "ROUND_DURATION_HOURS"
  | "MINIMUM_REWARD_ELIGIBLE_SWAP_USD"
  | "NEW_WALLET_REVIEW_DAYS"
  | "WLT_BASE_POINTS_PER_ELIGIBLE_SWAP"
  | "RECONCILIATION_PAUSE_THRESHOLD_USD"
  | "WALLETOR_TREASURY_ADDRESS"
  | "WALLETOR_FEE_ASSET_MINT"
  | "WALLETOR_STANDARD_SWAP_FEE_ATOMIC";

type AccountingConfigEnvironment = Partial<Record<AccountingConfigKey, string>>;

export interface AccountingConfig {
  enabled: boolean;
  payoutsEnabled: boolean;
  prizePoolWinnerCount: number;
  prizePoolClaimFeeBps: number;
  standardSwapFeeCents: bigint;
  advancedTradeFeeCents: bigint;
  prizePoolPercentageBps: bigint;
  platformRevenuePercentageBps: bigint;
  roundDurationHours: number;
  minimumRewardEligibleSwapCents: bigint;
  newWalletReviewDays: number;
  wltBasePointsPerEligibleSwap: bigint;
  reconciliationPauseThresholdCents: bigint;
  treasuryAddress: string | null;
  feeAssetMint: string | null;
  standardSwapFeeAtomic: bigint | null;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: string,
): bigint {
  const parsed = integerString.safeParse(value ?? fallback);
  if (!parsed.success) throw new Error(`${name} must be an unsigned integer.`);
  return BigInt(parsed.data);
}

function parseSafeInteger(
  name: string,
  value: string | undefined,
  fallback: string,
): number {
  const parsed = parseInteger(name, value, fallback);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} exceeds the safe configuration range.`);
  }
  return Number(parsed);
}

function decimalToScaledInteger(
  name: string,
  value: string | undefined,
  fallback: string,
  scale: number,
): bigint {
  const parsed = decimalString.safeParse(value ?? fallback);
  if (!parsed.success) throw new Error(`${name} must be a positive decimal.`);
  const [whole, fraction = ""] = parsed.data.split(".");
  if (fraction.length > scale) {
    throw new Error(`${name} has too many decimal places.`);
  }
  return BigInt(`${whole ?? "0"}${fraction.padEnd(scale, "0")}`);
}

function optionalNonempty(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized;
}

export function readAccountingConfig(
  env: AccountingConfigEnvironment,
): AccountingConfig {
  const config: AccountingConfig = {
    enabled: parseBoolean(env.ACCOUNTING_ENABLED),
    payoutsEnabled: parseBoolean(env.PAYOUTS_ENABLED),
    prizePoolWinnerCount: parseSafeInteger(
      "PRIZE_POOL_WINNER_COUNT",
      env.PRIZE_POOL_WINNER_COUNT,
      "22",
    ),
    prizePoolClaimFeeBps: parseSafeInteger(
      "PRIZE_POOL_CLAIM_FEE_BPS",
      env.PRIZE_POOL_CLAIM_FEE_BPS,
      "250",
    ),
    standardSwapFeeCents: decimalToScaledInteger(
      "STANDARD_SWAP_FEE_USD",
      env.STANDARD_SWAP_FEE_USD,
      "1.00",
      2,
    ),
    advancedTradeFeeCents: decimalToScaledInteger(
      "ADVANCED_TRADE_FEE_USD",
      env.ADVANCED_TRADE_FEE_USD,
      "0.10",
      2,
    ),
    prizePoolPercentageBps: decimalToScaledInteger(
      "PRIZE_POOL_PERCENTAGE",
      env.PRIZE_POOL_PERCENTAGE,
      "100",
      2,
    ),
    platformRevenuePercentageBps: decimalToScaledInteger(
      "PLATFORM_REVENUE_PERCENTAGE",
      env.PLATFORM_REVENUE_PERCENTAGE,
      "0",
      2,
    ),
    roundDurationHours: parseSafeInteger(
      "ROUND_DURATION_HOURS",
      env.ROUND_DURATION_HOURS,
      "24",
    ),
    minimumRewardEligibleSwapCents: decimalToScaledInteger(
      "MINIMUM_REWARD_ELIGIBLE_SWAP_USD",
      env.MINIMUM_REWARD_ELIGIBLE_SWAP_USD,
      "5.00",
      2,
    ),
    newWalletReviewDays: parseSafeInteger(
      "NEW_WALLET_REVIEW_DAYS",
      env.NEW_WALLET_REVIEW_DAYS,
      "7",
    ),
    wltBasePointsPerEligibleSwap: parseInteger(
      "WLT_BASE_POINTS_PER_ELIGIBLE_SWAP",
      env.WLT_BASE_POINTS_PER_ELIGIBLE_SWAP,
      "0",
    ),
    reconciliationPauseThresholdCents: decimalToScaledInteger(
      "RECONCILIATION_PAUSE_THRESHOLD_USD",
      env.RECONCILIATION_PAUSE_THRESHOLD_USD,
      "0.00",
      2,
    ),
    treasuryAddress: optionalNonempty(env.WALLETOR_TREASURY_ADDRESS),
    feeAssetMint: optionalNonempty(env.WALLETOR_FEE_ASSET_MINT),
    standardSwapFeeAtomic: optionalNonempty(
      env.WALLETOR_STANDARD_SWAP_FEE_ATOMIC,
    )
      ? parseInteger(
          "WALLETOR_STANDARD_SWAP_FEE_ATOMIC",
          env.WALLETOR_STANDARD_SWAP_FEE_ATOMIC,
          "0",
        )
      : null,
  };

  if (
    config.prizePoolPercentageBps + config.platformRevenuePercentageBps !==
    10_000n
  ) {
    throw new Error(
      "PRIZE_POOL_PERCENTAGE and PLATFORM_REVENUE_PERCENTAGE must total 100%.",
    );
  }
  if (![1, 4, 24].includes(config.roundDurationHours)) {
    throw new Error("ROUND_DURATION_HOURS must be 1, 4, or 24.");
  }
  if (config.prizePoolWinnerCount < 1 || config.prizePoolWinnerCount > 100) {
    throw new Error("PRIZE_POOL_WINNER_COUNT must be between 1 and 100.");
  }
  if (config.prizePoolClaimFeeBps !== 250) {
    throw new Error("PRIZE_POOL_CLAIM_FEE_BPS must be 250 for launch.");
  }
  if (config.minimumRewardEligibleSwapCents <= 0n) {
    throw new Error(
      "MINIMUM_REWARD_ELIGIBLE_SWAP_USD must be greater than zero.",
    );
  }
  if (
    config.enabled &&
    (!config.treasuryAddress || config.wltBasePointsPerEligibleSwap <= 0n)
  ) {
    throw new Error(
      "Accounting cannot be enabled until treasury and a positive WLT rate are configured.",
    );
  }
  if (config.payoutsEnabled && !config.enabled) {
    throw new Error("Payouts cannot be enabled while accounting is disabled.");
  }
  return config;
}
