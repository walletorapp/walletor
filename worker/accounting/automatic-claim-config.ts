import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import { readUsdcClaimConfig } from "./usdc-claim-config";
import { REWARDS_AUTOMATION_ADDRESS } from "../../shared/treasury-setup-contracts";

export function automationClaimBindings(env: Partial<Env>) {
  return { ...env, SOLANA_CLAIM_AUTHORITY_ADDRESS: REWARDS_AUTOMATION_ADDRESS };
}

export function readRewardsAutomationConfig(env: Partial<Env>) {
  return readAutomaticClaimConfig(automationClaimBindings(env));
}

type AutomaticClaimEnvironment = Partial<
  Record<
    | "AUTOMATIC_CLAIM_SETTLEMENT_ENABLED"
    | "MAGICBLOCK_FIRST_ROUND_AT"
    | "SOLANA_CLAIM_AUTOMATION_SECRET"
    | "SOLANA_CLAIM_NETWORK"
    | "SOLANA_CLAIM_PROGRAM_ID"
    | "SOLANA_CLAIM_AUTHORITY_ADDRESS"
    | "SOLANA_CLAIM_RPC_URL"
    | "SOLANA_CLAIM_RPC_URL_PRIVATE"
    | "SOLANA_SWITCHBOARD_PROGRAM_ID"
    | "SOLANA_SWITCHBOARD_QUEUE_ADDRESS"
    | "PRIZE_POOL_CLAIM_FEE_BPS"
    | "PAYOUTS_ENABLED",
    string
  >
>;

export interface AutomaticClaimConfig {
  enabled: boolean;
  authority: Keypair | null;
}

export function readAutomaticClaimConfig(
  env: AutomaticClaimEnvironment,
): AutomaticClaimConfig {
  const enabled = env.AUTOMATIC_CLAIM_SETTLEMENT_ENABLED === "true";
  if (!enabled) return { enabled: false, authority: null };
  if (env.MAGICBLOCK_FIRST_ROUND_AT?.trim()) {
    throw new Error(
      "MagicBlock currently uses wallet-approved requests and funding. Keep AUTOMATIC_CLAIM_SETTLEMENT_ENABLED=false.",
    );
  }

  const encodedSecret = env.SOLANA_CLAIM_AUTOMATION_SECRET?.trim() ?? "";
  let secretKey: Uint8Array;
  try {
    secretKey = bs58.decode(encodedSecret);
  } catch {
    throw new Error(
      "SOLANA_CLAIM_AUTOMATION_SECRET must be a base58 Solana secret key.",
    );
  }
  if (secretKey.byteLength !== 64) {
    throw new Error(
      "SOLANA_CLAIM_AUTOMATION_SECRET must contain a 64-byte Solana secret key.",
    );
  }
  const authority = Keypair.fromSecretKey(secretKey);
  const claimConfig = readUsdcClaimConfig(env);
  if (!claimConfig.executionEnabled) {
    throw new Error(
      "Automatic claim settlement requires PAYOUTS_ENABLED=true.",
    );
  }
  if (authority.publicKey.toBase58() !== claimConfig.authorityAddress) {
    throw new Error(
      "The automatic claim signer does not match SOLANA_CLAIM_AUTHORITY_ADDRESS.",
    );
  }
  return { enabled: true, authority };
}
