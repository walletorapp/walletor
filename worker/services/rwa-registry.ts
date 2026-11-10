import type { RwaAsset } from "../../shared/rwa-contracts";
import { RwaAssetSchema } from "../../shared/rwa-contracts";
import { ApiFailure } from "../lib/http";
import { getTokenPrices } from "./jupiter";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const RWA_PAYMENT_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

type RegistryAsset = Omit<
  RwaAsset,
  "priceUsd" | "priceChange24hPercent" | "tradingAvailability"
>;

const ONDO_RESTRICTIONS =
  "Tokenized economic exposure, not direct ownership of the underlying share. Eligibility and jurisdiction restrictions apply.";

const RWA_REGISTRY: readonly RegistryAsset[] = [
  {
    mint: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo",
    ticker: "AAPL",
    tokenSymbol: "AAPLon",
    companyName: "Apple",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/aaplon_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
  {
    mint: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo",
    ticker: "TSLA",
    tokenSymbol: "TSLAon",
    companyName: "Tesla",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/tslaon_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
  {
    mint: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo",
    ticker: "NVDA",
    tokenSymbol: "NVDAon",
    companyName: "NVIDIA",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/nvdaon_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
  {
    mint: "14Tqdo8V1FhzKsE3W2pFsZCzYPQxxupXRcqw9jv6ondo",
    ticker: "AMZN",
    tokenSymbol: "AMZNon",
    companyName: "Amazon",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/amznon_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
  {
    mint: "FRmH6iRkMr33DLG6zVLR7EM4LojBFAuq6NtFzG6ondo",
    ticker: "MSFT",
    tokenSymbol: "MSFTon",
    companyName: "Microsoft",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/msfton_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
  {
    mint: "bbahNA5vT9WJeYft8tALrH1LXWffjwqVoUbqYa1ondo",
    ticker: "GOOGL",
    tokenSymbol: "GOOGLon",
    companyName: "Alphabet Class A",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/googlon_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
  {
    mint: "fDxs5y12E7x7jBwCKBXGqt71uJmCWsAQ3Srkte6ondo",
    ticker: "META",
    tokenSymbol: "METAon",
    companyName: "Meta Platforms",
    issuer: "Ondo Finance",
    assetType: "tokenized_stock",
    productLabel: "Tokenized Stock",
    decimals: 9,
    logoUrl: "https://cdn.ondo.finance/tokens/logos/metaon_160x160.png",
    verified: true,
    verificationStatus: "walletor_verified_mint",
    requiresEligibilityCheck: true,
    issuerUrl: "https://ondo.finance/ondo-stocks",
    restrictionsSummary: ONDO_RESTRICTIONS,
  },
];

const RWA_BY_MINT = new Map(RWA_REGISTRY.map((asset) => [asset.mint, asset]));

export interface RwaFeatureConfig {
  stocksEnabled: boolean;
  tradingEnabled: boolean;
  rewardsEnabled: boolean;
  jupiterzRouteBadgeEnabled: boolean;
}

type RwaFeatureKey =
  | "ENABLE_STOCKS"
  | "ENABLE_RWA_TRADING"
  | "ENABLE_RWA_REWARDS"
  | "ENABLE_JUPITERZ_ROUTE_BADGE";

type RwaFeatureEnvironment = Partial<Record<RwaFeatureKey, string>> & {
  JUPITER_API_KEY?: string;
};

export function readRwaFeatureConfig(
  env: RwaFeatureEnvironment,
): RwaFeatureConfig {
  return {
    stocksEnabled: env.ENABLE_STOCKS === "true",
    tradingEnabled: env.ENABLE_RWA_TRADING === "true",
    rewardsEnabled: env.ENABLE_RWA_REWARDS === "true",
    jupiterzRouteBadgeEnabled: env.ENABLE_JUPITERZ_ROUTE_BADGE === "true",
  };
}

export async function listRwaAssets(
  env: RwaFeatureEnvironment,
): Promise<RwaAsset[]> {
  const config = readRwaFeatureConfig(env);
  if (!config.stocksEnabled) return [];

  const prices = await getTokenPrices(
    RWA_REGISTRY.map((asset) => asset.mint),
    env.JUPITER_API_KEY,
  );
  const priceByMint = new Map(prices.map((price) => [price.address, price]));
  return RWA_REGISTRY.map((asset) => {
    const price = priceByMint.get(asset.mint);
    return RwaAssetSchema.parse({
      ...asset,
      priceUsd: price?.priceUsd ?? null,
      priceChange24hPercent: price?.priceChange24hPercent ?? null,
      tradingAvailability: config.tradingEnabled
        ? "tradable"
        : "discovery_only",
    });
  });
}

export function verifiedRwaAsset(mint: string): RegistryAsset | null {
  return RWA_BY_MINT.get(mint) ?? null;
}

export function assertVerifiedRwaPair(
  env: RwaFeatureEnvironment,
  inputMint: string,
  outputMint: string,
): void {
  const config = readRwaFeatureConfig(env);
  if (!config.stocksEnabled || !config.tradingEnabled) {
    throw new ApiFailure(
      503,
      "RWA_TRADING_NOT_ENABLED",
      "Stocks (RWA) trading is in a controlled rollout and is not enabled yet.",
      false,
    );
  }

  const inputRwa = RWA_BY_MINT.has(inputMint);
  const outputRwa = RWA_BY_MINT.has(outputMint);
  const inputAllowed = inputRwa || RWA_PAYMENT_MINTS.has(inputMint);
  const outputAllowed = outputRwa || RWA_PAYMENT_MINTS.has(outputMint);
  if (!inputAllowed || !outputAllowed || (!inputRwa && !outputRwa)) {
    throw new ApiFailure(
      400,
      "UNSUPPORTED_RWA_PAIR",
      "Choose a Walletor-verified stock or RWA and a supported payment asset.",
      false,
    );
  }
}
