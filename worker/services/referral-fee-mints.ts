import { z } from "zod";

import { ApiFailure } from "../lib/http";
import { isSolanaAddress, isSolanaSignature } from "../lib/solana";

export const ReferralFeeMintStatusSchema = z.enum([
  "PENDING",
  "INITIALIZING",
  "READY",
  "FAILED",
  "DISABLED",
]);

export const ReferralFeeMintStatusUpdateSchema = z
  .object({
    status: ReferralFeeMintStatusSchema,
    referralTokenAccount: z.string().nullable().default(null),
    initializationSignature: z.string().nullable().default(null),
    error: z.string().trim().min(1).max(300).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (
      value.referralTokenAccount !== null &&
      !isSolanaAddress(value.referralTokenAccount)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid referral token account.",
        path: ["referralTokenAccount"],
      });
    }
    if (
      value.initializationSignature !== null &&
      !isSolanaSignature(value.initializationSignature)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid initialization signature.",
        path: ["initializationSignature"],
      });
    }
    if (value.status === "READY" && value.referralTokenAccount === null) {
      context.addIssue({
        code: "custom",
        message: "A ready mint requires its referral token account.",
        path: ["referralTokenAccount"],
      });
    }
    if (value.status === "FAILED" && value.error === null) {
      context.addIssue({
        code: "custom",
        message: "A failed mint requires an error message.",
        path: ["error"],
      });
    }
  });

export type ReferralFeeMintStatus = z.infer<typeof ReferralFeeMintStatusSchema>;
export type ReferralFeeMintStatusUpdate = z.infer<
  typeof ReferralFeeMintStatusUpdateSchema
>;

type ReferralFeeMintRow = Readonly<{
  mint: string;
  referral_account: string;
  status: ReferralFeeMintStatus;
  observed_input_mint: string;
  observed_output_mint: string;
  configured_fee_bps: number;
  observed_platform_fee_bps: number | null;
  referral_token_account: string | null;
  initialization_signature: string | null;
  attempt_count: number;
  last_error: string | null;
  first_seen_at: string;
  last_seen_at: string;
  initialization_started_at: string | null;
  ready_at: string | null;
  updated_at: string;
}>;

export type ReferralFeeMintRecord = Readonly<{
  mint: string;
  referralAccount: string;
  status: ReferralFeeMintStatus;
  observedInputMint: string;
  observedOutputMint: string;
  configuredFeeBps: number;
  observedPlatformFeeBps: number | null;
  referralTokenAccount: string | null;
  initializationSignature: string | null;
  attemptCount: number;
  lastError: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  initializationStartedAt: string | null;
  readyAt: string | null;
  updatedAt: string;
}>;

function rowToRecord(row: ReferralFeeMintRow): ReferralFeeMintRecord {
  return {
    mint: row.mint,
    referralAccount: row.referral_account,
    status: row.status,
    observedInputMint: row.observed_input_mint,
    observedOutputMint: row.observed_output_mint,
    configuredFeeBps: row.configured_fee_bps,
    observedPlatformFeeBps: row.observed_platform_fee_bps,
    referralTokenAccount: row.referral_token_account,
    initializationSignature: row.initialization_signature,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    initializationStartedAt: row.initialization_started_at,
    readyAt: row.ready_at,
    updatedAt: row.updated_at,
  };
}

