import {
  AnchorProvider,
  type Wallet,
} from "@coral-xyz/anchor/dist/cjs/index.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";

import {
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
  UsdcClaimDistributionManifestDraftSchema,
  type UsdcClaimDistributionManifest,
  type UsdcClaimDistributionPrepareResult,
} from "../../shared/usdc-claim-contracts";
import { deriveVerifiedPrizeDrawWinners } from "../accounting/runtime";
import type { PrizeDrawOperationalSummary } from "../accounting/coordinator";
import {
  readRewardsAutomationConfig,
  automationClaimBindings,
} from "../accounting/automatic-claim-config";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { prepareSwitchboardRandomnessReveal } from "./switchboard-randomness";
import {
  confirmedRoundFunding,
  transactionResolution,
} from "./treasury-journal";
import {
  activateUsdcClaimDistribution,
  prepareUsdcClaimDistribution,
  stageUsdcClaimDistribution,
  verifiedSwitchboardRandomnessValue,
} from "./usdc-claims";

type AutomaticSettlementStatus =
  | "INITIALIZED"
  | "COMMITTING"
  | "COMMITTED"
  | "REVEALING"
  | "REVEALED"
  | "FUNDING"
  | "STAGED"
  | "ACTIVE";

interface AutomaticSettlementRow {
  round_id: string;
  status: AutomaticSettlementStatus;
  authority_address: string;
  randomness_account: string;
  distribution_seed_address: string;
  commit_transaction_signature: string | null;
  commit_signed_transaction: string | null;
  commit_last_valid_block_height: string | null;
  reveal_transaction_signature: string | null;
  reveal_signed_transaction: string | null;
  reveal_last_valid_block_height: string | null;
  preparation_id: string | null;
  funding_transaction_signature: string | null;
  funding_signed_transaction: string | null;
  funding_last_valid_block_height: string | null;
  manifest_checksum: string | null;
  distribution_address: string | null;
}

interface PreparationRow {
  preparation_id: string;
  status: "PREPARED" | "STAGED";
  manifest_draft_json: string;
  unsigned_transaction: string;
  blockhash: string;
  last_valid_block_height: string;
}

export interface AutomaticSettlementIdentity {
  status: AutomaticSettlementStatus | "DISABLED";
  roundId: string;
  randomnessAccount: string | null;
  distributionSeedAddress: string | null;
}

export interface AutomaticRandomnessEvidence {
  roundId: string;
  randomnessAccount: string;
  commitTransactionSignature: string;
  revealTransactionSignature: string;
}

class AutomationWallet implements Wallet {
  readonly publicKey: PublicKey;
  readonly payer: Keypair;

  constructor(signer: Keypair) {
    this.payer = signer;
    this.publicKey = signer.publicKey;
  }

  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.payer]);
    } else {
      transaction.partialSign(this.payer);
    }
    return Promise.resolve(transaction);
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return Promise.all(
      transactions.map((transaction) => this.signTransaction(transaction)),
    );
  }
}

function connectionFor(env: Partial<Env>): Connection {
  const config = readUsdcClaimConfig(env);
  return new Connection(config.rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
}

async function derivedSigner(
  authority: Keypair,
  domain: "switchboard-randomness" | "rewards-distribution",
  roundId: string,
): Promise<Keypair> {
  const key = await crypto.subtle.importKey(
    "raw",
    authority.secretKey.slice(0, 32),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`walletor:${domain}:${roundId}`),
  );
  return Keypair.fromSeed(new Uint8Array(digest).slice(0, 32));
}

async function settlementRow(
  db: D1Database,
  roundId: string,
): Promise<AutomaticSettlementRow> {
  const row = await db
    .prepare("SELECT * FROM automatic_claim_settlements WHERE round_id = ?")
    .bind(roundId)
    .first<AutomaticSettlementRow>();
  if (!row) throw new Error("Automatic claim settlement state is missing.");
  return row;
}

