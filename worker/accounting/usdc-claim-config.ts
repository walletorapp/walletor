import bs58 from "bs58";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
  USDC_CLAIM_FEE_BPS,
} from "../../shared/usdc-claim-contracts";

type UsdcClaimConfigKey =
  | "PAYOUTS_ENABLED"
  | "USDC_DISTRIBUTION_FUNDING_ENABLED"
  | "SOLANA_CLAIM_NETWORK"
  | "SOLANA_CLAIM_PROGRAM_ID"
  | "SOLANA_CLAIM_AUTHORITY_ADDRESS"
  | "SOLANA_CLAIM_RPC_URL"
  | "SOLANA_CLAIM_RPC_URL_PRIVATE"
  | "SOLANA_SWITCHBOARD_PROGRAM_ID"
  | "SOLANA_SWITCHBOARD_QUEUE_ADDRESS"
  | "PRIZE_POOL_CLAIM_FEE_BPS";

type UsdcClaimEnvironment = Partial<Record<UsdcClaimConfigKey, string>>;

export interface UsdcClaimConfig {
  executionEnabled: boolean;
  fundingEnabled: boolean;
  network: "MAINNET";
  programId: typeof SOLANA_FOUNDATION_REWARDS_PROGRAM_ID;
  mintAddress: typeof SOLANA_MAINNET_USDC_MINT;
  authorityAddress: string;
  rpcUrl: string;
  switchboardProgramId: typeof SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID;
  switchboardQueueAddress: typeof SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS;
  claimFeeBps: typeof USDC_CLAIM_FEE_BPS;
}

function requireSolanaAddress(name: string, value: string): void {
  try {
    if (bs58.decode(value).byteLength !== 32) throw new Error("wrong length");
  } catch {
    throw new Error(`${name} must be a valid Solana public key.`);
  }
}

function requireHttpsUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS.`);
  }
}

export function readUsdcClaimConfig(
  env: UsdcClaimEnvironment,
): UsdcClaimConfig {
  if (env.SOLANA_CLAIM_NETWORK?.trim().toUpperCase() !== "MAINNET") {
    throw new Error("USDC claims require SOLANA_CLAIM_NETWORK=mainnet.");
  }
  if (
    env.SOLANA_CLAIM_PROGRAM_ID?.trim() !== SOLANA_FOUNDATION_REWARDS_PROGRAM_ID
  ) {
    throw new Error(
      "SOLANA_CLAIM_PROGRAM_ID must be the Solana Foundation Rewards program.",
    );
  }
  const authorityAddress = env.SOLANA_CLAIM_AUTHORITY_ADDRESS?.trim() ?? "";
  requireSolanaAddress("SOLANA_CLAIM_AUTHORITY_ADDRESS", authorityAddress);
  if (env.PRIZE_POOL_CLAIM_FEE_BPS?.trim() !== String(USDC_CLAIM_FEE_BPS)) {
    throw new Error("USDC claims require PRIZE_POOL_CLAIM_FEE_BPS=250.");
  }
  if (
    env.SOLANA_SWITCHBOARD_PROGRAM_ID?.trim() !==
    SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID
  ) {
    throw new Error(
      "SOLANA_SWITCHBOARD_PROGRAM_ID must be the mainnet Switchboard On-Demand program.",
    );
  }
  if (
    env.SOLANA_SWITCHBOARD_QUEUE_ADDRESS?.trim() !==
    SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS
  ) {
    throw new Error(
      "SOLANA_SWITCHBOARD_QUEUE_ADDRESS must be the mainnet On-Demand queue.",
    );
  }
  const privateRpc = env.SOLANA_CLAIM_RPC_URL_PRIVATE?.trim();
  const rpcUrl =
    privateRpc && privateRpc.length > 0
      ? privateRpc
      : (env.SOLANA_CLAIM_RPC_URL?.trim() ?? "");
  requireHttpsUrl("SOLANA_CLAIM_RPC_URL", rpcUrl);

  return {
    executionEnabled: env.PAYOUTS_ENABLED === "true",
    fundingEnabled:
      env.PAYOUTS_ENABLED === "true" &&
      env.USDC_DISTRIBUTION_FUNDING_ENABLED === "true",
    network: "MAINNET",
    programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    mintAddress: SOLANA_MAINNET_USDC_MINT,
    authorityAddress,
    rpcUrl,
    switchboardProgramId: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
    switchboardQueueAddress: SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
    claimFeeBps: USDC_CLAIM_FEE_BPS,
  };
}
