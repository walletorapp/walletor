import { VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { Buffer } from "buffer";

import { ComplianceStatusSchema } from "../../shared/compliance-contracts";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";
import {
  fetchOfacSnapshot,
  OfacSnapshotSchema,
  POLICY_VERSION,
  snapshotIsCurrent,
  type OfacSnapshot,
} from "./ofac";

type ComplianceEnvironment = Partial<Pick<Env, "DB">> & {
  SANCTIONS_SCREENING_ENABLED?: string;
};
type Action =
  "SWAP_ORDER" | "SWAP_EXECUTE" | "DISTRIBUTION_FUNDING" | "CLAIM_BUILD";

export function screeningEnabled(env: ComplianceEnvironment): boolean {
  if (
    env.SANCTIONS_SCREENING_ENABLED === undefined ||
    env.SANCTIONS_SCREENING_ENABLED === "false"
  )
    return false;
  if (env.SANCTIONS_SCREENING_ENABLED !== "true")
    throw new Error("Invalid sanctions screening configuration.");
  return true;
}

export async function readOfacSnapshot(
  db: D1Database,
): Promise<OfacSnapshot | null> {
  const row = await db
    .prepare(
      "SELECT snapshot_json FROM compliance_sources WHERE source_id = 'ofac-sdn-sol'",
    )
    .first<{ snapshot_json: string }>();
  if (!row) return null;
  return OfacSnapshotSchema.parse(JSON.parse(row.snapshot_json));
}

export async function saveOfacSnapshot(
  db: D1Database,
  snapshot: OfacSnapshot,
): Promise<void> {
  const validated = OfacSnapshotSchema.parse(snapshot);
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO compliance_source_versions (source_hash, snapshot_json) VALUES (?, ?)",
      )
      .bind(validated.hash, JSON.stringify(validated)),
    db
      .prepare(
        `INSERT INTO compliance_sources (source_id, fetched_at, snapshot_json)
    VALUES ('ofac-sdn-sol', ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET fetched_at = excluded.fetched_at, snapshot_json = excluded.snapshot_json
    WHERE excluded.fetched_at > compliance_sources.fetched_at`,
      )
      .bind(validated.fetchedAt, JSON.stringify(validated)),
  ]);
}

export async function refreshSanctionsSource(
  env: ComplianceEnvironment,
): Promise<void> {
  if (!screeningEnabled(env)) return;
  if (!env.DB) throw new Error("Sanctions database is unavailable.");
  let existing: OfacSnapshot | null = null;
  try {
    existing = await readOfacSnapshot(env.DB);
  } catch {
    console.error(
      JSON.stringify({ message: "sanctions_source_recovery_required" }),
    );
  }
  if (
    existing &&
    Date.now() - Date.parse(existing.fetchedAt) < 60 * 60_000 &&
    snapshotIsCurrent(existing, new Date())
  )
    return;
  const next = await fetchOfacSnapshot();
  await saveOfacSnapshot(env.DB, next);
  console.log(
    JSON.stringify({
      message: "sanctions_source_refreshed",
      fetchedAt: next.fetchedAt,
      hash: next.hash,
      addresses: next.entries.length,
    }),
  );
}

export async function complianceStatus(
  env: ComplianceEnvironment,
  now = new Date(),
) {
  let snapshot: OfacSnapshot | null = null;
  if (env.DB) {
    try {
      snapshot = await readOfacSnapshot(env.DB);
    } catch {
      console.error(
        JSON.stringify({ message: "sanctions_status_source_unavailable" }),
      );
    }
  }
  const enabled = screeningEnabled(env);
  return ComplianceStatusSchema.parse({
    enabled,
    policyVersion: POLICY_VERSION,
    scope: "OFAC_SDN_EXPLICIT_SOL_ADDRESSES_ONLY",
    state: !enabled
      ? "DISABLED"
      : snapshot && snapshotIsCurrent(snapshot, now)
        ? "CURRENT"
        : "UNAVAILABLE",
    fetchedAt: snapshot?.fetchedAt ?? null,
    publishedDate: snapshot?.publishedDate ?? null,
    addressCount: snapshot?.entries.length ?? 0,
    sourceHash: snapshot?.hash ?? null,
  });
}