async function distributionStatus(
  db: D1Database,
  roundId: string,
): Promise<"STAGED" | "ACTIVE" | null> {
  const row = await db
    .prepare(
      "SELECT status FROM usdc_claim_distributions WHERE round_id = ? AND status IN ('STAGED', 'ACTIVE')",
    )
    .bind(roundId)
    .first<{ status: "STAGED" | "ACTIVE" }>();
  return row?.status ?? null;
}

function requireAuthority(env: Partial<Env>): Keypair {
  const config = readRewardsAutomationConfig(env);
  if (!config.enabled || !config.authority) {
    throw new Error("Automatic claim settlement is disabled.");
  }
  return config.authority;
}

function requireText(value: string | null, label: string): string {
  if (!value) throw new Error(`${label} is missing from settlement state.`);
  return value;
}

function legacySignature(transaction: Transaction): string {
  if (!transaction.signature) {
    throw new Error("The automatic transaction was not signed.");
  }
  return bs58.encode(transaction.signature);
}

function versionedSignature(transaction: VersionedTransaction): string {
  const signature = transaction.signatures[0];
  if (!signature || signature.every((byte) => byte === 0)) {
    throw new Error("The automatic transaction was not signed.");
  }
  return bs58.encode(signature);
}

async function sendPersistedTransaction(
  connection: Connection,
  signedTransaction: string,
  expectedSignature: string,
): Promise<string> {
  const bytes = Buffer.from(signedTransaction, "base64");
  try {
    const signature = await connection.sendRawTransaction(bytes, {
      maxRetries: 3,
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    if (signature !== expectedSignature) {
      throw new Error("Solana returned an unexpected transaction signature.");
    }
    return signature;
  } catch (error) {
    const statuses = await connection.getSignatureStatuses(
      [expectedSignature],
      { searchTransactionHistory: true },
    );
    if (statuses.value[0] && !statuses.value[0].err) return expectedSignature;
    throw error;
  }
}

async function resumeAutomaticTransaction(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
  phase: "commit" | "reveal" | "funding",
) {
  const row = await settlementRow(db, roundId);
  const signature = requireText(
    row[`${phase}_transaction_signature`],
    "Transaction signature",
  );
  const payload = requireText(
    row[`${phase}_signed_transaction`],
    "Signed transaction",
  );
  const height = requireText(
    row[`${phase}_last_valid_block_height`],
    "Transaction lifetime",
  );
  const connection = connectionFor(env);
  const state = await transactionResolution(connection, signature, height);
  if (state === "FINALIZED") return signature;
  if (state === "FAILED")
    throw new Error(
      `Automatic ${phase} transaction failed on-chain and requires inspection: ${signature}`,
    );
  if (state === "PENDING")
    return sendPersistedTransaction(connection, payload, signature);
  const signer = requireAuthority(env);
  let renewedPayload: string;
  let renewedSignature: string;
  let renewedHeight: string;
  if (phase === "reveal") {
    const prepared = await prepareSwitchboardRandomnessReveal(
      automationClaimBindings(env),
      row.randomness_account,
    );
    const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    tx.partialSign(signer);
    renewedPayload = tx.serialize().toString("base64");
    renewedSignature = legacySignature(tx);
    renewedHeight = prepared.lastValidBlockHeight;
  } else {
    const lifetime = await connection.getLatestBlockhash("finalized");
    renewedHeight = String(lifetime.lastValidBlockHeight);
    const extra = await derivedSigner(
      signer,
      phase === "commit" ? "switchboard-randomness" : "rewards-distribution",
      roundId,
    );
    if (phase === "commit") {
      const tx = Transaction.from(Buffer.from(payload, "base64"));
      tx.recentBlockhash = lifetime.blockhash;
      tx.sign(signer, extra);
      renewedSignature = legacySignature(tx);
      renewedPayload = tx.serialize().toString("base64");
    } else {
      const tx = VersionedTransaction.deserialize(
        Buffer.from(payload, "base64"),
      );
      tx.message.recentBlockhash = lifetime.blockhash;
      tx.sign([signer, extra]);
      renewedSignature = versionedSignature(tx);
      renewedPayload = Buffer.from(tx.serialize()).toString("base64");
    }
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO automatic_claim_transaction_attempts VALUES (?, ?, ?, ?, ?, 'EXPIRED', ?)
      ON CONFLICT(signature) DO NOTHING`,
      )
      .bind(
        signature,
        roundId,
        phase,
        payload,
        height,
        new Date().toISOString(),
      ),
    db
      .prepare(
        `UPDATE automatic_claim_settlements SET ${phase}_transaction_signature = ?,
      ${phase}_signed_transaction = ?, ${phase}_last_valid_block_height = ?
      WHERE round_id = ? AND ${phase}_transaction_signature = ?`,
      )
      .bind(
        renewedSignature,
        renewedPayload,
        renewedHeight,
        roundId,
        signature,
      ),
  ]);
  const persisted = await settlementRow(db, roundId);
  return sendPersistedTransaction(
    connection,
    requireText(
      persisted[`${phase}_signed_transaction`],
      "Renewed transaction",
    ),
    requireText(
      persisted[`${phase}_transaction_signature`],
      "Renewed signature",
    ),
  );
}

async function assertConfirmed(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: string,
): Promise<void> {
  const statuses = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const status = statuses.value[0];
  if (status?.err) {
    throw new Error(`Solana rejected transaction ${signature}.`);
  }
  if (status?.confirmationStatus === "finalized") {
    return;
  }
  const blockHeight = await connection.getBlockHeight("confirmed");
  if (BigInt(blockHeight) > BigInt(lastValidBlockHeight)) {
    throw new Error(`Solana transaction ${signature} expired unconfirmed.`);
  }
  throw new Error(`Solana transaction ${signature} is awaiting confirmation.`);
}

async function preparationForRound(
  db: D1Database,
  roundId: string,
): Promise<PreparationRow | null> {
  return db
    .prepare(
      `SELECT preparation_id, status, manifest_draft_json,
        unsigned_transaction, blockhash, last_valid_block_height
       FROM usdc_claim_preparations
       WHERE round_id = ? AND status IN ('PREPARED', 'STAGED')
       ORDER BY prepared_at DESC LIMIT 1`,
    )
    .bind(roundId)
    .first<PreparationRow>();
}

function preparationResult(
  row: PreparationRow,
): UsdcClaimDistributionPrepareResult {
  return {
    preparationId: row.preparation_id,
    network: "MAINNET",
    transaction: row.unsigned_transaction,
    blockhash: row.blockhash,
    lastValidBlockHeight: row.last_valid_block_height,
    manifest: UsdcClaimDistributionManifestDraftSchema.parse(
      JSON.parse(row.manifest_draft_json),
    ),
  };
}

export async function initializeAutomaticClaimSettlement(
  db: D1Database,
  env: Partial<Env>,
  draw: PrizeDrawOperationalSummary,
  now = new Date(),
): Promise<AutomaticSettlementIdentity> {
  const automatic = readRewardsAutomationConfig(env);
  if (!automatic.enabled || !automatic.authority) {
    return {
      status: "DISABLED",
      roundId: draw.roundId,
      randomnessAccount: null,
      distributionSeedAddress: null,
    };
  }
  if (draw.participantCount === 0 || BigInt(draw.grossPoolCents) <= 0n) {
    throw new Error("An empty Prize Pool round cannot be settled.");
  }
  const existingDistribution = await distributionStatus(db, draw.roundId);
  if (existingDistribution) {
    return {
      status: existingDistribution,
      roundId: draw.roundId,
      randomnessAccount: null,
      distributionSeedAddress: null,
    };
  }

  const randomness = await derivedSigner(
    automatic.authority,
    "switchboard-randomness",
    draw.roundId,
  );
  const distributionSeed = await derivedSigner(
    automatic.authority,
    "rewards-distribution",
    draw.roundId,
  );
  const timestamp = now.toISOString();
  await db
    .prepare(
      `INSERT INTO automatic_claim_settlements (
        round_id, status, authority_address, randomness_account,
        distribution_seed_address, created_at, updated_at
      ) VALUES (?, 'INITIALIZED', ?, ?, ?, ?, ?)
      ON CONFLICT(round_id) DO NOTHING`,
    )
    .bind(
      draw.roundId,
      automatic.authority.publicKey.toBase58(),
      randomness.publicKey.toBase58(),
      distributionSeed.publicKey.toBase58(),
      timestamp,
      timestamp,
    )
    .run();
  const row = await settlementRow(db, draw.roundId);
  if (
    row.authority_address !== automatic.authority.publicKey.toBase58() ||
    row.randomness_account !== randomness.publicKey.toBase58() ||
    row.distribution_seed_address !== distributionSeed.publicKey.toBase58()
  ) {
    throw new Error("Automatic claim settlement identity does not match.");
  }
  return {
    status: row.status,
    roundId: row.round_id,
    randomnessAccount: row.randomness_account,
    distributionSeedAddress: row.distribution_seed_address,
  };
}

export async function broadcastAutomaticRandomnessCommit(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
  now = new Date(),
): Promise<{ signature: string; randomnessAccount: string }> {
  const authority = requireAuthority(env);
  const row = await settlementRow(db, roundId);
  const connection = connectionFor(env);
  if (row.commit_transaction_signature && row.commit_signed_transaction) {
    const signature = await resumeAutomaticTransaction(
      db,
      env,
      roundId,
      "commit",
    );
    return {
      signature,
      randomnessAccount: row.randomness_account,
    };
  }

  const randomnessSigner = await derivedSigner(
    authority,
    "switchboard-randomness",
    roundId,
  );
  if (randomnessSigner.publicKey.toBase58() !== row.randomness_account) {
    throw new Error("The deterministic randomness signer does not match.");
  }
  const { AnchorUtils, Randomness } =
    await import("@switchboard-xyz/on-demand/dist/cjs/index.js");
  const provider = new AnchorProvider(
    connection,
    new AutomationWallet(authority),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const program = await AnchorUtils.loadProgramFromProvider(
    provider,
    new PublicKey(SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID),
  );
  const queue = new PublicKey(SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS);
  const [randomness, createInstruction] = await Randomness.create(
    program,
    randomnessSigner,
    queue,
    authority.publicKey,
  );
  const commitInstruction = await randomness.commitIx(
    queue,
    authority.publicKey,
  );
  const lifetime = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: authority.publicKey,
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
  }).add(createInstruction, commitInstruction);
  transaction.sign(authority, randomnessSigner);
  const signature = legacySignature(transaction);
  const signedTransaction = transaction.serialize().toString("base64");
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = 'COMMITTING', commit_transaction_signature = ?,
         commit_signed_transaction = ?, commit_last_valid_block_height = ?,
         attempt_count = attempt_count + 1, last_error = NULL, updated_at = ?
       WHERE round_id = ? AND status = 'INITIALIZED'
         AND commit_transaction_signature IS NULL`,
    )
    .bind(
      signature,
      signedTransaction,
      String(lifetime.lastValidBlockHeight),
      now.toISOString(),
      roundId,
    )
    .run();
  const persisted = await settlementRow(db, roundId);
  const persistedSignature = requireText(
    persisted.commit_transaction_signature,
    "Commit transaction signature",
  );
  const persistedTransaction = requireText(
    persisted.commit_signed_transaction,
    "Signed commit transaction",
  );
  await sendPersistedTransaction(
    connection,
    persistedTransaction,
    persistedSignature,
  );
  return {
    signature: persistedSignature,
    randomnessAccount: persisted.randomness_account,
  };
}

export async function confirmAutomaticRandomnessCommit(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
  now = new Date(),
): Promise<{ signature: string; randomnessAccount: string }> {
  requireAuthority(env);
  await resumeAutomaticTransaction(db, env, roundId, "commit");
  const row = await settlementRow(db, roundId);
  const signature = requireText(
    row.commit_transaction_signature,
    "Commit transaction signature",
  );
  await assertConfirmed(
    connectionFor(env),
    signature,
    requireText(
      row.commit_last_valid_block_height,
      "Commit last valid block height",
    ),
  );
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = 'COMMITTED', last_error = NULL, updated_at = ?
       WHERE round_id = ? AND status IN ('COMMITTING', 'COMMITTED')`,
    )
    .bind(now.toISOString(), roundId)
    .run();
  return { signature, randomnessAccount: row.randomness_account };
}

export async function broadcastAutomaticRandomnessReveal(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
  now = new Date(),
): Promise<{ signature: string }> {
  const authority = requireAuthority(env);
  const row = await settlementRow(db, roundId);
  const connection = connectionFor(env);
  if (row.reveal_transaction_signature && row.reveal_signed_transaction) {
    return {
      signature: await resumeAutomaticTransaction(db, env, roundId, "reveal"),
    };
  }
  if (row.status !== "COMMITTED") {
    throw new Error("Switchboard randomness must be committed before reveal.");
  }
  const prepared = await prepareSwitchboardRandomnessReveal(
    automationClaimBindings(env),
    row.randomness_account,
  );
  const transaction = Transaction.from(
    Buffer.from(prepared.transaction, "base64"),
  );
  transaction.partialSign(authority);
  const signature = legacySignature(transaction);
  const signedTransaction = transaction.serialize().toString("base64");
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = 'REVEALING', reveal_transaction_signature = ?,
         reveal_signed_transaction = ?, reveal_last_valid_block_height = ?,
         attempt_count = attempt_count + 1, last_error = NULL, updated_at = ?
       WHERE round_id = ? AND status = 'COMMITTED'
         AND reveal_transaction_signature IS NULL`,
    )
    .bind(
      signature,
      signedTransaction,
      prepared.lastValidBlockHeight,
      now.toISOString(),
      roundId,
    )
    .run();
  const persisted = await settlementRow(db, roundId);
  await sendPersistedTransaction(
    connection,
    requireText(
      persisted.reveal_signed_transaction,
      "Signed reveal transaction",
    ),
    requireText(
      persisted.reveal_transaction_signature,
      "Reveal transaction signature",
    ),
  );
  return {
    signature: requireText(
      persisted.reveal_transaction_signature,
      "Reveal transaction signature",
    ),
  };
}

export async function confirmAutomaticRandomnessReveal(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
  now = new Date(),
): Promise<AutomaticRandomnessEvidence> {
  requireAuthority(env);
  await resumeAutomaticTransaction(db, env, roundId, "reveal");
  const row = await settlementRow(db, roundId);
  const revealSignature = requireText(
    row.reveal_transaction_signature,
    "Reveal transaction signature",
  );
  await assertConfirmed(
    connectionFor(env),
    revealSignature,
    requireText(
      row.reveal_last_valid_block_height,
      "Reveal last valid block height",
    ),
  );
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = 'REVEALED', last_error = NULL, updated_at = ?
       WHERE round_id = ? AND status IN ('REVEALING', 'REVEALED')`,
    )
    .bind(now.toISOString(), roundId)
    .run();
  return {
    roundId,
    randomnessAccount: row.randomness_account,
    commitTransactionSignature: requireText(
      row.commit_transaction_signature,
      "Commit transaction signature",
    ),
    revealTransactionSignature: revealSignature,
  };
}

async function verifiedDrawForEvidence(
  env: Partial<Env>,
  evidence: AutomaticRandomnessEvidence,
) {
  const randomnessValue = await verifiedSwitchboardRandomnessValue(
    automationClaimBindings(env),
    {
      randomnessAccount: evidence.randomnessAccount,
      randomnessCommitTransactionSignature: evidence.commitTransactionSignature,
      randomnessRevealTransactionSignature: evidence.revealTransactionSignature,
    },
  );
  const draw = await deriveVerifiedPrizeDrawWinners(
    env,
    evidence.roundId,
    randomnessValue,
  );
  return { randomnessValue, draw };
}

export async function broadcastAutomaticDistributionFunding(
  db: D1Database,
  env: Partial<Env>,
  evidence: AutomaticRandomnessEvidence,
  now = new Date(),
): Promise<{ signature: string; preparationId: string }> {
  const authority = requireAuthority(env);
  const row = await settlementRow(db, evidence.roundId);
  const connection = connectionFor(env);
  if (row.funding_transaction_signature && row.funding_signed_transaction) {
    const signature = await resumeAutomaticTransaction(
      db,
      env,
      evidence.roundId,
      "funding",
    );
    return {
      signature,
      preparationId: requireText(row.preparation_id, "Preparation ID"),
    };
  }
  if (row.status !== "REVEALED") {
    throw new Error("Randomness must be revealed before USDC funding.");
  }
  const { randomnessValue, draw } = await verifiedDrawForEvidence(
    env,
    evidence,
  );
  let preparation = await preparationForRound(db, evidence.roundId);
  let prepared: UsdcClaimDistributionPrepareResult;
  if (preparation) {
    prepared = preparationResult(preparation);
    if (
      prepared.manifest.seedAddress !== row.distribution_seed_address ||
      prepared.manifest.randomnessAccount !== evidence.randomnessAccount ||
      prepared.manifest.randomnessCommitTransactionSignature !==
        evidence.commitTransactionSignature ||
      prepared.manifest.randomnessRevealTransactionSignature !==
        evidence.revealTransactionSignature
    ) {
      throw new Error(
        "An existing claim preparation does not match automatic settlement.",
      );
    }
  } else {
    prepared = await prepareUsdcClaimDistribution(
      db,
      automationClaimBindings(env),
      {
        roundId: evidence.roundId,
        randomnessAccount: evidence.randomnessAccount,
        randomnessCommitTransactionSignature:
          evidence.commitTransactionSignature,
        randomnessRevealTransactionSignature:
          evidence.revealTransactionSignature,
        seedAddress: row.distribution_seed_address,
      },
      {
        grossPrizeAmountAtomic: await confirmedRoundFunding(
          db,
          evidence.roundId,
          authority.publicKey.toBase58(),
        ),
        winners: draw.winners,
        randomnessValue,
        algorithmVersion: draw.algorithmVersion,
      },
      "automation@walletor.com",
      `automatic-claim-prepare:${evidence.roundId}`,
      fetch,
      now,
    );
    preparation = await preparationForRound(db, evidence.roundId);
    if (!preparation) {
      throw new Error("The automatic claim preparation was not persisted.");
    }
  }
  const seedSigner = await derivedSigner(
    authority,
    "rewards-distribution",
    evidence.roundId,
  );
  if (seedSigner.publicKey.toBase58() !== row.distribution_seed_address) {
    throw new Error("The deterministic distribution signer does not match.");
  }
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(prepared.transaction, "base64"),
  );
  transaction.sign([authority, seedSigner]);
  const signature = versionedSignature(transaction);
  const signedTransaction = Buffer.from(transaction.serialize()).toString(
    "base64",
  );
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = 'FUNDING', preparation_id = ?,
         funding_transaction_signature = ?, funding_signed_transaction = ?,
         funding_last_valid_block_height = ?, attempt_count = attempt_count + 1,
         last_error = NULL, updated_at = ?
       WHERE round_id = ? AND status = 'REVEALED'
         AND funding_transaction_signature IS NULL`,
    )
    .bind(
      prepared.preparationId,
      signature,
      signedTransaction,
      prepared.lastValidBlockHeight,
      now.toISOString(),
      evidence.roundId,
    )
    .run();
  const persisted = await settlementRow(db, evidence.roundId);
  await sendPersistedTransaction(
    connection,
    requireText(
      persisted.funding_signed_transaction,
      "Signed funding transaction",
    ),
    requireText(
      persisted.funding_transaction_signature,
      "Funding transaction signature",
    ),
  );
  return {
    signature: requireText(
      persisted.funding_transaction_signature,
      "Funding transaction signature",
    ),
    preparationId: requireText(persisted.preparation_id, "Preparation ID"),
  };
}

