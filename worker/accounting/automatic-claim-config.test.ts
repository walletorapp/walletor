import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
} from "../../shared/usdc-claim-contracts";
import { readAutomaticClaimConfig } from "./automatic-claim-config";

function automaticEnvironment(signer: Keypair) {
  return {
    AUTOMATIC_CLAIM_SETTLEMENT_ENABLED: "true",
    SOLANA_CLAIM_AUTOMATION_SECRET: bs58.encode(signer.secretKey),
    PAYOUTS_ENABLED: "true",
    SOLANA_CLAIM_NETWORK: "mainnet",
    SOLANA_CLAIM_PROGRAM_ID: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    SOLANA_CLAIM_AUTHORITY_ADDRESS: signer.publicKey.toBase58(),
    SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
    SOLANA_SWITCHBOARD_PROGRAM_ID: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
    SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
      SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
    PRIZE_POOL_CLAIM_FEE_BPS: "250",
  };
}

describe("automatic claim configuration", () => {
  it("does not require or decode a signer while the gate is disabled", () => {
    expect(
      readAutomaticClaimConfig({
        AUTOMATIC_CLAIM_SETTLEMENT_ENABLED: "false",
      }),
    ).toEqual({ enabled: false, authority: null });
  });

  it("accepts only the secret matching the configured claim authority", () => {
    const signer = Keypair.generate();
    const config = readAutomaticClaimConfig(automaticEnvironment(signer));

    expect(config.enabled).toBe(true);
    expect(config.authority?.publicKey.toBase58()).toBe(
      signer.publicKey.toBase58(),
    );
  });

  it("rejects a signer that differs from the public claim authority", () => {
    const signer = Keypair.generate();
    const environment = automaticEnvironment(signer);

    expect(() =>
      readAutomaticClaimConfig({
        ...environment,
        SOLANA_CLAIM_AUTHORITY_ADDRESS: Keypair.generate().publicKey.toBase58(),
      }),
    ).toThrow(/does not match/);
  });
});
