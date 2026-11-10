import { Connection } from "@solana/web3.js";

const SWITCHBOARD_GATEWAY_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

class AdminSolanaConnection extends Connection {
  override get rpcEndpoint(): string {
    // Switchboard passes this public URL to its oracle gateway during reveal.
    // Connection requests still use the authenticated same-origin endpoint
    // supplied to the base constructor.
    return SWITCHBOARD_GATEWAY_RPC_ENDPOINT;
  }
}

export function createAdminSolanaConnection(origin: string): Connection {
  return new AdminSolanaConnection(
    new URL("/admin/api/solana-rpc", origin).toString(),
    {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    },
  );
}
