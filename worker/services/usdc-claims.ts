import { ed25519 } from "@noble/curves/ed25519";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

import {
  isHybridPrizeDraw,
  type PrizeDrawAlgorithmVersion,
} from "../../shared/prize-draw-contracts";
import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  USDC_CLAIM_FEE_BPS,
  USDC_DECIMALS,
  UsdcClaimBuildResultSchema,
  UsdcClaimConfirmResultSchema,
  UsdcClaimDistributionAdminResultSchema,
  UsdcClaimDistributionManifestDraftSchema,
  UsdcClaimDistributionManifestSchema,
  UsdcClaimDistributionPrepareResultSchema,
  UsdcClaimDistributionStageInputSchema,
  UsdcClaimEntitlementSchema,
  UsdcClaimStateSchema,
  type UsdcClaimBuildResult,
  type UsdcClaimConfirmResult,
  type UsdcClaimDistributionAdminResult,
  type UsdcClaimDistributionManifest,
  type UsdcClaimDistributionPrepareInput,
  type UsdcClaimDistributionPrepareResult,
  type UsdcClaimEntitlement,
  type UsdcClaimState,
} from "../../shared/usdc-claim-contracts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  REWARDS_PROGRAM_ID,
  SOLANA_REWARDS_SOURCE_REVISION,
  TOKEN_PROGRAM_ID,
  bytesToHex,
  buildUsdcMerkleAllocationBundle,
  createAssociatedTokenAccountIdempotentInstruction,
  createMerkleDistributionInstruction,
  createMerkleClaimInstruction,
  deriveAssociatedTokenAddress,
  deriveClaimAddress,
  parseMerkleClaimAmount,
  parseMerkleDistributionAccount,
  usdcClaimManifestChecksum,
  validateUsdcClaimManifest,
  type UsdcPayoutModel,
} from "../../shared/solana-foundation-rewards";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import {
  isMagicBlockRound,
  verifyMagicBlockRandomness,
} from "./magicblock-randomness";
import { REWARDS_AUTOMATION_ADDRESS } from "../../shared/treasury-setup-contracts";
import { ApiFailure } from "../lib/http";
import { readPublicLaunchAt } from "../lib/launch-config";
import { isSolanaAddress, isSolanaSignature } from "../lib/solana";
import {
  assertRewardsDeployment,
  REWARDS_MAINNET_DEPLOYMENT,
} from "./rewards-program-verification";

const RPC_TIMEOUT_MS = 12_000;
const MAX_RPC_RESPONSE_BYTES = 1_000_000;
const MAX_CLAIM_TRANSACTION_BYTES = 1_500;
const CLAIM_CONFIRMATION_ATTEMPTS = 5;
const CLAIM_CONFIRMATION_INTERVAL_MS = 300;
const MINIMUM_ACTIVATION_WINDOW_SECONDS = 7n * 24n * 60n * 60n;
const CLAIM_WINDOW_SECONDS = 30n * 24n * 60n * 60n;

type ClaimEnvironment = Omit<
  Partial<Env>,
  | "SOLANA_CLAIM_AUTHORITY_ADDRESS"
  | "USDC_DISTRIBUTION_FUNDING_ENABLED"
  | "SANCTIONS_SCREENING_ENABLED"
> & {
  SOLANA_CLAIM_AUTHORITY_ADDRESS?: string;
  USDC_DISTRIBUTION_FUNDING_ENABLED?: string;
  SANCTIONS_SCREENING_ENABLED?: string;
};
type Fetcher = typeof fetch;

function payoutModelForAlgorithm(
  algorithmVersion: PrizeDrawAlgorithmVersion,
): UsdcPayoutModel {
  return isHybridPrizeDraw(algorithmVersion) ? "HYBRID_20_10_70" : "EQUAL";
}

interface RpcAccount {
  data: Uint8Array;
  owner: string;
  executable: boolean;
}

interface ConfirmedTransactionEvidence {
  slot: bigint;
  accountKeys: string[];
  requiredSigners: string[];
  instructions: { programIdIndex: number; accountIndexes: number[] }[];
}

interface SwitchboardCommitRevealSlots {
  commitTransactionSlot: bigint;
  revealTransactionSlot: bigint;
  seedSlot: bigint;
  revealSlot: bigint;
}

interface DistributionRow {
  magicblock_evidence_json?: string | null;
  round_id: string;
  status: "STAGED" | "ACTIVE" | "CLOSED" | "FAILED";
  source_revision: string;
  prize_draw_algorithm_version: PrizeDrawAlgorithmVersion;
  randomness_account: string;
  randomness_value: string;
  randomness_commit_transaction_signature: string;
  randomness_reveal_transaction_signature: string;
  network: "MAINNET";
  provider: "SOLANA_FOUNDATION_REWARDS";
  program_id: string;
  mint_address: string;
  mint_symbol: "USDC";
  mint_decimals: 6;
  authority_address: string;
  seed_address: string;
  distribution_address: string;
  distribution_vault_address: string;
  merkle_root: string;
  gross_prize_amount_atomic: string;
  claim_fee_amount_atomic: string;
  net_distribution_amount_atomic: string;
  claim_fee_bps: 250;
  clawback_unix_timestamp: string;
  create_transaction_signature: string;
  manifest_checksum: string;
}

interface EntitlementRow {
  entitlement_id: string;
  round_id: string;
  winner_address: string;
  winner_rank: number;
  gross_amount_atomic: string;
  claim_fee_amount_atomic: string;
  net_amount_atomic: string;
  leaf_hash: string;
  proof_json: string;
  status: "PENDING" | "CLAIMABLE" | "CLAIMED" | "EXPIRED";
  claim_transaction_signature: string | null;
}

interface PreparationRow {
  round_id: string;
  preparation_id: string;
  status: "PREPARED" | "STAGED" | "EXPIRED";
  manifest_draft_json: string;
}

interface StagedDistributionRow {
  round_id: string;
  manifest_checksum: string;
}

export interface AutomaticClaimActivationSummary {
  attempted: number;
  activated: number;
  failed: number;
}

interface ActivePreparationRow extends PreparationRow {
  last_valid_block_height: string;
}

interface JoinedEntitlementRow
  extends EntitlementRow, Omit<DistributionRow, "status"> {
  distribution_status: DistributionRow["status"];
}

type SwitchboardEvidence = Pick<
  UsdcClaimDistributionManifest,
  | "randomnessAccount"
  | "randomnessValue"
  | "randomnessCommitTransactionSignature"
  | "randomnessRevealTransactionSignature"
>;

async function verifyRandomnessEvidence(
  env: ClaimEnvironment,
  evidence: SwitchboardEvidence & {
    roundId: string;
    magicblock?: UsdcClaimDistributionManifest["magicblock"];
  },
  config: ReturnType<typeof readUsdcClaimConfig>,
  fetcher: Fetcher,
): Promise<void> {
  if (evidence.magicblock) {
    await verifyMagicBlockRandomness(
      env,
      evidence,
      {
        magicblock: evidence.magicblock,
        randomnessValue: evidence.randomnessValue,
      },
      fetcher,
    );
  } else {
    if (isMagicBlockRound(env, evidence.roundId))
      throw new Error("This round requires MagicBlock evidence.");
    await verifySwitchboardRandomness(evidence, config, fetcher);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Solana returned invalid base64 account data.");
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readPublicKey(data: Uint8Array, offset: number): string {
  const bytes = data.slice(offset, offset + 32);
  if (bytes.byteLength !== 32) {
    throw new Error("Token account contains an invalid public key.");
  }
  return bs58.encode(bytes);
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(offset, true);
}

async function solanaRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetcher: Fetcher,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, RPC_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_UNAVAILABLE",
      error instanceof DOMException && error.name === "AbortError"
        ? "The Solana claim RPC timed out."
        : "The Solana claim RPC is unavailable.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RPC_RESPONSE_BYTES
  ) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_RESPONSE_TOO_LARGE",
      "The Solana claim RPC returned an oversized response.",
      true,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RPC_RESPONSE_BYTES) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_RESPONSE_TOO_LARGE",
      "The Solana claim RPC returned an oversized response.",
      true,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_INVALID_RESPONSE",
      "The Solana claim RPC returned invalid data.",
      true,
    );
  }
  if (!response.ok || !isRecord(payload) || isRecord(payload.error)) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_REJECTED",
      "The Solana claim RPC rejected the request.",
      true,
    );
  }
  return payload.result;
}

function parseRpcAccount(value: unknown): RpcAccount | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    typeof value.data[0] !== "string" ||
    value.data[1] !== "base64" ||
    typeof value.owner !== "string" ||
    typeof value.executable !== "boolean"
  ) {
    throw new Error("Solana returned an invalid account.");
  }
  return {
    data: decodeBase64(value.data[0]),
    owner: value.owner,
    executable: value.executable,
  };
}