export async function assertScreenedWallets(
  env: ComplianceEnvironment,
  addresses: readonly string[],
  action: Action,
  reference: string,
  now = new Date(),
): Promise<void> {
  if (!screeningEnabled(env)) return;
  const wallets = [...new Set(addresses)];
  if (
    !wallets.length ||
    wallets.length > 250 ||
    wallets.some((address) => !isSolanaAddress(address))
  ) {
    throw new ApiFailure(
      400,
      "INVALID_SCREENING_WALLET",
      "A valid transaction wallet is required.",
      false,
    );
  }
  if (!env.DB)
    throw new ApiFailure(
      503,
      "SCREENING_UNAVAILABLE",
      "Wallet screening is temporarily unavailable. Please try again later.",
      true,
    );
  const db = env.DB;
  let snapshot: OfacSnapshot | null = null;
  try {
    snapshot = await readOfacSnapshot(env.DB);
  } catch {
    console.error(
      JSON.stringify({ message: "sanctions_screen_source_unavailable" }),
    );
  }
  const current = snapshot && snapshotIsCurrent(snapshot, now);
  const events = wallets.map((address) => ({
    address,
    eventId: crypto.randomUUID(),
    // A stale known designation is not silently cleared during a source outage.
    decision: snapshot?.entries.some((entry) => entry.address === address)
      ? "RESTRICTED"
      : current
        ? "NO_DIRECT_MATCH"
        : "UNAVAILABLE",
  }));
  try {
    await db.batch(
      events.map((event) =>
        db
          .prepare(
            `INSERT INTO compliance_events
      (event_id, wallet_address, action, reference, decision, policy_version, source_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.eventId,
            event.address,
            action,
            reference.slice(0, 240),
            event.decision,
            POLICY_VERSION,
            snapshot?.hash ?? null,
            now.toISOString(),
          ),
      ),
    );
  } catch {
    console.error(
      JSON.stringify({ message: "sanctions_evidence_write_failed" }),
    );
    throw new ApiFailure(
      503,
      "SCREENING_UNAVAILABLE",
      "Wallet screening is temporarily unavailable. Please try again later.",
      true,
    );
  }
  const restricted = events.find((event) => event.decision === "RESTRICTED");
  if (restricted) {
    throw new ApiFailure(
      403,
      "WALLET_RESTRICTED",
      `This action is unavailable under Walletor's sanctions policy. Review reference: ${restricted.eventId}. See docs.walletor.com/legal/aml-sanctions/.`,
      false,
    );
  }
  if (!current)
    throw new ApiFailure(
      503,
      "SCREENING_UNAVAILABLE",
      "Wallet screening is temporarily unavailable. Please try again later.",
      true,
    );
}

// The browser-supplied taker alone is not screening evidence. Verify its
// signature over the submitted transaction, including sponsored transactions.
export function screenedSwapSigners(
  encodedTransaction: string,
  taker: string | undefined,
): string[] {
  try {
    if (!taker || !isSolanaAddress(taker)) throw new Error("Missing taker.");
    const bytes = Buffer.from(encodedTransaction, "base64");
    if (bytes.length > 1232) throw new Error("Transaction too large.");
    const transaction = VersionedTransaction.deserialize(bytes);
    const signers = transaction.message.staticAccountKeys.slice(
      0,
      transaction.message.header.numRequiredSignatures,
    );
    const index = signers.findIndex((key) => key.toBase58() === taker);
    const key = signers[index];
    const signature = transaction.signatures[index];
    if (
      !key ||
      !signature ||
      !ed25519.verify(signature, transaction.message.serialize(), key.toBytes())
    )
      throw new Error("Invalid taker signature.");
    return signers.map((key) => key.toBase58());
  } catch {
    throw new ApiFailure(
      400,
      "INVALID_SCREENING_SIGNATURE",
      "The signed transaction does not match the selected wallet.",
      false,
    );
  }
}