export async function confirmAndStageAutomaticDistribution(
  db: D1Database,
  env: Partial<Env>,
  evidence: AutomaticRandomnessEvidence,
  now = new Date(),
): Promise<{ status: "STAGED" | "ACTIVE"; manifestChecksum: string }> {
  requireAuthority(env);
  await resumeAutomaticTransaction(db, env, evidence.roundId, "funding");
  const row = await settlementRow(db, evidence.roundId);
  const existingStatus = await distributionStatus(db, evidence.roundId);
  if (existingStatus) {
    const distribution = await db
      .prepare(
        "SELECT manifest_checksum FROM usdc_claim_distributions WHERE round_id = ?",
      )
      .bind(evidence.roundId)
      .first<{ manifest_checksum: string }>();
    if (!distribution) throw new Error("Claim distribution is unavailable.");
    return {
      status: existingStatus,
      manifestChecksum: distribution.manifest_checksum,
    };
  }
  const signature = requireText(
    row.funding_transaction_signature,
    "Funding transaction signature",
  );
  await assertConfirmed(
    connectionFor(env),
    signature,
    requireText(
      row.funding_last_valid_block_height,
      "Funding last valid block height",
    ),
  );
  const preparation = await preparationForRound(db, evidence.roundId);
  if (!preparation) throw new Error("The claim preparation is unavailable.");
  const prepared = preparationResult(preparation);
  const { draw } = await verifiedDrawForEvidence(env, evidence);
  const manifest: UsdcClaimDistributionManifest = {
    ...prepared.manifest,
    createTransactionSignature: signature,
  };
  const staged = await stageUsdcClaimDistribution(
    db,
    automationClaimBindings(env),
    prepared.preparationId,
    manifest,
    {
      roundId: evidence.roundId,
      grossPrizeAmountAtomic: await confirmedRoundFunding(
        db,
        evidence.roundId,
        row.authority_address,
      ),
      winners: draw.winners,
      algorithmVersion: draw.algorithmVersion,
    },
    "automation@walletor.com",
    `automatic-claim-stage:${evidence.roundId}`,
    fetch,
    now,
  );
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = ?, manifest_checksum = ?, distribution_address = ?,
         last_error = NULL, updated_at = ?
       WHERE round_id = ? AND status IN ('FUNDING', 'STAGED')`,
    )
    .bind(
      staged.status,
      staged.manifestChecksum,
      staged.distributionAddress,
      now.toISOString(),
      evidence.roundId,
    )
    .run();
  return { status: staged.status, manifestChecksum: staged.manifestChecksum };
}

export async function activateAutomaticDistribution(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
  manifestChecksum: string,
  now = new Date(),
): Promise<{ status: "ACTIVE"; distributionAddress: string }> {
  requireAuthority(env);
  const active = await activateUsdcClaimDistribution(
    db,
    automationClaimBindings(env),
    roundId,
    manifestChecksum,
    "automation@walletor.com",
    `automatic-claim-activate:${roundId}`,
    fetch,
    now,
  );
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET status = 'ACTIVE', manifest_checksum = ?, distribution_address = ?,
         last_error = NULL, updated_at = ?, completed_at = ?
       WHERE round_id = ? AND status != 'ACTIVE'`,
    )
    .bind(
      active.manifestChecksum,
      active.distributionAddress,
      now.toISOString(),
      now.toISOString(),
      roundId,
    )
    .run();
  return { status: "ACTIVE", distributionAddress: active.distributionAddress };
}

export async function recordAutomaticSettlementFailure(
  db: D1Database,
  roundId: string,
  error: unknown,
  now = new Date(),
): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown error";
  await db
    .prepare(
      `UPDATE automatic_claim_settlements
       SET last_error = ?, updated_at = ? WHERE round_id = ?`,
    )
    .bind(message.slice(0, 1_000), now.toISOString(), roundId)
    .run();
}

export async function listIncompleteAutomaticSettlements(
  db: D1Database,
  limit = 5,
): Promise<{ roundId: string; updatedAt: string }[]> {
  const rows = await db
    .prepare(
      `SELECT round_id, updated_at
       FROM automatic_claim_settlements
       WHERE status != 'ACTIVE'
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ round_id: string; updated_at: string }>();
  return rows.results.map((row) => ({
    roundId: row.round_id,
    updatedAt: row.updated_at,
  }));
}
