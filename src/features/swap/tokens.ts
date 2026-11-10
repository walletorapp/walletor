import type { RwaAsset } from "../../../shared/rwa-contracts";

export interface SwapToken {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  color: string;
  logoUrl: string | null;
  isVerified: boolean;
  organicScore: number | null;
  organicScoreLabel: "high" | "medium" | "low" | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  topHoldersPercent: number | null;
  source: "jupiter" | "pumpfun" | "helius";
  discoveredAt: string | null;
  assetCategory?: "crypto" | "tokenized_stock" | "rwa";
  ticker?: string;
  issuer?: string;
  productLabel?: string;
  restrictionsSummary?: string;
}

export function rwaAssetToSwapToken(asset: RwaAsset): SwapToken {
  return {
    symbol: asset.tokenSymbol,
    name: asset.companyName,
    mint: asset.mint,
    decimals: asset.decimals,
    color: "linear-gradient(135deg, #2563eb, #22d3ee)",
    logoUrl: asset.logoUrl,
    isVerified: true,
    organicScore: null,
    organicScoreLabel: null,
    priceUsd: asset.priceUsd,
    liquidityUsd: null,
    marketCapUsd: null,
    holders: null,
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    topHoldersPercent: null,
    source: "jupiter",
    discoveredAt: null,
    assetCategory: asset.assetType,
    ticker: asset.ticker,
    issuer: asset.issuer,
    productLabel: asset.productLabel,
    restrictionsSummary: asset.restrictionsSummary,
  };
}

export const SOL_TOKEN: SwapToken = {
  symbol: "SOL",
  name: "Solana",
  mint: "So11111111111111111111111111111111111111112",
  decimals: 9,
  color: "linear-gradient(135deg, #9945ff, #14f195)",
  logoUrl: "/assets/solana-logo.svg",
  isVerified: true,
  organicScore: null,
  organicScoreLabel: "high",
  priceUsd: null,
  liquidityUsd: null,
  marketCapUsd: null,
  holders: null,
  mintAuthorityDisabled: true,
  freezeAuthorityDisabled: true,
  topHoldersPercent: null,
  source: "jupiter",
  discoveredAt: null,
};

export const USDC_TOKEN: SwapToken = {
  symbol: "USDC",
  name: "USD Coin",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
  color: "#2775ca",
  logoUrl:
    "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  isVerified: true,
  organicScore: null,
  organicScoreLabel: "high",
  priceUsd: null,
  liquidityUsd: null,
  marketCapUsd: null,
  holders: null,
  mintAuthorityDisabled: true,
  freezeAuthorityDisabled: true,
  topHoldersPercent: null,
  source: "jupiter",
  discoveredAt: null,
};

export const SWAP_TOKENS: SwapToken[] = [
  SOL_TOKEN,
  USDC_TOKEN,
  {
    symbol: "USDT",
    name: "Tether USD",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    color: "#26a17b",
    logoUrl:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
    isVerified: true,
    organicScore: null,
    organicScoreLabel: "high",
    priceUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    holders: null,
    mintAuthorityDisabled: true,
    freezeAuthorityDisabled: true,
    topHoldersPercent: null,
    source: "jupiter",
    discoveredAt: null,
  },
];

export function toAtomicAmount(value: string, decimals: number): string | null {
  const normalized = value.trim();
  if (!/^(?:\d+)(?:\.\d*)?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+/, "");
  return atomic || "0";
}

export function fromAtomicAmount(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
