import { describe, expect, it, vi } from "vitest";

import {
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
} from "../../shared/usdc-claim-contracts";
import { relayAdminSolanaRpc } from "./admin-solana-rpc";

const privateRpcUrl = "https://private-rpc.example/secret";
const env = {
  PAYOUTS_ENABLED: "true",
  SOLANA_CLAIM_NETWORK: "mainnet",
  SOLANA_CLAIM_PROGRAM_ID: "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
  SOLANA_CLAIM_AUTHORITY_ADDRESS:
    "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
  SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
  SOLANA_CLAIM_RPC_URL_PRIVATE: privateRpcUrl,
  SOLANA_SWITCHBOARD_PROGRAM_ID: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SOLANA_SWITCHBOARD_QUEUE_ADDRESS: SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
  PRIZE_POOL_CLAIM_FEE_BPS: "250",
} as const satisfies Partial<Env>;

describe("admin Solana RPC relay", () => {
  it("uses the private server binding without returning its URL", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ jsonrpc: "2.0", id: 7, result: "mainnet-genesis" }),
      );

    const result = await relayAdminSolanaRpc(
      env,
      { jsonrpc: "2.0", id: 7, method: "getGenesisHash", params: [] },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(privateRpcUrl);
    expect(JSON.stringify(result)).not.toContain(privateRpcUrl);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: "mainnet-genesis",
    });
  });

  it("rejects methods outside the claim signing allowlist", async () => {
    const fetcher = vi.fn();
    await expect(
      relayAdminSolanaRpc(
        env,
        {
          jsonrpc: "2.0",
          id: 8,
          method: "getProgramAccounts",
          params: [SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID],
        },
        fetcher,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_ADMIN_SOLANA_RPC_REQUEST",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects invalid account addresses before contacting Solana", async () => {
    const fetcher = vi.fn();
    await expect(
      relayAdminSolanaRpc(
        env,
        {
          jsonrpc: "2.0",
          id: 9,
          method: "getAccountInfo",
          params: ["not-an-account", { encoding: "base64" }],
        },
        fetcher,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_ADMIN_SOLANA_RPC_REQUEST",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
