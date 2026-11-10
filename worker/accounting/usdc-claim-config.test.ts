import { describe, expect, it } from "vitest";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
} from "../../shared/usdc-claim-contracts";
import { readUsdcClaimConfig } from "./usdc-claim-config";

const authority = "9JaZ9rCJG9w87GegKLAExgzDKcYpMVsg5roimCu5VeUR";

function claimEnvironment(overrides: Record<string, string> = {}) {
  return {
    PAYOUTS_ENABLED: "false",
    SOLANA_CLAIM_NETWORK: "mainnet",
    SOLANA_CLAIM_PROGRAM_ID: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    SOLANA_CLAIM_AUTHORITY_ADDRESS: authority,
    SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
    SOLANA_SWITCHBOARD_PROGRAM_ID: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
    SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
      SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
    PRIZE_POOL_CLAIM_FEE_BPS: "250",
    ...overrides,
  };
}

describe("USDC claim configuration", () => {
  it("keeps existing claims enabled while new funding is held for verification", () => {
    expect(
      readUsdcClaimConfig(claimEnvironment({ PAYOUTS_ENABLED: "true" })),
    ).toMatchObject({ executionEnabled: true, fundingEnabled: false });
    expect(
      readUsdcClaimConfig(
        claimEnvironment({
          PAYOUTS_ENABLED: "true",
          USDC_DISTRIBUTION_FUNDING_ENABLED: "true",
        }),
      ),
    ).toMatchObject({ executionEnabled: true, fundingEnabled: true });
    expect(
      readUsdcClaimConfig(
        claimEnvironment({
          PAYOUTS_ENABLED: "false",
          USDC_DISTRIBUTION_FUNDING_ENABLED: "true",
        }),
      ),
    ).toMatchObject({ executionEnabled: false, fundingEnabled: false });
  });
  it("pins mainnet USDC claims to the approved programs, queue, authority, and 250 bps", () => {
    const config = readUsdcClaimConfig(claimEnvironment());

    expect(config).toMatchObject({
      executionEnabled: false,
      network: "MAINNET",
      programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
      authorityAddress: authority,
      switchboardProgramId: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
      switchboardQueueAddress: SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
      claimFeeBps: 250,
    });
  });

  it("uses the private RPC binding without exposing it through public configuration", () => {
    const config = readUsdcClaimConfig(
      claimEnvironment({
        SOLANA_CLAIM_RPC_URL_PRIVATE: "https://private-rpc.example.com",
      }),
    );

    expect(config.rpcUrl).toBe("https://private-rpc.example.com");
  });

  it.each([
    ["PRIZE_POOL_CLAIM_FEE_BPS", "50", /250/],
    ["SOLANA_CLAIM_NETWORK", "devnet", /mainnet/i],
    ["SOLANA_CLAIM_PROGRAM_ID", authority, /Rewards program/],
    ["SOLANA_SWITCHBOARD_PROGRAM_ID", authority, /Switchboard/],
    ["SOLANA_SWITCHBOARD_QUEUE_ADDRESS", authority, /On-Demand queue/],
  ])("rejects an unsafe %s override", (name, value, expected) => {
    expect(() =>
      readUsdcClaimConfig(claimEnvironment({ [name]: value })),
    ).toThrow(expected);
  });
});
