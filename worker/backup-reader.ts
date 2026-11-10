import { WorkerEntrypoint } from "cloudflare:workers";
import { readAccountingEpoch } from "./lib/launch-config";
import { SOLANA_POOL_IDENTITY } from "./accounting/runtime";

// Named RPC entrypoint only: never mounted as a public HTTP route. An operator
// needs Cloudflare-authorized service-binding access, not a browser session.
export class WalletorBackupReader extends WorkerEntrypoint<Env> {
  async exportLedger() {
    const name = `${readAccountingEpoch(this.env)}:${SOLANA_POOL_IDENTITY.chainId}:${SOLANA_POOL_IDENTITY.poolId}`;
    const backup =
      await this.env.PRIZE_POOL_COORDINATOR.getByName(name).exportBackup();
    return {
      format: backup.format,
      sql: backup.sql,
      counts: backup.counts,
      createdAt: backup.createdAt,
      objectName: name,
    };
  }
}
