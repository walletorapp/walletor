import type { Connection } from "@solana/web3.js";

export type TreasuryOperationKind = "COLLECT" | "CONVERT" | "UNWRAP";
export interface TreasuryOperation {
  operation_id: string;
  round_id: string;
  kind: TreasuryOperationKind;
  mint: string;
  input_amount_atomic: string;
  minimum_output_atomic: string;
  status: "SIGNED" | "FINALIZED" | "EXPIRED" | "FAILED";
  signature: string;
  signed_transaction: string;
  last_valid_block_height: string;
  jupiter_request_id: string | null;
  jupiter_result_json: string | null;
  output_amount_atomic: string | null;
}

export function atomic(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid atomic amount.");
  return BigInt(value);
}

/** Never renew a transaction on a timeout alone. */
export async function transactionResolution(
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  signature: string,
  lastValidBlockHeight: string,
): Promise<"FINALIZED" | "EXPIRED" | "FAILED" | "PENDING"> {
  const readStatus = async () =>
    (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
  const status = await readStatus();
  if (status?.confirmationStatus === "finalized") {
    return status.err ? "FAILED" : "FINALIZED";
  }
  if (status) return "PENDING";
  const height = await connection.getBlockHeight("finalized");
  if (!Number.isSafeInteger(height))
    throw new Error("Invalid finalized block height.");
  if (BigInt(height) <= atomic(lastValidBlockHeight)) return "PENDING";
  // Re-read after the finalized height check to close the indexing race.
  const after = await readStatus();
  if (after?.confirmationStatus === "finalized")
    return after.err ? "FAILED" : "FINALIZED";
  return after ? "PENDING" : "EXPIRED";
}

export async function currentTreasuryOperation(
  db: D1Database,
): Promise<TreasuryOperation | null> {
  return db
    .prepare("SELECT * FROM treasury_operations WHERE status = 'SIGNED'")
    .first<TreasuryOperation>();
}

export async function persistTreasuryOperation(
  db: D1Database,
  operation: Omit<
    TreasuryOperation,
    "status" | "jupiter_result_json" | "output_amount_atomic"
  >,
  now = new Date(),
): Promise<TreasuryOperation> {
  atomic(operation.input_amount_atomic);
  atomic(operation.minimum_output_atomic);
  atomic(operation.last_valid_block_height);
  await db
    .prepare(
      `INSERT INTO treasury_operations (
    operation_id, round_id, kind, mint, input_amount_atomic, minimum_output_atomic,
    status, signature, signed_transaction, last_valid_block_height, jupiter_request_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'SIGNED', ?, ?, ?, ?, ?)
  ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      operation.operation_id,
      operation.round_id,
      operation.kind,
      operation.mint,
      operation.input_amount_atomic,
      operation.minimum_output_atomic,
      operation.signature,
      operation.signed_transaction,
      operation.last_valid_block_height,
      operation.jupiter_request_id,
      now.toISOString(),
    )
    .run();
  const saved = await db
    .prepare("SELECT * FROM treasury_operations WHERE operation_id = ?")
    .bind(operation.operation_id)
    .first<TreasuryOperation>();
  if (!saved) throw new Error("Treasury operation was not persisted.");
  // A competing invocation must never broadcast its own unpersisted payload.
  for (const key of [
    "round_id",
    "kind",
    "mint",
    "input_amount_atomic",
    "minimum_output_atomic",
  ] as const) {
    if (saved[key] !== operation[key])
      throw new Error("Treasury operation identity conflict.");
  }
  return saved;
}

export async function resolveTreasuryOperation(
  db: D1Database,
  operation: TreasuryOperation,
  resolution: "EXPIRED" | "FAILED" | "FINALIZED",
  outputAmountAtomic: string | null,
  now = new Date(),
): Promise<void> {
  if (resolution === "FINALIZED") {
    if (
      outputAmountAtomic === null ||
      atomic(outputAmountAtomic) < atomic(operation.minimum_output_atomic)
    ) {
      throw new Error(
        "Finalized treasury proceeds are below the committed minimum.",
      );
    }
    if (operation.kind === "CONVERT" && !operation.jupiter_result_json) {
      throw new Error(
        "Jupiter execution confirmation is required before recording conversion proceeds.",
      );
    }
  }
  await db
    .prepare(
      `UPDATE treasury_operations SET status = ?, output_amount_atomic = ?, finalized_at = ?
    WHERE operation_id = ? AND status = 'SIGNED' AND signature = ?`,
    )
    .bind(
      resolution,
      outputAmountAtomic,
      now.toISOString(),
      operation.operation_id,
      operation.signature,
    )
    .run();
}

export async function confirmedRoundFunding(
  db: D1Database,
  roundId: string,
  authority: string,
): Promise<string> {
  const funding = await db
    .prepare(
      "SELECT authority_address, amount_atomic FROM round_usdc_funding WHERE round_id = ?",
    )
    .bind(roundId)
    .first<{ authority_address: string; amount_atomic: string }>();
  if (
    funding?.authority_address !== authority ||
    atomic(funding.amount_atomic) <= 0n
  ) {
    throw new Error(
      "This round has no verified USDC funding reservation. Estimated earnings cannot fund claims.",
    );
  }
  return funding.amount_atomic;
}