async function getAccounts(
  rpcUrl: string,
  addresses: readonly string[],
  fetcher: Fetcher,
  commitment: "confirmed" | "finalized" = "confirmed",
): Promise<(RpcAccount | null)[]> {
  const result = await solanaRpc(
    rpcUrl,
    "getMultipleAccounts",
    [addresses, { commitment, encoding: "base64" }],
    fetcher,
  );
  if (
    !isRecord(result) ||
    !isRecord(result.context) ||
    !isUnknownArray(result.value) ||
    result.value.length !== addresses.length
  ) {
    throw new Error("Solana returned an incomplete account list.");
  }
  return result.value.map(parseRpcAccount);
}

async function confirmedBlockHeight(
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<bigint> {
  const result = await solanaRpc(
    rpcUrl,
    "getBlockHeight",
    [{ commitment: "confirmed" }],
    fetcher,
  );
  if (typeof result !== "number" || !Number.isSafeInteger(result)) {
    throw new ApiFailure(
      502,
      "SOLANA_BLOCK_HEIGHT_INVALID",
      "Solana returned an invalid block height.",
      true,
    );
  }
  return BigInt(result);
}

export function canExpireUnfundedClaimPreparation(input: {
  currentBlockHeight: bigint;
  lastValidBlockHeight: bigint;
  distributionExists: boolean;
}): boolean {
  return (
    input.currentBlockHeight > input.lastValidBlockHeight &&
    !input.distributionExists
  );
}

async function assertAuthorityUsdcBalance(
  config: ReturnType<typeof readUsdcClaimConfig>,
  requiredAmountAtomic: bigint,
  fetcher: Fetcher,
): Promise<void> {
  const authorityTokenAddress = deriveAssociatedTokenAddress(
    config.authorityAddress,
  ).toBase58();
  const [account] = await getAccounts(
    config.rpcUrl,
    [authorityTokenAddress],
    fetcher,
  );
  if (
    account?.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    account.executable ||
    account.data.byteLength < 72 ||
    readPublicKey(account.data, 0) !== SOLANA_MAINNET_USDC_MINT ||
    readPublicKey(account.data, 32) !== config.authorityAddress
  ) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_FUNDING_ACCOUNT_INVALID",
      "The claim authority does not have a valid mainnet USDC token account.",
      false,
    );
  }
  const availableAmountAtomic = readU64(account.data, 64);
  if (availableAmountAtomic < requiredAmountAtomic) {
    const formatUsdc = (amount: bigint) => {
      const whole = amount / 1_000_000n;
      const fraction = (amount % 1_000_000n)
        .toString()
        .padStart(6, "0")
        .replace(/0+$/, "");
      return fraction.length > 0
        ? `${whole.toString()}.${fraction}`
        : whole.toString();
    };
    throw new ApiFailure(
      409,
      "USDC_CLAIM_FUNDING_INSUFFICIENT",
      `Fund ${config.authorityAddress} with at least ${formatUsdc(requiredAmountAtomic)} USDC before preparing this distribution. Available: ${formatUsdc(availableAmountAtomic)} USDC.`,
      false,
    );
  }
}

async function expireUnfundedClaimPreparation(
  db: D1Database,
  config: ReturnType<typeof readUsdcClaimConfig>,
  preparation: ActivePreparationRow,
  actorEmail: string,
  requestId: string,
  fetcher: Fetcher,
  now: Date,
): Promise<void> {
  if (preparation.status !== "PREPARED") {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_PREPARATION_EXISTS",
      "This round already has an immutable claim preparation. Inspect its transaction on-chain before attempting any recovery.",
      false,
    );
  }
  const manifest = UsdcClaimDistributionManifestDraftSchema.parse(
    JSON.parse(preparation.manifest_draft_json),
  );
  const lastValidBlockHeight = BigInt(preparation.last_valid_block_height);
  const [currentBlockHeight, accounts] = await Promise.all([
    confirmedBlockHeight(config.rpcUrl, fetcher),
    getAccounts(config.rpcUrl, [manifest.distributionAddress], fetcher),
  ]);
  const distributionExists = accounts[0] !== null;
  if (
    !canExpireUnfundedClaimPreparation({
      currentBlockHeight,
      lastValidBlockHeight,
      distributionExists,
    })
  ) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_PREPARATION_EXISTS",
      distributionExists
        ? "This round already has an on-chain claim distribution. Verify and stage that transaction instead of preparing another."
        : "This round already has an unexpired claim preparation. Complete or inspect its transaction before retrying.",
      false,
    );
  }

  const timestamp = now.toISOString();
  const expirationReason =
    "Transaction lifetime expired without an on-chain distribution account.";
  const results = await db.batch([
    db
      .prepare(
        `UPDATE usdc_claim_preparations
         SET status = 'EXPIRED', expired_at = ?, expiration_reason = ?
         WHERE preparation_id = ? AND round_id = ? AND status = 'PREPARED'`,
      )
      .bind(
        timestamp,
        expirationReason,
        preparation.preparation_id,
        preparation.round_id,
      ),
    db
      .prepare(
        `INSERT INTO audit_logs (
          audit_log_id, request_id, round_id, chain_id, wallet_address,
          action, entity_type, entity_id, actor_type, details_json, created_at
        ) VALUES (?, ?, ?, 'solana-mainnet', NULL,
          'EXPIRE_USDC_CLAIM_PREPARATION', 'USDC_CLAIM_PREPARATION', ?,
          'ADMIN', ?, ?)`,
      )
      .bind(
        `usdc-claim-preparation-expired:${preparation.preparation_id}`,
        requestId,
        preparation.round_id,
        preparation.preparation_id,
        JSON.stringify({
          actorEmail,
          distributionAddress: manifest.distributionAddress,
          lastValidBlockHeight: lastValidBlockHeight.toString(),
          observedBlockHeight: currentBlockHeight.toString(),
          reason: expirationReason,
        }),
        timestamp,
      ),
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_PREPARATION_CONFLICT",
      "The claim preparation changed while recovery was being verified. Refresh before retrying.",
      false,
    );
  }
}

function proofFromJson(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!isUnknownArray(parsed)) {
    throw new Error("Stored USDC claim proof is invalid.");
  }
  const proof: string[] = [];
  for (const node of parsed) {
    if (typeof node !== "string" || !/^[a-f0-9]{64}$/.test(node)) {
      throw new Error("Stored USDC claim proof is invalid.");
    }
    proof.push(node);
  }
  return proof;
}

function entitlementId(roundId: string, winnerAddress: string): string {
  return `${roundId}:${winnerAddress}`;
}

function deadlineIso(unixTimestamp: string): string {
  const milliseconds = BigInt(unixTimestamp) * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Claim deadline is outside the supported date range.");
  }
  const date = new Date(Number(milliseconds));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Claim deadline is invalid.");
  }
  return date.toISOString();
}

async function assertConfirmedSignature(
  rpcUrl: string,
  signature: string,
  fetcher: Fetcher,
): Promise<void> {
  const result = await solanaRpc(
    rpcUrl,
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
    fetcher,
  );
  const value =
    isRecord(result) && isUnknownArray(result.value) ? result.value[0] : null;
  if (
    !isRecord(value) ||
    value.err !== null ||
    (value.confirmationStatus !== "confirmed" &&
      value.confirmationStatus !== "finalized")
  ) {
    throw new Error("The distribution creation transaction is not confirmed.");
  }
}

function parseStringArray(value: unknown, message: string): string[] {
  if (
    !isUnknownArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(message);
  }
  return value as string[];
}

async function confirmedTransactionEvidence(
  rpcUrl: string,
  signature: string,
  fetcher: Fetcher,
): Promise<ConfirmedTransactionEvidence> {
  const result = await solanaRpc(
    rpcUrl,
    "getTransaction",
    [
      signature,
      {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      },
    ],
    fetcher,
  );
  if (
    !isRecord(result) ||
    !Number.isSafeInteger(result.slot) ||
    !isRecord(result.meta) ||
    result.meta.err !== null ||
    !isRecord(result.transaction) ||
    !isRecord(result.transaction.message) ||
    !isRecord(result.transaction.message.header)
  ) {
    throw new Error("Solana did not return a confirmed transaction.");
  }
  const signatures = parseStringArray(
    result.transaction.signatures,
    "Solana returned invalid transaction signatures.",
  );
  if (signatures[0] !== signature) {
    throw new Error("Solana returned a different transaction signature.");
  }
  const accountKeys = parseStringArray(
    result.transaction.message.accountKeys,
    "Solana returned invalid transaction account keys.",
  );
  const requiredSignatureCount =
    result.transaction.message.header.numRequiredSignatures;
  if (
    !Number.isSafeInteger(requiredSignatureCount) ||
    typeof requiredSignatureCount !== "number" ||
    requiredSignatureCount < 1 ||
    requiredSignatureCount > accountKeys.length
  ) {
    throw new Error("Solana returned an invalid signer count.");
  }
  if (!isUnknownArray(result.transaction.message.instructions)) {
    throw new Error("Solana returned invalid transaction instructions.");
  }
  const instructions = result.transaction.message.instructions.map(
    (instruction) => {
      if (
        !isRecord(instruction) ||
        !Number.isSafeInteger(instruction.programIdIndex) ||
        typeof instruction.programIdIndex !== "number" ||
        !isUnknownArray(instruction.accounts) ||
        instruction.accounts.some(
          (index) => typeof index !== "number" || !Number.isSafeInteger(index),
        )
      ) {
        throw new Error("Solana returned an invalid compiled instruction.");
      }
      return {
        programIdIndex: instruction.programIdIndex,
        accountIndexes: instruction.accounts as number[],
      };
    },
  );
  return {
    slot: BigInt(result.slot as number),
    accountKeys,
    requiredSigners: accountKeys.slice(0, requiredSignatureCount),
    instructions,
  };
}