export async function recordReferralFeeMintObservation(
  db: D1Database,
  observation: Readonly<{
    mint: string;
    referralAccount: string;
    inputMint: string;
    outputMint: string;
    configuredFeeBps: number;
    observedPlatformFeeBps: number | null;
    feeApplied: boolean;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const status: ReferralFeeMintStatus = observation.feeApplied
    ? "READY"
    : "PENDING";
  await db
    .prepare(
      `INSERT INTO referral_fee_mints (
         mint, referral_account, status, observed_input_mint,
         observed_output_mint, configured_fee_bps,
         observed_platform_fee_bps, first_seen_at, last_seen_at, ready_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mint) DO UPDATE SET
         referral_account = excluded.referral_account,
         status = CASE
           WHEN excluded.status = 'READY' THEN 'READY'
           WHEN referral_fee_mints.status = 'INITIALIZING' THEN 'INITIALIZING'
           WHEN referral_fee_mints.status = 'DISABLED' THEN 'DISABLED'
           ELSE excluded.status
         END,
         observed_input_mint = excluded.observed_input_mint,
         observed_output_mint = excluded.observed_output_mint,
         configured_fee_bps = excluded.configured_fee_bps,
         observed_platform_fee_bps = excluded.observed_platform_fee_bps,
         last_seen_at = excluded.last_seen_at,
         ready_at = CASE
           WHEN excluded.status = 'READY' THEN excluded.ready_at
           ELSE referral_fee_mints.ready_at
         END,
         last_error = CASE
           WHEN excluded.status = 'READY' THEN NULL
           ELSE referral_fee_mints.last_error
         END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      observation.mint,
      observation.referralAccount,
      status,
      observation.inputMint,
      observation.outputMint,
      observation.configuredFeeBps,
      observation.observedPlatformFeeBps,
      now,
      now,
      status === "READY" ? now : null,
      now,
    )
    .run();
}

export async function listReferralFeeMints(
  db: D1Database,
  status: ReferralFeeMintStatus,
  limit = 100,
): Promise<ReferralFeeMintRecord[]> {
  const result = await db
    .prepare(
      `SELECT mint, referral_account, status, observed_input_mint,
              observed_output_mint, configured_fee_bps,
              observed_platform_fee_bps, referral_token_account,
              initialization_signature, attempt_count, last_error,
              first_seen_at, last_seen_at, initialization_started_at,
              ready_at, updated_at
       FROM referral_fee_mints
       WHERE status = ?
       ORDER BY last_seen_at DESC
       LIMIT ?`,
    )
    .bind(status, limit)
    .all<ReferralFeeMintRow>();
  return result.results.map(rowToRecord);
}

export async function updateReferralFeeMintStatus(
  db: D1Database,
  mint: string,
  update: ReferralFeeMintStatusUpdate,
): Promise<ReferralFeeMintRecord> {
  if (!isSolanaAddress(mint)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Enter a valid Solana fee mint.",
      false,
    );
  }
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE referral_fee_mints
       SET status = ?,
           referral_token_account = COALESCE(?, referral_token_account),
           initialization_signature = COALESCE(?, initialization_signature),
           attempt_count = attempt_count + CASE WHEN ? = 'INITIALIZING' THEN 1 ELSE 0 END,
           initialization_started_at = CASE
             WHEN ? = 'INITIALIZING' THEN ?
             ELSE initialization_started_at
           END,
           ready_at = CASE WHEN ? = 'READY' THEN ? ELSE ready_at END,
           last_error = CASE WHEN ? = 'FAILED' THEN ? ELSE NULL END,
           updated_at = ?
       WHERE mint = ?`,
    )
    .bind(
      update.status,
      update.referralTokenAccount,
      update.initializationSignature,
      update.status,
      update.status,
      now,
      update.status,
      now,
      update.status,
      update.error,
      now,
      mint,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiFailure(
      404,
      "REFERRAL_FEE_MINT_NOT_FOUND",
      "The requested fee mint is not in Walletor's activation queue.",
      false,
    );
  }
  const row = await db
    .prepare(
      `SELECT mint, referral_account, status, observed_input_mint,
              observed_output_mint, configured_fee_bps,
              observed_platform_fee_bps, referral_token_account,
              initialization_signature, attempt_count, last_error,
              first_seen_at, last_seen_at, initialization_started_at,
              ready_at, updated_at
       FROM referral_fee_mints
       WHERE mint = ?`,
    )
    .bind(mint)
    .first<ReferralFeeMintRow>();
  if (!row) {
    throw new ApiFailure(
      500,
      "REFERRAL_FEE_MINT_UPDATE_FAILED",
      "Walletor could not read the updated fee-mint record.",
      true,
    );
  }
  return rowToRecord(row);
}