export function hasValidSwitchboardCommitRevealSlots({
  commitTransactionSlot,
  revealTransactionSlot,
  seedSlot,
  revealSlot,
}: SwitchboardCommitRevealSlots): boolean {
  // Switchboard commits the latest completed slot hash, so a successful
  // RandomnessCommit transaction is recorded exactly one slot after seedSlot.
  return (
    commitTransactionSlot === seedSlot + 1n &&
    revealTransactionSlot === revealSlot &&
    commitTransactionSlot < revealTransactionSlot
  );
}

async function verifySwitchboardRandomness(
  evidence: SwitchboardEvidence,
  config: ReturnType<typeof readUsdcClaimConfig>,
  fetcher: Fetcher,
): Promise<void> {
  if (
    evidence.randomnessCommitTransactionSignature ===
    evidence.randomnessRevealTransactionSignature
  ) {
    throw new Error("Switchboard commit and reveal transactions must differ.");
  }
  const [randomnessAccount] = await getAccounts(
    config.rpcUrl,
    [evidence.randomnessAccount],
    fetcher,
  );
  const expectedDiscriminator = Uint8Array.from([
    10, 66, 229, 135, 220, 239, 217, 114,
  ]);
  if (
    randomnessAccount?.owner !== config.switchboardProgramId ||
    randomnessAccount.executable ||
    randomnessAccount.data.byteLength !== 480 ||
    !sameBytes(randomnessAccount.data.slice(0, 8), expectedDiscriminator)
  ) {
    throw new Error(
      "The randomness account is not a current Switchboard account.",
    );
  }
  const authorityAddress = readPublicKey(randomnessAccount.data, 8);
  const queueAddress = readPublicKey(randomnessAccount.data, 40);
  const seedSlot = readU64(randomnessAccount.data, 104);
  const revealSlot = readU64(randomnessAccount.data, 144);
  const randomnessValue = randomnessAccount.data.slice(152, 184);
  if (
    authorityAddress !== config.authorityAddress ||
    queueAddress !== config.switchboardQueueAddress ||
    seedSlot === 0n ||
    revealSlot <= seedSlot ||
    randomnessValue.every((byte) => byte === 0) ||
    bytesToHex(randomnessValue) !== evidence.randomnessValue
  ) {
    throw new Error(
      "The revealed Switchboard randomness does not match Walletor.",
    );
  }
  const [commit, reveal] = await Promise.all([
    confirmedTransactionEvidence(
      config.rpcUrl,
      evidence.randomnessCommitTransactionSignature,
      fetcher,
    ),
    confirmedTransactionEvidence(
      config.rpcUrl,
      evidence.randomnessRevealTransactionSignature,
      fetcher,
    ),
  ]);
  const randomnessIndexIn = (transaction: ConfirmedTransactionEvidence) =>
    transaction.accountKeys.indexOf(evidence.randomnessAccount);
  const containsExpectedSwitchboardInstruction = (
    transaction: ConfirmedTransactionEvidence,
  ) => {
    const randomnessIndex = randomnessIndexIn(transaction);
    return (
      randomnessIndex >= 0 &&
      transaction.instructions.some(
        (instruction) =>
          transaction.accountKeys[instruction.programIdIndex] ===
            config.switchboardProgramId &&
          instruction.accountIndexes.includes(randomnessIndex),
      )
    );
  };
  if (
    !commit.requiredSigners.includes(config.authorityAddress) ||
    !reveal.requiredSigners.includes(config.authorityAddress) ||
    !containsExpectedSwitchboardInstruction(commit) ||
    !containsExpectedSwitchboardInstruction(reveal) ||
    !hasValidSwitchboardCommitRevealSlots({
      commitTransactionSlot: commit.slot,
      revealTransactionSlot: reveal.slot,
      seedSlot,
      revealSlot,
    })
  ) {
    throw new Error("Switchboard commit/reveal evidence is invalid.");
  }
}

export function matchesPreparedDistributionTransaction(
  preparedBytes: Uint8Array,
  confirmedBytes: Uint8Array,
  signature: string,
): boolean {
  const prepared = VersionedTransaction.deserialize(preparedBytes);
  const confirmed = VersionedTransaction.deserialize(confirmedBytes);
  return (
    bytesToHex(prepared.message.serialize()) ===
      bytesToHex(confirmed.message.serialize()) &&
    confirmed.signatures[0] !== undefined &&
    bs58.encode(confirmed.signatures[0]) === signature
  );
}

// Read-only discovery. The normal stage endpoint still verifies the snapshot,
// oracle proof, recipients, amounts, program, vault and creation transaction.
export async function recoverUsdcClaimDistribution(
  db: D1Database,
  env: ClaimEnvironment,
  roundId: string,
  fetcher: Fetcher = fetch,
) {
  const preparation = await db
    .prepare(
      "SELECT preparation_id, manifest_draft_json, unsigned_transaction FROM usdc_claim_preparations WHERE round_id = ? AND status IN ('PREPARED', 'STAGED')",
    )
    .bind(roundId)
    .first<{
      preparation_id: string;
      manifest_draft_json: string;
      unsigned_transaction: string;
    }>();
  if (!preparation)
    throw new ApiFailure(
      409,
      "USDC_RECOVERY_NO_PREPARATION",
      "No saved funding preparation exists for this round.",
      false,
    );
  const manifest = UsdcClaimDistributionManifestDraftSchema.parse(
    JSON.parse(preparation.manifest_draft_json),
  );
  const config = readUsdcClaimConfig(env);
  if (
    manifest.roundId !== roundId ||
    manifest.authorityAddress !== config.authorityAddress
  )
    throw new Error(
      "The saved distribution does not match the requested round and authority.",
    );
  const genesis = await solanaRpc(config.rpcUrl, "getGenesisHash", [], fetcher);
  if (genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")
    throw new Error("Distribution recovery requires Solana mainnet.");
  const signatures = await solanaRpc(
    config.rpcUrl,
    "getSignaturesForAddress",
    [manifest.distributionAddress, { limit: 100, commitment: "finalized" }],
    fetcher,
  );
  if (!Array.isArray(signatures))
    throw new Error("Solana returned invalid distribution history.");
  const preparedBytes = decodeBase64(preparation.unsigned_transaction);
  for (const item of signatures) {
    if (
      !isRecord(item) ||
      item.err !== null ||
      typeof item.signature !== "string" ||
      !isSolanaSignature(item.signature)
    )
      continue;
    const bytes = await confirmedTransactionBytes(
      config.rpcUrl,
      item.signature,
      fetcher,
    );
    if (
      bytes &&
      matchesPreparedDistributionTransaction(
        preparedBytes,
        bytes,
        item.signature,
      )
    ) {
      return UsdcClaimDistributionStageInputSchema.parse({
        preparationId: preparation.preparation_id,
        manifest: { ...manifest, createTransactionSignature: item.signature },
      });
    }
  }
  throw new ApiFailure(
    409,
    "USDC_RECOVERY_NOT_FINALIZED",
    "The original funding transaction is not yet available in finalized history. Retry recovery shortly; do not fund again.",
    true,
  );
}

export async function prepareUsdcClaimDistribution(
  db: D1Database,
  env: ClaimEnvironment,
  input: UsdcClaimDistributionPrepareInput,
  expected: {
    grossPrizeAmountAtomic: string;
    winners: readonly { rank: number; winnerAddress: string }[];
    randomnessValue: string;
    algorithmVersion: PrizeDrawAlgorithmVersion;
  },
  actorEmail: string,
  requestId: string,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<UsdcClaimDistributionPrepareResult> {
  const config = readUsdcClaimConfig(env);
  if (!config.fundingEnabled) {
    throw new ApiFailure(
      503,
      "USDC_DISTRIBUTION_FUNDING_DISABLED",
      "New USDC distribution funding is on hold pending claim-program verification. Existing funded winner claims remain available.",
      false,
    );
  }
  const genesis = await solanaRpc(config.rpcUrl, "getGenesisHash", [], fetcher);
  if (genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
    throw new ApiFailure(
      503,
      "USDC_CLAIM_NETWORK_MISMATCH",
      "The claim RPC is not Solana mainnet. New funding is paused.",
      false,
    );
  }
  const [program, programData] = await getAccounts(
    config.rpcUrl,
    [
      REWARDS_MAINNET_DEPLOYMENT.programAddress,
      REWARDS_MAINNET_DEPLOYMENT.programDataAddress,
    ],
    fetcher,
    "finalized",
  );
  await assertRewardsDeployment(
    program ?? null,
    programData ?? null,
    REWARDS_MAINNET_DEPLOYMENT,
  );
  const existing = await db
    .prepare("SELECT status FROM usdc_claim_distributions WHERE round_id = ?")
    .bind(input.roundId)
    .first<{ status: string }>();
  if (existing) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_DISTRIBUTION_EXISTS",
      `This round already has a ${existing.status.toLowerCase()} USDC distribution.`,
      false,
    );
  }
  const existingPreparation = await db
    .prepare(
      `SELECT round_id, preparation_id, status, manifest_draft_json,
        last_valid_block_height
       FROM usdc_claim_preparations
       WHERE round_id = ? AND status IN ('PREPARED', 'STAGED')`,
    )
    .bind(input.roundId)
    .first<ActivePreparationRow>();
  if (existingPreparation) {
    await expireUnfundedClaimPreparation(
      db,
      config,
      existingPreparation,
      actorEmail,
      requestId,
      fetcher,
      now,
    );
  }
  const grossPrizeAmountAtomic = BigInt(expected.grossPrizeAmountAtomic);
  const bundle = buildUsdcMerkleAllocationBundle(
    grossPrizeAmountAtomic,
    expected.winners,
    payoutModelForAlgorithm(expected.algorithmVersion),
  );
  await assertAuthorityUsdcBalance(
    config,
    BigInt(bundle.netDistributionAmountAtomic),
    fetcher,
  );
  const clawbackUnixTimestamp =
    BigInt(Math.floor(now.getTime() / 1_000)) + CLAIM_WINDOW_SECONDS;
  const distribution = createMerkleDistributionInstruction({
    payerAddress: config.authorityAddress,
    authorityAddress: config.authorityAddress,
    seedAddress: input.seedAddress,
    merkleRoot: bundle.merkleRoot,
    netDistributionAmountAtomic: BigInt(bundle.netDistributionAmountAtomic),
    clawbackUnixTimestamp,
  });
  const magicblockProof = isMagicBlockRound(env, input.roundId)
    ? await verifyMagicBlockRandomness(env, input, undefined, fetcher)
    : null;
  const evidence = {
    ...(magicblockProof ? { magicblock: magicblockProof.magicblock } : {}),
    randomnessAccount: input.randomnessAccount,
    randomnessValue: expected.randomnessValue,
    randomnessCommitTransactionSignature:
      input.randomnessCommitTransactionSignature,
    randomnessRevealTransactionSignature:
      input.randomnessRevealTransactionSignature,
  };
  try {
    await verifyRandomnessEvidence(
      env,
      { ...evidence, roundId: input.roundId },
      config,
      fetcher,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "switchboard_randomness_verification_failed",
        roundId: input.roundId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "SWITCHBOARD_RANDOMNESS_INVALID",
      "The draw's randomness evidence could not be verified.",
      false,
    );
  }
  const manifest = UsdcClaimDistributionManifestDraftSchema.parse({
    version: 1,
    roundId: input.roundId,
    sourceRevision: SOLANA_REWARDS_SOURCE_REVISION,
    prizeDrawAlgorithmVersion: expected.algorithmVersion,
    ...evidence,
    network: "MAINNET",
    provider: "SOLANA_FOUNDATION_REWARDS",
    programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    mintAddress: SOLANA_MAINNET_USDC_MINT,
    mintSymbol: "USDC",
    mintDecimals: USDC_DECIMALS,
    authorityAddress: config.authorityAddress,
    seedAddress: input.seedAddress,
    distributionAddress: distribution.distributionAddress,
    distributionVaultAddress: distribution.distributionVaultAddress,
    merkleRoot: bundle.merkleRoot,
    grossPrizeAmountAtomic: bundle.grossPrizeAmountAtomic,
    claimFeeAmountAtomic: bundle.claimFeeAmountAtomic,
    netDistributionAmountAtomic: bundle.netDistributionAmountAtomic,
    claimFeeBps: USDC_CLAIM_FEE_BPS,
    clawbackUnixTimestamp: clawbackUnixTimestamp.toString(),
    entitlements: bundle.entitlements,
  });
  const lifetime = await latestBlockhash(config.rpcUrl, fetcher);
  const message = new TransactionMessage({
    payerKey: new PublicKey(config.authorityAddress),
    recentBlockhash: lifetime.blockhash,
    instructions: [distribution.instruction],
  }).compileToV0Message();
  if (
    message.header.numRequiredSignatures !== 2 ||
    message.staticAccountKeys[0]?.toBase58() !== config.authorityAddress ||
    !message.staticAccountKeys
      .slice(0, message.header.numRequiredSignatures)
      .some((key) => key.toBase58() === input.seedAddress)
  ) {
    throw new Error("The USDC distribution signer set is invalid.");
  }
  const transaction = new VersionedTransaction(message).serialize();
  if (transaction.byteLength > 1_232) {
    throw new Error("The USDC distribution transaction exceeds Solana limits.");
  }
  const result = UsdcClaimDistributionPrepareResultSchema.parse({
    preparationId: crypto.randomUUID(),
    network: "MAINNET",
    transaction: encodeBase64(transaction),
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: lifetime.lastValidBlockHeight.toString(),
    manifest,
  });
  try {
    await db
      .prepare(
        `INSERT INTO usdc_claim_preparations (
          round_id, preparation_id, status, manifest_draft_json,
          unsigned_transaction, blockhash, last_valid_block_height,
          prepared_at, prepared_by, request_id, staged_at,
          expired_at, expiration_reason
        ) VALUES (?, ?, 'PREPARED', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(
        input.roundId,
        result.preparationId,
        JSON.stringify(result.manifest),
        result.transaction,
        result.blockhash,
        result.lastValidBlockHeight,
        now.toISOString(),
        actorEmail,
        requestId,
      )
      .run();
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "usdc_claim_preparation_reservation_failed",
        roundId: input.roundId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "USDC_CLAIM_PREPARATION_CONFLICT",
      "This round could not be reserved for funding. Inspect existing launch activity before retrying.",
      false,
    );
  }
  return result;
}

export async function verifiedSwitchboardRandomnessValue(
  env: ClaimEnvironment,
  input: Pick<
    UsdcClaimDistributionPrepareInput,
    | "randomnessAccount"
    | "randomnessCommitTransactionSignature"
    | "randomnessRevealTransactionSignature"
  >,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const config = readUsdcClaimConfig(env);
  const [randomnessAccount] = await getAccounts(
    config.rpcUrl,
    [input.randomnessAccount],
    fetcher,
  );
  if (!randomnessAccount || randomnessAccount.data.byteLength < 184) {
    throw new ApiFailure(
      409,
      "SWITCHBOARD_RANDOMNESS_UNAVAILABLE",
      "The revealed Switchboard randomness account is unavailable.",
      false,
    );
  }
  const randomnessValue = bytesToHex(randomnessAccount.data.slice(152, 184));
  try {
    await verifySwitchboardRandomness(
      { ...input, randomnessValue },
      config,
      fetcher,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "switchboard_randomness_verification_failed",
        randomnessAccount: input.randomnessAccount,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "SWITCHBOARD_RANDOMNESS_INVALID",
      "The Switchboard commit/reveal evidence could not be verified.",
      false,
    );
  }
  return randomnessValue;
}

export async function verifiedPrizeRandomnessValue(
  env: ClaimEnvironment,
  input: UsdcClaimDistributionPrepareInput,
  fetcher: Fetcher = fetch,
): Promise<string> {
  if (isMagicBlockRound(env, input.roundId)) {
    return (await verifyMagicBlockRandomness(env, input, undefined, fetcher))
      .randomnessValue;
  }
  return verifiedSwitchboardRandomnessValue(env, input, fetcher);
}

async function verifyDistributionOnchain(
  manifest: UsdcClaimDistributionManifest,
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<void> {
  await assertConfirmedSignature(
    rpcUrl,
    manifest.createTransactionSignature,
    fetcher,
  );
  const [programAccount, distributionAccount, vaultAccount, mintAccount] =
    await getAccounts(
      rpcUrl,
      [
        manifest.programId,
        manifest.distributionAddress,
        manifest.distributionVaultAddress,
        manifest.mintAddress,
      ],
      fetcher,
    );
  if (!programAccount?.executable) {
    throw new Error("The Solana Foundation Rewards program is not executable.");
  }
  if (
    distributionAccount?.owner !== manifest.programId ||
    distributionAccount.executable
  ) {
    throw new Error("The Merkle distribution account is invalid.");
  }
  const distribution = parseMerkleDistributionAccount(distributionAccount.data);
  if (
    distribution.authorityAddress !== manifest.authorityAddress ||
    distribution.mintAddress !== manifest.mintAddress ||
    distribution.seedAddress !== manifest.seedAddress ||
    distribution.merkleRoot !== manifest.merkleRoot ||
    distribution.totalAmountAtomic !==
      BigInt(manifest.netDistributionAmountAtomic) ||
    distribution.clawbackUnixTimestamp !==
      BigInt(manifest.clawbackUnixTimestamp) ||
    distribution.revocable !== 0
  ) {
    throw new Error("The on-chain distribution does not match its manifest.");
  }
  if (
    mintAccount?.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    mintAccount.executable
  ) {
    throw new Error("The distribution mint is not mainnet SPL USDC.");
  }
  if (
    vaultAccount?.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    vaultAccount.executable ||
    vaultAccount.data.byteLength < 72 ||
    readPublicKey(vaultAccount.data, 0) !== SOLANA_MAINNET_USDC_MINT ||
    readPublicKey(vaultAccount.data, 32) !== manifest.distributionAddress
  ) {
    throw new Error("The distribution vault is not the expected USDC account.");
  }
  const vaultAmount = readU64(vaultAccount.data, 64);
  if (
    vaultAmount + distribution.totalClaimedAtomic !==
    distribution.totalAmountAtomic
  ) {
    throw new Error("The on-chain USDC vault does not reconcile.");
  }
}

function adminResult(
  manifest: UsdcClaimDistributionManifest,
  status: "STAGED" | "ACTIVE",
  checksum: string,
): UsdcClaimDistributionAdminResult {
  return UsdcClaimDistributionAdminResultSchema.parse({
    roundId: manifest.roundId,
    status,
    manifestChecksum: checksum,
    distributionAddress: manifest.distributionAddress,
    netDistributionAmountAtomic: manifest.netDistributionAmountAtomic,
    entitlementCount: manifest.entitlements.length,
  });
}

export async function stageUsdcClaimDistribution(
  db: D1Database,
  env: ClaimEnvironment,
  preparationId: string,
  rawManifest: unknown,
  expected: {
    roundId: string;
    grossPrizeAmountAtomic: string;
    winners: readonly { rank: number; winnerAddress: string }[];
    algorithmVersion: PrizeDrawAlgorithmVersion;
  },
  actorEmail: string,
  requestId: string,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<UsdcClaimDistributionAdminResult> {
  const manifest = UsdcClaimDistributionManifestSchema.parse(rawManifest);
  const config = readUsdcClaimConfig(env);
  validateUsdcClaimManifest(manifest);
  const preparation = await db
    .prepare(
      `SELECT round_id, preparation_id, status, manifest_draft_json
       FROM usdc_claim_preparations WHERE preparation_id = ? AND round_id = ?`,
    )
    .bind(preparationId, manifest.roundId)
    .first<PreparationRow>();
  if (!preparation || preparation.status === "EXPIRED") {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_PREPARATION_INVALID",
      "The claim distribution does not have a matching active preparation.",
      false,
    );
  }
  const manifestDraft =
    UsdcClaimDistributionManifestDraftSchema.parse(manifest);
  if (JSON.stringify(manifestDraft) !== preparation.manifest_draft_json) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_PREPARATION_CHANGED",
      "The funded claim manifest differs from its immutable preparation.",
      false,
    );
  }
  if (
    manifest.sourceRevision !== SOLANA_REWARDS_SOURCE_REVISION ||
    manifest.authorityAddress !== config.authorityAddress ||
    manifest.roundId !== expected.roundId ||
    manifest.grossPrizeAmountAtomic !== expected.grossPrizeAmountAtomic ||
    manifest.prizeDrawAlgorithmVersion !== expected.algorithmVersion
  ) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_MANIFEST_MISMATCH",
      "The USDC claim manifest does not match Walletor's locked draw.",
      false,
    );
  }
  const expectedWinners = [...expected.winners].sort(
    (left, right) => left.rank - right.rank,
  );
  const actualWinners = [...manifest.entitlements]
    .sort((left, right) => left.rank - right.rank)
    .map(({ rank, winnerAddress }) => ({ rank, winnerAddress }));
  if (JSON.stringify(actualWinners) !== JSON.stringify(expectedWinners)) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_WINNERS_MISMATCH",
      "The USDC claim recipients do not match the verified draw result.",
      false,
    );
  }
  const expectedBundle = buildUsdcMerkleAllocationBundle(
    BigInt(expected.grossPrizeAmountAtomic),
    expected.winners,
    payoutModelForAlgorithm(expected.algorithmVersion),
  );
  const expectedAmounts = expectedBundle.entitlements.map(
    ({
      rank,
      winnerAddress,
      grossAmountAtomic,
      claimFeeAmountAtomic,
      netAmountAtomic,
    }) => ({
      rank,
      winnerAddress,
      grossAmountAtomic,
      claimFeeAmountAtomic,
      netAmountAtomic,
    }),
  );
  const actualAmounts = [...manifest.entitlements]
    .sort((left, right) => left.rank - right.rank)
    .map(
      ({
        rank,
        winnerAddress,
        grossAmountAtomic,
        claimFeeAmountAtomic,
        netAmountAtomic,
      }) => ({
        rank,
        winnerAddress,
        grossAmountAtomic,
        claimFeeAmountAtomic,
        netAmountAtomic,
      }),
    );
  if (JSON.stringify(actualAmounts) !== JSON.stringify(expectedAmounts)) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_AMOUNTS_MISMATCH",
      "The USDC claim amounts do not match Walletor's locked payout policy.",
      false,
    );
  }
  if (
    BigInt(manifest.clawbackUnixTimestamp) <=
    BigInt(Math.floor(now.getTime() / 1_000))
  ) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_DEADLINE_INVALID",
      "The USDC claim deadline must be in the future.",
      false,
    );
  }
  try {
    await verifyRandomnessEvidence(env, manifest, config, fetcher);
    await verifyDistributionOnchain(manifest, config.rpcUrl, fetcher);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "usdc_claim_distribution_verification_failed",
        roundId: manifest.roundId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "USDC_CLAIM_DISTRIBUTION_INVALID",
      "The funded on-chain USDC distribution could not be verified.",
      false,
    );
  }
  const checksum = await usdcClaimManifestChecksum(manifest);
  const existing = await db
    .prepare(
      "SELECT manifest_checksum, status FROM usdc_claim_distributions WHERE round_id = ?",
    )
    .bind(manifest.roundId)
    .first<{ manifest_checksum: string; status: string }>();
  if (existing) {
    if (existing.manifest_checksum !== checksum) {
      throw new ApiFailure(
        409,
        "USDC_CLAIM_DISTRIBUTION_EXISTS",
        "This round already has a different immutable claim distribution.",
        false,
      );
    }
    return adminResult(
      manifest,
      existing.status === "ACTIVE" ? "ACTIVE" : "STAGED",
      checksum,
    );
  }
  const timestamp = now.toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO usdc_claim_distributions (
          round_id, status, source_revision, prize_draw_algorithm_version, magicblock_evidence_json,
          randomness_account, randomness_value,
          randomness_commit_transaction_signature,
          randomness_reveal_transaction_signature, network, provider,
          program_id, mint_address, mint_symbol, mint_decimals,
          authority_address, seed_address, distribution_address,
          distribution_vault_address, merkle_root,
          gross_prize_amount_atomic, claim_fee_amount_atomic,
          net_distribution_amount_atomic, claim_fee_bps,
          clawback_unix_timestamp, create_transaction_signature,
          manifest_checksum, staged_at, staged_by,
          activated_at, activated_by, failure_reason
        ) VALUES (?, 'STAGED', ?, ?, ?, ?, ?, ?, ?, 'MAINNET',
          'SOLANA_FOUNDATION_REWARDS', ?, ?, 'USDC', 6, ?, ?, ?, ?, ?,
          ?, ?, ?, 250, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(
        manifest.roundId,
        manifest.sourceRevision,
        manifest.prizeDrawAlgorithmVersion,
        manifest.magicblock ? JSON.stringify(manifest.magicblock) : null,
        manifest.randomnessAccount,
        manifest.randomnessValue,
        manifest.randomnessCommitTransactionSignature,
        manifest.randomnessRevealTransactionSignature,
        manifest.programId,
        manifest.mintAddress,
        manifest.authorityAddress,
        manifest.seedAddress,
        manifest.distributionAddress,
        manifest.distributionVaultAddress,
        manifest.merkleRoot,
        manifest.grossPrizeAmountAtomic,
        manifest.claimFeeAmountAtomic,
        manifest.netDistributionAmountAtomic,
        manifest.clawbackUnixTimestamp,
        manifest.createTransactionSignature,
        checksum,
        timestamp,
        actorEmail,
      ),
    ...manifest.entitlements.map((entitlement) =>
      db
        .prepare(
          `INSERT INTO usdc_claim_entitlements (
            entitlement_id, round_id, winner_address, winner_rank,
            gross_amount_atomic, claim_fee_amount_atomic, net_amount_atomic,
            leaf_hash, proof_json, status, claim_transaction_signature,
            claimed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, ?)`,
        )
        .bind(
          entitlementId(manifest.roundId, entitlement.winnerAddress),
          manifest.roundId,
          entitlement.winnerAddress,
          entitlement.rank,
          entitlement.grossAmountAtomic,
          entitlement.claimFeeAmountAtomic,
          entitlement.netAmountAtomic,
          entitlement.leafHash,
          JSON.stringify(entitlement.proof),
          timestamp,
          timestamp,
        ),
    ),
    db
      .prepare(
        `UPDATE usdc_claim_preparations
         SET status = 'STAGED', staged_at = ?
         WHERE preparation_id = ? AND round_id = ? AND status = 'PREPARED'`,
      )
      .bind(timestamp, preparationId, manifest.roundId),
    db
      .prepare(
        `INSERT INTO audit_logs (
          audit_log_id, request_id, round_id, chain_id, wallet_address,
          action, entity_type, entity_id, actor_type, details_json, created_at
        ) VALUES (?, ?, ?, 'solana-mainnet', NULL,
          'STAGE_USDC_CLAIM_DISTRIBUTION', 'USDC_CLAIM_DISTRIBUTION', ?,
          'ADMIN', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        requestId,
        manifest.roundId,
        manifest.distributionAddress,
        JSON.stringify({ actorEmail, manifestChecksum: checksum }),
        timestamp,
      ),
  ];
  await db.batch(statements);
  return adminResult(manifest, "STAGED", checksum);
}

async function distributionManifest(
  db: D1Database,
  roundId: string,
): Promise<{
  manifest: UsdcClaimDistributionManifest;
  checksum: string;
  status: DistributionRow["status"];
}> {
  const distribution = await db
    .prepare("SELECT * FROM usdc_claim_distributions WHERE round_id = ?")
    .bind(roundId)
    .first<DistributionRow>();
  if (!distribution) {
    throw new ApiFailure(
      404,
      "USDC_CLAIM_DISTRIBUTION_NOT_FOUND",
      "This USDC claim distribution was not found.",
      false,
    );
  }
  const entitlements = await db
    .prepare(
      "SELECT * FROM usdc_claim_entitlements WHERE round_id = ? ORDER BY winner_rank",
    )
    .bind(roundId)
    .all<EntitlementRow>();
  const manifest = UsdcClaimDistributionManifestSchema.parse({
    ...(distribution.magicblock_evidence_json
      ? {
          magicblock: JSON.parse(
            distribution.magicblock_evidence_json,
          ) as unknown,
        }
      : {}),
    version: 1,
    roundId: distribution.round_id,
    sourceRevision: distribution.source_revision,
    prizeDrawAlgorithmVersion: distribution.prize_draw_algorithm_version,
    randomnessAccount: distribution.randomness_account,
    randomnessValue: distribution.randomness_value,
    randomnessCommitTransactionSignature:
      distribution.randomness_commit_transaction_signature,
    randomnessRevealTransactionSignature:
      distribution.randomness_reveal_transaction_signature,
    network: distribution.network,
    provider: distribution.provider,
    programId: distribution.program_id,
    mintAddress: distribution.mint_address,
    mintSymbol: distribution.mint_symbol,
    mintDecimals: distribution.mint_decimals,
    authorityAddress: distribution.authority_address,
    seedAddress: distribution.seed_address,
    distributionAddress: distribution.distribution_address,
    distributionVaultAddress: distribution.distribution_vault_address,
    merkleRoot: distribution.merkle_root,
    grossPrizeAmountAtomic: distribution.gross_prize_amount_atomic,
    claimFeeAmountAtomic: distribution.claim_fee_amount_atomic,
    netDistributionAmountAtomic: distribution.net_distribution_amount_atomic,
    claimFeeBps: distribution.claim_fee_bps,
    clawbackUnixTimestamp: distribution.clawback_unix_timestamp,
    createTransactionSignature: distribution.create_transaction_signature,
    entitlements: entitlements.results.map((entitlement) => ({
      winnerAddress: entitlement.winner_address,
      rank: entitlement.winner_rank,
      grossAmountAtomic: entitlement.gross_amount_atomic,
      claimFeeAmountAtomic: entitlement.claim_fee_amount_atomic,
      netAmountAtomic: entitlement.net_amount_atomic,
      leafHash: entitlement.leaf_hash,
      proof: proofFromJson(entitlement.proof_json),
    })),
  });
  return {
    manifest,
    checksum: distribution.manifest_checksum,
    status: distribution.status,
  };
}

export async function activateUsdcClaimDistribution(
  db: D1Database,
  env: ClaimEnvironment,
  roundId: string,
  manifestChecksum: string,
  actorEmail: string,
  requestId: string,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<UsdcClaimDistributionAdminResult> {
  const config = readUsdcClaimConfig(env);
  if (!config.executionEnabled) {
    throw new ApiFailure(
      503,
      "USDC_CLAIMS_DISABLED",
      "Mainnet USDC claims cannot be activated while PAYOUTS_ENABLED is false.",
      false,
    );
  }
  const stored = await distributionManifest(db, roundId);
  if (stored.checksum !== manifestChecksum) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_MANIFEST_CHANGED",
      "The staged manifest checksum does not match this activation request.",
      false,
    );
  }
  if (stored.status === "ACTIVE") {
    return adminResult(stored.manifest, "ACTIVE", stored.checksum);
  }
  if (stored.status !== "STAGED") {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_DISTRIBUTION_NOT_STAGED",
      "Only a staged USDC claim distribution can be activated.",
      false,
    );
  }
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1_000));
  if (
    BigInt(stored.manifest.clawbackUnixTimestamp) - nowSeconds <
    MINIMUM_ACTIVATION_WINDOW_SECONDS
  ) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_WINDOW_TOO_SHORT",
      "A claim distribution needs at least seven days remaining before clawback.",
      false,
    );
  }
  try {
    validateUsdcClaimManifest(stored.manifest);
    if (
      ![
        config.authorityAddress,
        REWARDS_AUTOMATION_ADDRESS,
        "9JaZ9rCJG9w87GegKLAExgzDKcYpMVsg5roimCu5VeUR",
      ].includes(stored.manifest.authorityAddress)
    ) {
      throw new Error("Stored distribution authority is not approved.");
    }
    await verifyRandomnessEvidence(
      env,
      stored.manifest,
      {
        ...config,
        authorityAddress: stored.manifest.authorityAddress,
      },
      fetcher,
    );
    await verifyDistributionOnchain(stored.manifest, config.rpcUrl, fetcher);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "usdc_claim_activation_verification_failed",
        roundId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "USDC_CLAIM_DISTRIBUTION_INVALID",
      "The on-chain USDC distribution failed activation checks.",
      false,
    );
  }
  const timestamp = now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE usdc_claim_distributions
         SET status = 'ACTIVE', activated_at = ?, activated_by = ?
         WHERE round_id = ? AND status = 'STAGED' AND manifest_checksum = ?`,
      )
      .bind(timestamp, actorEmail, roundId, manifestChecksum),
    db
      .prepare(
        `UPDATE usdc_claim_entitlements SET status = 'CLAIMABLE', updated_at = ?
         WHERE round_id = ? AND status = 'PENDING'`,
      )
      .bind(timestamp, roundId),
    db
      .prepare(
        `INSERT INTO audit_logs (
          audit_log_id, request_id, round_id, chain_id, wallet_address,
          action, entity_type, entity_id, actor_type, details_json, created_at
        ) VALUES (?, ?, ?, 'solana-mainnet', NULL,
          'ACTIVATE_USDC_CLAIM_DISTRIBUTION', 'USDC_CLAIM_DISTRIBUTION', ?,
          'ADMIN', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        requestId,
        roundId,
        stored.manifest.distributionAddress,
        JSON.stringify({ actorEmail, manifestChecksum }),
        timestamp,
      ),
  ]);
  return adminResult(stored.manifest, "ACTIVE", stored.checksum);
}

export async function activateStagedUsdcClaimDistributions(
  db: D1Database,
  env: ClaimEnvironment,
  limit = 10,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<AutomaticClaimActivationSummary> {
  const staged = await db
    .prepare(
      `SELECT round_id, manifest_checksum
       FROM usdc_claim_distributions
       WHERE status = 'STAGED'
       ORDER BY staged_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<StagedDistributionRow>();
  let activated = 0;
  let failed = 0;
  for (const distribution of staged.results) {
    try {
      await activateUsdcClaimDistribution(
        db,
        env,
        distribution.round_id,
        distribution.manifest_checksum,
        "automation@walletor.com",
        `automatic-claim-activation:${crypto.randomUUID()}`,
        fetcher,
        now,
      );
      activated += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          message: "automatic_claim_activation_failed",
          roundId: distribution.round_id,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  }
  return {
    attempted: staged.results.length,
    activated,
    failed,
  };
}

function joinedEntitlementQuery(where: string): string {
  return `SELECT e.*,
    d.source_revision, d.prize_draw_algorithm_version,
    d.randomness_account, d.randomness_value,
    d.randomness_commit_transaction_signature,
    d.randomness_reveal_transaction_signature,
    d.network, d.provider, d.program_id, d.mint_address, d.mint_symbol,
    d.mint_decimals, d.authority_address, d.seed_address,
    d.distribution_address, d.distribution_vault_address, d.merkle_root,
    d.gross_prize_amount_atomic, d.claim_fee_amount_atomic,
    d.net_distribution_amount_atomic, d.claim_fee_bps,
    d.clawback_unix_timestamp, d.create_transaction_signature,
    d.manifest_checksum, d.status AS distribution_status
    FROM usdc_claim_entitlements AS e
    INNER JOIN usdc_claim_distributions AS d ON d.round_id = e.round_id
    WHERE ${where}`;
}

export function launchEntitlementFilter(
  env: ClaimEnvironment,
  where: string,
): { where: string; launchAt: string | null } {
  const launchAt = readPublicLaunchAt(env);
  return {
    where: launchAt === null ? where : `${where} AND d.staged_at >= ?`,
    launchAt,
  };
}

async function claimedAmounts(
  rows: readonly JoinedEntitlementRow[],
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<bigint[]> {
  if (rows.length === 0) return [];
  const addresses = rows.map((row) =>
    deriveClaimAddress(
      row.distribution_address,
      row.winner_address,
    )[0].toBase58(),
  );
  const accounts = await getAccounts(rpcUrl, addresses, fetcher);
  return accounts.map((account) => {
    if (account === null) return 0n;
    if (account.owner !== SOLANA_FOUNDATION_REWARDS_PROGRAM_ID) {
      throw new Error("A Merkle claim account has the wrong owner.");
    }
    return parseMerkleClaimAmount(account.data);
  });
}

function publicEntitlement(
  row: JoinedEntitlementRow,
  claimedAmountAtomic: bigint,
  now: Date,
): UsdcClaimEntitlement {
  const net = BigInt(row.net_amount_atomic);
  if (claimedAmountAtomic > net) {
    throw new Error("On-chain claimed amount exceeds the allocation.");
  }
  const deadline = deadlineIso(row.clawback_unix_timestamp);
  const remaining = net - claimedAmountAtomic;
  const status =
    remaining === 0n
      ? "CLAIMED"
      : Date.parse(deadline) <= now.getTime()
        ? "EXPIRED"
        : "CLAIMABLE";
  return UsdcClaimEntitlementSchema.parse({
    entitlementId: row.entitlement_id,
    roundId: row.round_id,
    winnerAddress: row.winner_address,
    rank: row.winner_rank,
    provider: "SOLANA_FOUNDATION_REWARDS",
    distributionAddress: row.distribution_address,
    distributionVaultAddress: row.distribution_vault_address,
    claimAccountAddress: deriveClaimAddress(
      row.distribution_address,
      row.winner_address,
    )[0].toBase58(),
    mintAddress: SOLANA_MAINNET_USDC_MINT,
    mintSymbol: "USDC",
    mintDecimals: USDC_DECIMALS,
    grossAmountAtomic: row.gross_amount_atomic,
    claimFeeAmountAtomic: row.claim_fee_amount_atomic,
    netAmountAtomic: row.net_amount_atomic,
    claimedAmountAtomic: claimedAmountAtomic.toString(),
    remainingAmountAtomic: remaining.toString(),
    claimFeeBps: USDC_CLAIM_FEE_BPS,
    claimDeadline: deadline,
    status,
    transactionSignature: row.claim_transaction_signature,
  });
}

function disabledClaimState(walletAddress: string, now: Date): UsdcClaimState {
  return UsdcClaimStateSchema.parse({
    availability: "DISABLED",
    network: "MAINNET",
    walletAddress,
    programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    settlementAsset: {
      mintAddress: SOLANA_MAINNET_USDC_MINT,
      symbol: "USDC",
      decimals: USDC_DECIMALS,
    },
    claimFeeBps: USDC_CLAIM_FEE_BPS,
    entitlements: [],
    serverTime: now.toISOString(),
  });
}

export async function getUsdcClaimState(
  env: ClaimEnvironment,
  walletAddress: string,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<UsdcClaimState> {
  if (!isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Connect a valid Solana wallet to review claims.",
      false,
    );
  }
  const config = readUsdcClaimConfig(env);
  if (!config.executionEnabled) return disabledClaimState(walletAddress, now);
  if (!env.DB) {
    throw new ApiFailure(
      503,
      "USDC_CLAIM_DATABASE_UNAVAILABLE",
      "USDC claim records are temporarily unavailable.",
      true,
    );
  }
  const launchFilter = launchEntitlementFilter(
    env,
    "e.winner_address = ? AND d.status = 'ACTIVE'",
  );
  const statement = env.DB.prepare(
    `${joinedEntitlementQuery(launchFilter.where)}
     ORDER BY d.clawback_unix_timestamp, e.winner_rank LIMIT 100`,
  );
  const result = await (
    launchFilter.launchAt === null
      ? statement.bind(walletAddress)
      : statement.bind(walletAddress, launchFilter.launchAt)
  ).all<JoinedEntitlementRow>();
  try {
    const claimed = await claimedAmounts(
      result.results,
      config.rpcUrl,
      fetcher,
    );
    return UsdcClaimStateSchema.parse({
      availability: "MAINNET_LIVE",
      network: "MAINNET",
      walletAddress,
      programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
      settlementAsset: {
        mintAddress: SOLANA_MAINNET_USDC_MINT,
        symbol: "USDC",
        decimals: USDC_DECIMALS,
      },
      claimFeeBps: USDC_CLAIM_FEE_BPS,
      entitlements: result.results.map((row, index) =>
        publicEntitlement(row, claimed[index] ?? 0n, now),
      ),
      serverTime: now.toISOString(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "usdc_claim_state_verification_failed",
        walletAddress,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      502,
      "USDC_CLAIM_STATE_INVALID",
      "Walletor could not verify the on-chain USDC claim state.",
      true,
    );
  }
}

async function activeEntitlementRow(
  env: ClaimEnvironment & { DB: D1Database },
  walletAddress: string,
  requestedEntitlementId: string,
): Promise<JoinedEntitlementRow> {
  const launchFilter = launchEntitlementFilter(
    env,
    "e.entitlement_id = ? AND e.winner_address = ? AND d.status = 'ACTIVE'",
  );
  const statement = env.DB.prepare(joinedEntitlementQuery(launchFilter.where));
  const row = await (
    launchFilter.launchAt === null
      ? statement.bind(requestedEntitlementId, walletAddress)
      : statement.bind(
          requestedEntitlementId,
          walletAddress,
          launchFilter.launchAt,
        )
  ).first<JoinedEntitlementRow>();
  if (!row) {
    throw new ApiFailure(
      404,
      "USDC_CLAIM_NOT_FOUND",
      "No active USDC winnings were found for this wallet.",
      false,
    );
  }
  return row;
}

async function latestBlockhash(
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
  const result = await solanaRpc(
    rpcUrl,
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
    fetcher,
  );
  if (
    !isRecord(result) ||
    !isRecord(result.value) ||
    typeof result.value.blockhash !== "string" ||
    typeof result.value.lastValidBlockHeight !== "number" ||
    !Number.isSafeInteger(result.value.lastValidBlockHeight)
  ) {
    throw new ApiFailure(
      502,
      "SOLANA_BLOCKHASH_INVALID",
      "Solana returned an invalid transaction lifetime.",
      true,
    );
  }
  return {
    blockhash: result.value.blockhash,
    lastValidBlockHeight: BigInt(result.value.lastValidBlockHeight),
  };
}

export async function buildUsdcClaimTransaction(
  env: ClaimEnvironment,
  walletAddress: string,
  requestedEntitlementId: string,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<UsdcClaimBuildResult> {
  if (!isSolanaAddress(walletAddress) || requestedEntitlementId.length > 240) {
    throw new ApiFailure(
      400,
      "INVALID_USDC_CLAIM",
      "The USDC claim request is invalid.",
      false,
    );
  }
  const config = readUsdcClaimConfig(env);
  if (!config.executionEnabled) {
    throw new ApiFailure(
      503,
      "USDC_CLAIMS_DISABLED",
      "Mainnet USDC claims are not enabled yet.",
      false,
    );
  }
  if (!env.DB) {
    throw new ApiFailure(
      503,
      "USDC_CLAIM_DATABASE_UNAVAILABLE",
      "USDC claim records are temporarily unavailable.",
      true,
    );
  }
  const row = await activeEntitlementRow(
    { ...env, DB: env.DB },
    walletAddress,
    requestedEntitlementId,
  );
  const stored = await distributionManifest(env.DB, row.round_id);
  try {
    validateUsdcClaimManifest(stored.manifest);
    await verifyDistributionOnchain(stored.manifest, config.rpcUrl, fetcher);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "usdc_claim_build_distribution_invalid",
        entitlementId: requestedEntitlementId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "USDC_CLAIM_DISTRIBUTION_INVALID",
      "The funded USDC claim distribution could not be verified.",
      false,
    );
  }
  const [claimed] = await claimedAmounts([row], config.rpcUrl, fetcher);
  const entitlement = publicEntitlement(row, claimed ?? 0n, now);
  if (entitlement.status === "CLAIMED") {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_ALREADY_COMPLETED",
      "These USDC winnings have already been claimed.",
      false,
    );
  }
  if (entitlement.status === "EXPIRED") {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_EXPIRED",
      "The claim window for these USDC winnings has closed.",
      false,
    );
  }
  const proof = proofFromJson(row.proof_json);
  const lifetime = await latestBlockhash(config.rpcUrl, fetcher);
  const instructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      walletAddress,
      walletAddress,
    ),
    createMerkleClaimInstruction({
      distributionAddress: row.distribution_address,
      distributionVaultAddress: row.distribution_vault_address,
      winnerAddress: walletAddress,
      netAmountAtomic: BigInt(row.net_amount_atomic),
      proof,
    }),
  ];
  const message = new TransactionMessage({
    payerKey: new PublicKey(walletAddress),
    recentBlockhash: lifetime.blockhash,
    instructions,
  }).compileToV0Message();
  // The ATA helper's first key is always the claimant/payer. Avoid accepting
  // any caller-controlled payer supplied outside the validated wallet address.
  if (message.staticAccountKeys[0]?.toBase58() !== walletAddress) {
    throw new Error("USDC claim transaction payer is invalid.");
  }
  const transaction = new VersionedTransaction(message).serialize();
  if (transaction.byteLength > MAX_CLAIM_TRANSACTION_BYTES) {
    throw new ApiFailure(
      409,
      "USDC_CLAIM_TRANSACTION_TOO_LARGE",
      "This USDC claim proof does not fit in a Solana transaction.",
      false,
    );
  }
  return UsdcClaimBuildResultSchema.parse({
    network: "MAINNET",
    transaction: encodeBase64(transaction),
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: lifetime.lastValidBlockHeight.toString(),
    entitlement,
  });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

export function validateConfirmedClaimTransaction(
  transactionBytes: Uint8Array,
  signature: string,
  row: Pick<
    JoinedEntitlementRow,
    | "winner_address"
    | "proof_json"
    | "distribution_address"
    | "distribution_vault_address"
    | "net_amount_atomic"
  >,
): void {
  const transaction = VersionedTransaction.deserialize(transactionBytes);
  if (
    transaction.message.header.numRequiredSignatures !== 1 ||
    transaction.message.addressTableLookups.length !== 0 ||
    transaction.message.staticAccountKeys[0]?.toBase58() !==
      row.winner_address ||
    transaction.signatures.length !== 1 ||
    bs58.encode(transaction.signatures[0] ?? new Uint8Array()) !== signature ||
    !ed25519.verify(
      transaction.signatures[0] ?? new Uint8Array(),
      transaction.message.serialize(),
      bs58.decode(row.winner_address),
    )
  ) {
    throw new Error("The confirmed transaction is not signed by the winner.");
  }
  const proof = proofFromJson(row.proof_json);
  const expectedInstructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      row.winner_address,
      row.winner_address,
    ),
    createMerkleClaimInstruction({
      distributionAddress: row.distribution_address,
      distributionVaultAddress: row.distribution_vault_address,
      winnerAddress: row.winner_address,
      netAmountAtomic: BigInt(row.net_amount_atomic),
      proof,
    }),
  ];
  // Phantom augments signed transactions with compute-budget instructions and
  // Lighthouse assertions. Only these known additions may accompany the exact
  // ATA + Merkle claim sequence; other programs and duplicate claims still fail.
  const claimInstructions = transaction.message.compiledInstructions.filter(
    (instruction) => {
      const program =
        transaction.message.staticAccountKeys[
          instruction.programIdIndex
        ]?.toBase58();
      if (program === "ComputeBudget111111111111111111111111111111") {
        if (instruction.accountKeyIndexes.length !== 0)
          throw new Error("Invalid compute budget accounts.");
        return false;
      }
      return program !== "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
    },
  );
  if (claimInstructions.length !== expectedInstructions.length) {
    throw new Error("The confirmed claim contains unexpected instructions.");
  }
  expectedInstructions.forEach((expected, index) => {
    const compiled = claimInstructions[index];
    if (!compiled) throw new Error("The confirmed claim is incomplete.");
    const program =
      transaction.message.staticAccountKeys[compiled.programIdIndex];
    const accounts = Array.from(compiled.accountKeyIndexes, (accountIndex) =>
      transaction.message.staticAccountKeys[accountIndex]?.toBase58(),
    );
    if (
      program?.toBase58() !== expected.programId.toBase58() ||
      !sameBytes(compiled.data, expected.data) ||
      accounts.length !== expected.keys.length ||
      accounts.some(
        (address, accountIndex) =>
          address !== expected.keys[accountIndex]?.pubkey.toBase58(),
      )
    ) {
      throw new Error(
        "The confirmed transaction does not match the USDC claim.",
      );
    }
  });
}

async function confirmedTransactionBytes(
  rpcUrl: string,
  signature: string,
  fetcher: Fetcher,
): Promise<Uint8Array | null> {
  const result = await solanaRpc(
    rpcUrl,
    "getTransaction",
    [
      signature,
      {
        commitment: "confirmed",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      },
    ],
    fetcher,
  );
  if (result === null) return null;
  if (
    !isRecord(result) ||
    !isRecord(result.meta) ||
    result.meta.err !== null ||
    !Array.isArray(result.transaction) ||
    typeof result.transaction[0] !== "string" ||
    result.transaction[1] !== "base64"
  ) {
    throw new Error("Solana returned an invalid or failed claim transaction.");
  }
  return decodeBase64(result.transaction[0]);
}

async function waitForConfirmedTransaction(
  rpcUrl: string,
  signature: string,
  fetcher: Fetcher,
): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < CLAIM_CONFIRMATION_ATTEMPTS; attempt += 1) {
    const transaction = await confirmedTransactionBytes(
      rpcUrl,
      signature,
      fetcher,
    );
    if (transaction) return transaction;
    if (attempt < CLAIM_CONFIRMATION_ATTEMPTS - 1) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, CLAIM_CONFIRMATION_INTERVAL_MS),
      );
    }
  }
  return null;
}

export async function confirmUsdcClaimTransaction(
  env: ClaimEnvironment,
  input: {
    walletAddress: string;
    entitlementId: string;
    transactionSignature: string;
  },
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<UsdcClaimConfirmResult> {
  if (
    !isSolanaAddress(input.walletAddress) ||
    !isSolanaSignature(input.transactionSignature) ||
    input.entitlementId.length > 240
  ) {
    throw new ApiFailure(
      400,
      "INVALID_USDC_CLAIM",
      "The USDC claim confirmation is invalid.",
      false,
    );
  }
  const config = readUsdcClaimConfig(env);
  if (!config.executionEnabled || !env.DB) {
    throw new ApiFailure(
      503,
      "USDC_CLAIMS_DISABLED",
      "Mainnet USDC claims are not enabled yet.",
      false,
    );
  }
  const row = await activeEntitlementRow(
    { ...env, DB: env.DB },
    input.walletAddress,
    input.entitlementId,
  );
  let transactionBytes: Uint8Array | null;
  try {
    transactionBytes = await waitForConfirmedTransaction(
      config.rpcUrl,
      input.transactionSignature,
      fetcher,
    );
    if (transactionBytes === null) {
      return UsdcClaimConfirmResultSchema.parse({
        network: "MAINNET",
        transactionSignature: input.transactionSignature,
        status: "SUBMITTED",
      });
    }
    validateConfirmedClaimTransaction(
      transactionBytes,
      input.transactionSignature,
      row,
    );
    const [claimed] = await claimedAmounts([row], config.rpcUrl, fetcher);
    if ((claimed ?? 0n) > BigInt(row.net_amount_atomic)) {
      throw new Error("The on-chain claimed amount exceeds this entitlement.");
    }
    if ((claimed ?? 0n) !== BigInt(row.net_amount_atomic)) {
      return UsdcClaimConfirmResultSchema.parse({
        network: "MAINNET",
        transactionSignature: input.transactionSignature,
        status: "SUBMITTED",
      });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "usdc_claim_confirmation_failed",
        entitlementId: input.entitlementId,
        transactionSignature: input.transactionSignature,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      409,
      "USDC_CLAIM_CONFIRMATION_INVALID",
      "Solana did not confirm the expected Walletor USDC claim.",
      false,
    );
  }
  const timestamp = now.toISOString();
  await env.DB.prepare(
    `UPDATE usdc_claim_entitlements
     SET status = 'CLAIMED', claim_transaction_signature = ?,
       claimed_at = ?, updated_at = ?
     WHERE entitlement_id = ? AND winner_address = ?
       AND status IN ('CLAIMABLE', 'CLAIMED')
       AND (claim_transaction_signature IS NULL OR claim_transaction_signature = ?)`,
  )
    .bind(
      input.transactionSignature,
      timestamp,
      timestamp,
      input.entitlementId,
      input.walletAddress,
      input.transactionSignature,
    )
    .run();
  return UsdcClaimConfirmResultSchema.parse({
    network: "MAINNET",
    transactionSignature: input.transactionSignature,
    status: "CONFIRMED",
  });
}

export const usdcClaimProgramAddresses = {
  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  rewardsProgram: REWARDS_PROGRAM_ID.toBase58(),
  tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
  usdcMint: SOLANA_MAINNET_USDC_MINT,
} as const;

export const usdcClaimDebug = {
  bytesToHex,
  deriveAssociatedTokenAddress,
};
