import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

import {
  SolanaClaimBuildResultSchema,
  SolanaClaimStateSchema,
  SolanaClaimSubmitResultSchema,
  type SolanaClaimBuildResult,
  type SolanaClaimEntitlement,
  type SolanaClaimState,
  type SolanaClaimSubmitResult,
} from "../../shared/solana-claim-contracts";
import { readSolanaClaimConfig } from "../accounting/solana-claims";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress, isSolanaSignature } from "../lib/solana";

const CLAIM_DISCRIMINATOR = Uint8Array.from([
  62, 198, 214, 193, 213, 159, 108, 210,
]);
const WINNER_DISCRIMINATOR = Uint8Array.from([
  126, 74, 200, 186, 228, 1, 36, 23,
]);
const ROUND_DISCRIMINATOR = Uint8Array.from([
  87, 127, 165, 51, 73, 78, 116, 174,
]);
const CONFIG_DISCRIMINATOR = Uint8Array.from([
  155, 12, 170, 224, 30, 250, 204, 130,
]);
const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
const COMPUTE_BUDGET_PROGRAM_ADDRESS =
  "ComputeBudget111111111111111111111111111111";
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const WINNER_ACCOUNT_SIZE = 112;
const ROUND_ACCOUNT_SIZE_V2 = 318;
const ROUND_ACCOUNT_SIZE_V3 = 358;
const CONFIG_ACCOUNT_SIZE = 139;
const WINNER_WALLET_OFFSET = 40;
const RPC_TIMEOUT_MS = 12_000;
const MAX_RPC_RESPONSE_BYTES = 500_000;
const MAX_SIGNED_TRANSACTION_BYTES = 2_000;
const MAX_STATIC_ACCOUNTS = 32;
const MAX_TRANSACTION_INSTRUCTIONS = 3;
const MAX_INSTRUCTION_ACCOUNTS = 16;
const MAX_INSTRUCTION_DATA_BYTES = 128;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_PRIORITY_FEE_LAMPORTS = 500_000n;
const CLAIM_CONFIRMATION_ATTEMPTS = 8;
const CLAIM_CONFIRMATION_INTERVAL_MS = 350;

type ClaimEnvironment = Parameters<typeof readSolanaClaimConfig>[0];
type Fetcher = typeof fetch;

interface RpcAccount {
  data: Uint8Array;
  owner: string;
  executable: boolean;
}

interface ParsedWinner {
  address: string;
  roundAddress: string;
  walletAddress: string;
  rank: number;
  grossLamports: bigint;
  claimFeeLamports: bigint;
  netLamports: bigint;
  claimed: boolean;
}

interface ParsedRound {
  address: string;
  status: number;
  feeRecipient: string;
  claimDeadline: string | null;
}

interface ParsedConfig {
  authorityAddress: string;
  coordinatorAddress: string;
  feeRecipientAddress: string;
  switchboardProgramId: string;
  paused: boolean;
}

interface ParsedTransactionInstruction {
  programAddress: string | undefined;
  instructionAccounts: (string | undefined)[];
  instructionData: Uint8Array;
}

interface ParsedClaimTransaction {
  signature: Uint8Array;
  message: Uint8Array;
  recentBlockhash: string;
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
  staticAccountKeys: string[];
  instructions: ParsedTransactionInstruction[];
  addressTableLookupCount: number;
}

class ByteCursor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readByte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new Error("Transaction ended unexpectedly.");
    this.offset += 1;
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("Transaction contains an invalid byte length.");
    }
    const end = this.offset + length;
    if (end > this.bytes.byteLength) {
      throw new Error("Transaction ended unexpectedly.");
    }
    const value = this.bytes.slice(this.offset, end);
    this.offset = end;
    return value;
  }

  readShortVector(maximum: number): number {
    let value = 0;
    for (let index = 0; index < 3; index += 1) {
      const byte = this.readByte();
      value |= (byte & 0x7f) << (index * 7);
      if ((byte & 0x80) === 0) {
        if (index > 0 && byte === 0) {
          throw new Error(
            "Transaction contains a non-canonical compact length.",
          );
        }
        if (value > maximum) {
          throw new Error("Transaction vector exceeds its allowed size.");
        }
        return value;
      }
    }
    throw new Error("Transaction contains an invalid compact length.");
  }

  atEnd(): boolean {
    return this.offset === this.bytes.byteLength;
  }

  position(): number {
    return this.offset;
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function signedTransactionBytesFromBase64(value: string): Uint8Array {
  try {
    return decodeBase64(value);
  } catch {
    throw new ApiFailure(
      400,
      "INVALID_CLAIM_TRANSACTION",
      "The signed claim transaction is not valid base64.",
      false,
    );
  }
}

function base64FromBytes(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameBytes(left: Uint8Array, right: Uint8Array, offset = 0): boolean {
  if (left.byteLength - offset < right.byteLength) return false;
  return right.every((byte, index) => left[offset + index] === byte);
}

function concatenateBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function encodeShortVector(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("Solana compact vector length is invalid.");
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(bytes);
}

function publicKeyBytes(address: string): Uint8Array {
  const decoded = bs58.decode(address);
  if (decoded.byteLength !== 32) {
    throw new Error("Solana public key must be exactly 32 bytes.");
  }
  return decoded;
}

function readPublicKey(bytes: Uint8Array, offset: number): string {
  const value = bytes.slice(offset, offset + 32);
  if (value.byteLength !== 32) {
    throw new Error("Solana account contains an invalid public key.");
  }
  return bs58.encode(value);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, true);
}

function readI64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigInt64(offset, true);
}

function unixTimestampToIso(value: bigint): string {
  const milliseconds = value * 1_000n;
  if (
    milliseconds < BigInt(-8_640_000_000_000_000) ||
    milliseconds > BigInt(8_640_000_000_000_000)
  ) {
    throw new Error("Solana round contains an invalid claim deadline.");
  }
  return new Date(Number(milliseconds)).toISOString();
}

async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(new ArrayBuffer(value.byteLength));
  input.set(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
}

function isOnEd25519Curve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

async function findProgramAddress(
  seeds: Uint8Array[],
  programAddress: string,
): Promise<string> {
  if (seeds.length > 15 || seeds.some((seed) => seed.byteLength > 32)) {
    throw new Error("Walletor PDA seeds are invalid.");
  }
  const programBytes = publicKeyBytes(programAddress);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const digest = await sha256Bytes(
      concatenateBytes(...seeds, Uint8Array.of(bump), programBytes, PDA_MARKER),
    );
    if (!isOnEd25519Curve(digest)) return bs58.encode(digest);
  }
  throw new Error("Walletor could not derive the claim PDA.");
}

function parseRpcAccount(value: unknown): RpcAccount | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Solana returned an invalid account.");
  const data = value.data;
  if (
    !Array.isArray(data) ||
    typeof data[0] !== "string" ||
    data[1] !== "base64" ||
    typeof value.owner !== "string" ||
    typeof value.executable !== "boolean"
  ) {
    throw new Error("Solana returned an invalid account encoding.");
  }
  return {
    data: decodeBase64(data[0]),
    owner: value.owner,
    executable: value.executable,
  };
}

function parseConfigAccount(
  account: RpcAccount,
  programId: string,
): ParsedConfig {
  if (
    account.owner !== programId ||
    account.executable ||
    account.data.byteLength !== CONFIG_ACCOUNT_SIZE ||
    !sameBytes(account.data, CONFIG_DISCRIMINATOR) ||
    account.data[8] !== 1
  ) {
    throw new Error("Solana returned an invalid Walletor config account.");
  }
  const paused = account.data[137];
  if (paused !== 0 && paused !== 1) {
    throw new Error("Solana returned an invalid Walletor pause state.");
  }
  return {
    authorityAddress: readPublicKey(account.data, 9),
    coordinatorAddress: readPublicKey(account.data, 41),
    feeRecipientAddress: readPublicKey(account.data, 73),
    switchboardProgramId: readPublicKey(account.data, 105),
    paused: paused === 1,
  };
}

async function solanaRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetcher: Fetcher,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    throw new ApiFailure(
      504,
      "SOLANA_CLAIM_RPC_TIMEOUT",
      "Solana did not respond in time. Try again.",
      true,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RPC_RESPONSE_BYTES
  ) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_RESPONSE_TOO_LARGE",
      "Solana returned an unexpectedly large response.",
      true,
    );
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RPC_RESPONSE_BYTES) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_RESPONSE_TOO_LARGE",
      "Solana returned an unexpectedly large response.",
      true,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_INVALID_RESPONSE",
      "Solana returned an unreadable response.",
      true,
    );
  }
  if (!response.ok || !isRecord(parsed) || "error" in parsed) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_RPC_REJECTED",
      "Solana could not process the claim request.",
      true,
    );
  }
  return parsed.result;
}

async function verifyMainnetClaimDeployment(
  config: ReturnType<typeof readSolanaClaimConfig>,
  fetcher: Fetcher,
): Promise<void> {
  if (
    config.network !== "MAINNET" ||
    config.authorityAddress === null ||
    config.coordinatorAddress === null ||
    config.feeRecipientAddress === null
  ) {
    return;
  }
  const configAddress = await findProgramAddress(
    [new TextEncoder().encode("config")],
    config.programId,
  );
  const result = await solanaRpc(
    config.rpcUrl,
    "getMultipleAccounts",
    [
      [config.programId, configAddress],
      { commitment: "finalized", encoding: "base64" },
    ],
    fetcher,
  );
  if (
    !isRecord(result) ||
    !isRecord(result.context) ||
    !Array.isArray(result.value) ||
    result.value.length !== 2
  ) {
    throw new Error("Solana returned an invalid Walletor deployment state.");
  }
  const program = parseRpcAccount(result.value[0]);
  const rawConfig = parseRpcAccount(result.value[1]);
  if (!program || !program.executable || !rawConfig) {
    throw new Error("The Walletor mainnet claim program is not deployed.");
  }
  const onchainConfig = parseConfigAccount(rawConfig, config.programId);
  if (
    onchainConfig.authorityAddress !== config.authorityAddress ||
    onchainConfig.coordinatorAddress !== config.coordinatorAddress ||
    onchainConfig.feeRecipientAddress !== config.feeRecipientAddress ||
    onchainConfig.switchboardProgramId !== config.switchboardProgramId ||
    onchainConfig.paused
  ) {
    throw new Error(
      "The Walletor mainnet claim configuration does not match the approved launch configuration.",
    );
  }
}

type ClaimConfirmationStatus = "CONFIRMED" | "FAILED" | "PENDING";

function parseClaimConfirmationStatus(value: unknown): ClaimConfirmationStatus {
  if (!isRecord(value) || !Array.isArray(value.value)) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_STATUS_INVALID",
      "Solana returned an unreadable claim status.",
      true,
    );
  }
  const status: unknown = value.value[0];
  if (status === null || status === undefined) return "PENDING";
  if (!isRecord(status) || !("err" in status)) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_STATUS_INVALID",
      "Solana returned an unreadable claim status.",
      true,
    );
  }
  if (status.err !== null) return "FAILED";
  if (status.confirmationStatus === "finalized") {
    return "CONFIRMED";
  }
  if (
    status.confirmationStatus === "confirmed" ||
    status.confirmationStatus === "processed" ||
    status.confirmationStatus === null
  ) {
    return "PENDING";
  }
  throw new ApiFailure(
    502,
    "SOLANA_CLAIM_STATUS_INVALID",
    "Solana returned an unreadable claim status.",
    true,
  );
}

async function waitForClaimConfirmation(
  rpcUrl: string,
  signature: string,
  fetcher: Fetcher,
): Promise<"CONFIRMED" | "SUBMITTED"> {
  for (let attempt = 0; attempt < CLAIM_CONFIRMATION_ATTEMPTS; attempt += 1) {
    let rpcStatus: unknown;
    try {
      rpcStatus = await solanaRpc(
        rpcUrl,
        "getSignatureStatuses",
        [[signature], { searchTransactionHistory: false }],
        fetcher,
      );
    } catch {
      console.warn(
        JSON.stringify({ message: "solana_claim_confirmation_unavailable" }),
      );
      return "SUBMITTED";
    }
    const status = parseClaimConfirmationStatus(rpcStatus);
    if (status === "CONFIRMED") return "CONFIRMED";
    if (status === "FAILED") {
      throw new ApiFailure(
        409,
        "SOLANA_CLAIM_TRANSACTION_FAILED",
        "Solana rejected the claim transaction. Try building a new claim.",
        true,
      );
    }
    if (attempt + 1 < CLAIM_CONFIRMATION_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CLAIM_CONFIRMATION_INTERVAL_MS);
      });
    }
  }
  return "SUBMITTED";
}

function parseWinnerAccount(
  address: string,
  account: RpcAccount,
  programId: string,
): ParsedWinner {
  if (
    account.owner !== programId ||
    account.executable ||
    account.data.byteLength !== WINNER_ACCOUNT_SIZE ||
    !sameBytes(account.data, WINNER_DISCRIMINATOR)
  ) {
    throw new Error("Solana returned an invalid Walletor winner account.");
  }
  return {
    address,
    roundAddress: readPublicKey(account.data, 8),
    walletAddress: readPublicKey(account.data, 40),
    rank: readU16(account.data, 72),
    grossLamports: readU64(account.data, 86),
    claimFeeLamports: readU64(account.data, 94),
    netLamports: readU64(account.data, 102),
    claimed: account.data[110] === 1,
  };
}

function parseRoundAccount(
  address: string,
  account: RpcAccount,
  programId: string,
): ParsedRound {
  if (
    account.owner !== programId ||
    account.executable ||
    (account.data.byteLength !== ROUND_ACCOUNT_SIZE_V2 &&
      account.data.byteLength !== ROUND_ACCOUNT_SIZE_V3) ||
    !sameBytes(account.data, ROUND_DISCRIMINATOR)
  ) {
    throw new Error("Solana returned an invalid Walletor round account.");
  }
  return {
    address,
    status: account.data[73] ?? -1,
    feeRecipient: readPublicKey(account.data, 162),
    claimDeadline:
      account.data.byteLength === ROUND_ACCOUNT_SIZE_V3
        ? unixTimestampToIso(readI64(account.data, 318))
        : null,
  };
}

function claimableRoundStatus(status: number): boolean {
  return status === 4 || status === 5;
}

async function readWinnerAccounts(
  walletAddress: string,
  programId: string,
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<ParsedWinner[]> {
  const result = await solanaRpc(
    rpcUrl,
    "getProgramAccounts",
    [
      programId,
      {
        commitment: "finalized",
        encoding: "base64",
        filters: [
          { dataSize: WINNER_ACCOUNT_SIZE },
          { memcmp: { offset: WINNER_WALLET_OFFSET, bytes: walletAddress } },
        ],
      },
    ],
    fetcher,
  );
  if (!Array.isArray(result)) {
    throw new Error("Solana returned an invalid winner account list.");
  }
  return result.map((item) => {
    if (!isRecord(item) || typeof item.pubkey !== "string") {
      throw new Error("Solana returned an invalid winner account entry.");
    }
    const account = parseRpcAccount(item.account);
    if (!account) throw new Error("Solana returned an empty winner account.");
    const winner = parseWinnerAccount(item.pubkey, account, programId);
    if (winner.walletAddress !== walletAddress) {
      throw new Error("Solana winner lookup returned a different wallet.");
    }
    return winner;
  });
}

async function readRoundAccounts(
  roundAddresses: string[],
  programId: string,
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<Map<string, ParsedRound>> {
  if (roundAddresses.length === 0) return new Map();
  const result = await solanaRpc(
    rpcUrl,
    "getMultipleAccounts",
    [roundAddresses, { commitment: "finalized", encoding: "base64" }],
    fetcher,
  );
  if (
    !isRecord(result) ||
    !isRecord(result.context) ||
    !Array.isArray(result.value)
  ) {
    throw new Error("Solana returned an invalid round account list.");
  }
  if (result.value.length !== roundAddresses.length) {
    throw new Error("Solana returned an incomplete round account list.");
  }
  const rounds = new Map<string, ParsedRound>();
  result.value.forEach((rawAccount, index) => {
    const address = roundAddresses[index];
    if (!address) throw new Error("Walletor round address is missing.");
    const account = parseRpcAccount(rawAccount);
    if (!account) throw new Error("A Walletor round account does not exist.");
    rounds.set(address, parseRoundAccount(address, account, programId));
  });
  return rounds;
}

async function entitlementState(
  env: ClaimEnvironment,
  walletAddress: string,
  fetcher: Fetcher,
): Promise<SolanaClaimState> {
  const config = readSolanaClaimConfig(env);
  if (config.network === "DISABLED" || !config.executionEnabled) {
    return SolanaClaimStateSchema.parse({
      availability: "DISABLED",
      network: null,
      walletAddress,
      programId: config.programId,
      entitlements: [],
      serverTime: new Date().toISOString(),
    });
  }

  try {
    await verifyMainnetClaimDeployment(config, fetcher);
    const winners = await readWinnerAccounts(
      walletAddress,
      config.programId,
      config.rpcUrl,
      fetcher,
    );
    const roundAddresses = [
      ...new Set(winners.map((winner) => winner.roundAddress)),
    ];
    const rounds = await readRoundAccounts(
      roundAddresses,
      config.programId,
      config.rpcUrl,
      fetcher,
    );
    const serverTime = new Date().toISOString();
    const entitlements: SolanaClaimEntitlement[] = [];
    for (const winner of winners) {
      const round = rounds.get(winner.roundAddress);
      const claimWindowExpired =
        round?.claimDeadline !== null &&
        round?.claimDeadline !== undefined &&
        Date.parse(round.claimDeadline) < Date.parse(serverTime);
      if (
        !round ||
        (!winner.claimed &&
          (!claimableRoundStatus(round.status) || claimWindowExpired))
      ) {
        continue;
      }
      const roundBytes = publicKeyBytes(round.address);
      const vaultAddress = await findProgramAddress(
        [new TextEncoder().encode("vault"), roundBytes],
        config.programId,
      );
      const expectedWinnerAddress = await findProgramAddress(
        [
          new TextEncoder().encode("winner"),
          roundBytes,
          publicKeyBytes(walletAddress),
        ],
        config.programId,
      );
      if (expectedWinnerAddress !== winner.address) {
        throw new Error(
          "Walletor winner PDA does not match its stored wallet.",
        );
      }
      entitlements.push({
        winnerAddress: winner.address,
        roundAddress: round.address,
        vaultAddress,
        feeRecipient: round.feeRecipient,
        rank: winner.rank,
        grossLamports: winner.grossLamports.toString(),
        claimFeeLamports: winner.claimFeeLamports.toString(),
        netLamports: winner.netLamports.toString(),
        claimDeadline: round.claimDeadline,
        status: winner.claimed ? "CLAIMED" : "CLAIMABLE",
      });
    }
    return SolanaClaimStateSchema.parse({
      availability:
        config.network === "DEVNET" ? "DEVNET_LIVE" : "MAINNET_LIVE",
      network: config.network,
      walletAddress,
      programId: config.programId,
      entitlements: entitlements.sort((left, right) => left.rank - right.rank),
      serverTime,
    });
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    console.error(
      JSON.stringify({
        message: "solana_claim_state_invalid",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_STATE_INVALID",
      "Walletor could not verify the on-chain claim state.",
      true,
    );
  }
}

function requireLiveClaimState(
  state: SolanaClaimState,
): asserts state is SolanaClaimState & {
  network: "DEVNET" | "MAINNET";
} {
  if (state.availability === "DISABLED" || state.network === null) {
    throw new ApiFailure(
      503,
      "SOLANA_CLAIMS_DISABLED",
      "Solana claims are not enabled yet.",
      false,
    );
  }
}

function claimEntitlement(
  state: SolanaClaimState,
  winnerAddress: string,
): SolanaClaimEntitlement {
  const entitlement = state.entitlements.find(
    (candidate) => candidate.winnerAddress === winnerAddress,
  );
  if (!entitlement) {
    throw new ApiFailure(
      404,
      "SOLANA_CLAIM_NOT_FOUND",
      "No on-chain winnings were found for this wallet.",
      false,
    );
  }
  if (entitlement.status !== "CLAIMABLE") {
    throw new ApiFailure(
      409,
      "SOLANA_CLAIM_ALREADY_COMPLETED",
      "These winnings have already been claimed.",
      false,
    );
  }
  return entitlement;
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
  try {
    publicKeyBytes(result.value.blockhash);
  } catch {
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

function buildUnsignedClaimTransaction(
  programId: string,
  walletAddress: string,
  recentBlockhash: string,
  entitlement: SolanaClaimEntitlement,
): Uint8Array {
  const writableUnsigned = [
    entitlement.roundAddress,
    entitlement.vaultAddress,
    entitlement.winnerAddress,
    entitlement.feeRecipient,
  ].filter(
    (address, index, values) =>
      address !== walletAddress && values.indexOf(address) === index,
  );
  const readonlyUnsigned = [programId, SYSTEM_PROGRAM_ADDRESS];
  if (
    readonlyUnsigned.some(
      (address) =>
        address === walletAddress || writableUnsigned.includes(address),
    )
  ) {
    throw new Error("Walletor claim accounts have conflicting permissions.");
  }
  const staticAccounts = [
    walletAddress,
    ...writableUnsigned,
    ...readonlyUnsigned,
  ];
  const accountIndexes = new Map(
    staticAccounts.map((address, index) => [address, index]),
  );
  const instructionAccounts = [
    entitlement.roundAddress,
    entitlement.vaultAddress,
    entitlement.winnerAddress,
    walletAddress,
    entitlement.feeRecipient,
    SYSTEM_PROGRAM_ADDRESS,
  ].map((address) => {
    const index = accountIndexes.get(address);
    if (index === undefined)
      throw new Error("Walletor claim account is missing.");
    return index;
  });
  const programIndex = accountIndexes.get(programId);
  if (programIndex === undefined) {
    throw new Error("Walletor claim program account is missing.");
  }
  const message = concatenateBytes(
    Uint8Array.of(0x80),
    Uint8Array.of(1, 0, readonlyUnsigned.length),
    encodeShortVector(staticAccounts.length),
    ...staticAccounts.map(publicKeyBytes),
    publicKeyBytes(recentBlockhash),
    encodeShortVector(1),
    Uint8Array.of(programIndex),
    encodeShortVector(instructionAccounts.length),
    Uint8Array.from(instructionAccounts),
    encodeShortVector(CLAIM_DISCRIMINATOR.byteLength),
    CLAIM_DISCRIMINATOR,
    encodeShortVector(0),
  );
  return concatenateBytes(encodeShortVector(1), new Uint8Array(64), message);
}

function parseSignedClaimTransaction(
  bytes: Uint8Array,
): ParsedClaimTransaction {
  const cursor = new ByteCursor(bytes);
  const signatureCount = cursor.readShortVector(1);
  if (signatureCount !== 1) throw new Error("Claim must have one signature.");
  const signature = cursor.readBytes(64);
  const messageOffset = cursor.position();
  const version = cursor.readByte();
  if (version !== 0x80)
    throw new Error("Claim must be a version 0 transaction.");
  const numRequiredSignatures = cursor.readByte();
  const numReadonlySignedAccounts = cursor.readByte();
  const numReadonlyUnsignedAccounts = cursor.readByte();
  const staticAccountCount = cursor.readShortVector(MAX_STATIC_ACCOUNTS);
  const staticAccountKeys = Array.from({ length: staticAccountCount }, () =>
    bs58.encode(cursor.readBytes(32)),
  );
  const recentBlockhash = bs58.encode(cursor.readBytes(32));
  const instructionCount = cursor.readShortVector(MAX_TRANSACTION_INSTRUCTIONS);
  if (instructionCount === 0)
    throw new Error("Claim transaction has no instructions.");
  const instructions: ParsedTransactionInstruction[] = [];
  for (let index = 0; index < instructionCount; index += 1) {
    const programIndex = cursor.readByte();
    const instructionAccountCount = cursor.readShortVector(
      MAX_INSTRUCTION_ACCOUNTS,
    );
    const instructionIndexes = cursor.readBytes(instructionAccountCount);
    const instructionDataLength = cursor.readShortVector(
      MAX_INSTRUCTION_DATA_BYTES,
    );
    const instructionData = cursor.readBytes(instructionDataLength);
    instructions.push({
      programAddress: staticAccountKeys[programIndex],
      instructionAccounts: Array.from(
        instructionIndexes,
        (accountIndex) => staticAccountKeys[accountIndex],
      ),
      instructionData,
    });
  }
  const addressTableLookupCount = cursor.readShortVector(0);
  if (!cursor.atEnd())
    throw new Error("Claim contains trailing transaction data.");
  return {
    signature,
    message: bytes.slice(messageOffset),
    recentBlockhash,
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
    staticAccountKeys,
    instructions,
    addressTableLookupCount,
  };
}

function safeComputeBudgetInstructions(
  instructions: ParsedTransactionInstruction[],
): boolean {
  let unitLimit = BigInt(MAX_COMPUTE_UNIT_LIMIT);
  let unitPrice = 0n;
  let hasUnitLimit = false;
  let hasUnitPrice = false;
  for (const instruction of instructions) {
    if (
      instruction.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS ||
      instruction.instructionAccounts.length !== 0
    ) {
      return false;
    }
    const discriminator = instruction.instructionData[0];
    if (discriminator === 2) {
      if (hasUnitLimit || instruction.instructionData.byteLength !== 5)
        return false;
      const requestedUnits = readU32(instruction.instructionData, 1);
      if (requestedUnits === 0 || requestedUnits > MAX_COMPUTE_UNIT_LIMIT)
        return false;
      unitLimit = BigInt(requestedUnits);
      hasUnitLimit = true;
    } else if (discriminator === 3) {
      if (hasUnitPrice || instruction.instructionData.byteLength !== 9)
        return false;
      unitPrice = readU64(instruction.instructionData, 1);
      hasUnitPrice = true;
    } else {
      return false;
    }
  }
  return unitLimit * unitPrice <= MAX_PRIORITY_FEE_LAMPORTS * 1_000_000n;
}

async function requireValidTransactionBlockhash(
  rpcUrl: string,
  blockhash: string,
  fetcher: Fetcher,
): Promise<void> {
  const result = await solanaRpc(
    rpcUrl,
    "isBlockhashValid",
    [blockhash, { commitment: "confirmed" }],
    fetcher,
  );
  if (
    !isRecord(result) ||
    !isRecord(result.context) ||
    typeof result.value !== "boolean"
  ) {
    throw new ApiFailure(
      502,
      "SOLANA_BLOCKHASH_STATUS_INVALID",
      "Solana returned an unreadable transaction lifetime.",
      true,
    );
  }
  if (!result.value) {
    throw new ApiFailure(
      409,
      "SOLANA_CLAIM_TRANSACTION_EXPIRED",
      "This claim approval expired. Build and approve a new claim.",
      true,
    );
  }
}

export async function getSolanaClaimState(
  env: ClaimEnvironment,
  walletAddress: string,
  fetcher: Fetcher = fetch,
): Promise<SolanaClaimState> {
  if (!isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Connect a valid Solana wallet to review claims.",
      false,
    );
  }
  return entitlementState(env, walletAddress, fetcher);
}

export async function buildSolanaClaimTransaction(
  env: ClaimEnvironment,
  walletAddress: string,
  winnerAddress: string,
  fetcher: Fetcher = fetch,
): Promise<SolanaClaimBuildResult> {
  if (!isSolanaAddress(walletAddress) || !isSolanaAddress(winnerAddress)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_CLAIM",
      "The Solana claim request is invalid.",
      false,
    );
  }
  const config = readSolanaClaimConfig(env);
  const state = await entitlementState(env, walletAddress, fetcher);
  requireLiveClaimState(state);
  const entitlement = claimEntitlement(state, winnerAddress);
  const lifetime = await latestBlockhash(config.rpcUrl, fetcher);
  const transaction = buildUnsignedClaimTransaction(
    config.programId,
    walletAddress,
    lifetime.blockhash,
    entitlement,
  );
  return SolanaClaimBuildResultSchema.parse({
    network: state.network,
    transaction: base64FromBytes(transaction),
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: lifetime.lastValidBlockHeight.toString(),
    entitlement,
  });
}

function validateSignedClaimTransaction(
  transaction: ParsedClaimTransaction,
  programId: string,
  walletAddress: string,
  entitlement: SolanaClaimEntitlement,
): void {
  const expectedAccounts = [
    entitlement.roundAddress,
    entitlement.vaultAddress,
    entitlement.winnerAddress,
    walletAddress,
    entitlement.feeRecipient,
    SYSTEM_PROGRAM_ADDRESS,
  ];
  const payer = transaction.staticAccountKeys[0];
  const unsignedAccountCount =
    transaction.staticAccountKeys.length - transaction.numRequiredSignatures;
  const headerCountsValid =
    transaction.numReadonlySignedAccounts <=
      transaction.numRequiredSignatures &&
    transaction.numReadonlyUnsignedAccounts <= unsignedAccountCount;
  const writableSignedCount =
    transaction.numRequiredSignatures - transaction.numReadonlySignedAccounts;
  const writableUnsignedEnd =
    transaction.staticAccountKeys.length -
    transaction.numReadonlyUnsignedAccounts;
  const isWritable = (address: string | undefined): boolean => {
    if (!address) return false;
    const index = transaction.staticAccountKeys.indexOf(address);
    if (index < 0) return false;
    return index < transaction.numRequiredSignatures
      ? index < writableSignedCount
      : index < writableUnsignedEnd;
  };
  const claimInstructions = transaction.instructions.filter(
    (instruction) => instruction.programAddress === programId,
  );
  const claimInstruction = claimInstructions[0];
  const additionalInstructions = transaction.instructions.filter(
    (instruction) => instruction !== claimInstruction,
  );
  const allowedStaticAccounts = new Set([
    ...expectedAccounts,
    programId,
    COMPUTE_BUDGET_PROGRAM_ADDRESS,
  ]);
  const staticAccountsAllowed = transaction.staticAccountKeys.every((address) =>
    allowedStaticAccounts.has(address),
  );
  const claimAccountsWritable =
    claimInstruction !== undefined &&
    claimInstruction.instructionAccounts
      .slice(0, 5)
      .every((address) => isWritable(address)) &&
    !isWritable(claimInstruction.instructionAccounts[5]);
  const programAccountsReadonly = [
    programId,
    SYSTEM_PROGRAM_ADDRESS,
    ...(additionalInstructions.length > 0
      ? [COMPUTE_BUDGET_PROGRAM_ADDRESS]
      : []),
  ].every((address) => !isWritable(address));
  const signatureValid = (() => {
    try {
      return ed25519.verify(
        transaction.signature,
        transaction.message,
        publicKeyBytes(walletAddress),
      );
    } catch {
      return false;
    }
  })();
  const validationIssues = [
    transaction.numRequiredSignatures !== 1 ? "signature_count" : null,
    !headerCountsValid ? "account_header" : null,
    transaction.numReadonlySignedAccounts !== 0 ? "readonly_signer" : null,
    transaction.addressTableLookupCount !== 0 ? "address_lookups" : null,
    payer !== walletAddress ? "payer" : null,
    claimInstructions.length !== 1 ? "claim_instruction_count" : null,
    !claimInstruction ||
    !sameBytes(claimInstruction.instructionData, CLAIM_DISCRIMINATOR) ||
    claimInstruction.instructionData.byteLength !==
      CLAIM_DISCRIMINATOR.byteLength
      ? "instruction_data"
      : null,
    claimInstruction?.instructionAccounts.length !== expectedAccounts.length
      ? "instruction_account_count"
      : null,
    !claimInstruction ||
    claimInstruction.instructionAccounts.some(
      (address, index) => address !== expectedAccounts[index],
    )
      ? "instruction_accounts"
      : null,
    !claimAccountsWritable ? "writable_accounts" : null,
    !programAccountsReadonly ? "program_permissions" : null,
    !staticAccountsAllowed ? "unexpected_accounts" : null,
    !safeComputeBudgetInstructions(additionalInstructions)
      ? "additional_instructions"
      : null,
    !signatureValid ? "signature" : null,
  ].filter((issue): issue is string => issue !== null);
  if (validationIssues.length > 0) {
    console.error(
      JSON.stringify({
        message: "solana_claim_validation_failed",
        issues: validationIssues,
      }),
    );
    throw new ApiFailure(
      400,
      "INVALID_SIGNED_CLAIM",
      "The signed transaction does not match a Walletor claim.",
      false,
    );
  }
}

export async function submitSolanaClaimTransaction(
  env: ClaimEnvironment,
  input: {
    walletAddress: string;
    winnerAddress: string;
    signedTransaction: string;
    lastValidBlockHeight: string;
  },
  fetcher: Fetcher = fetch,
): Promise<SolanaClaimSubmitResult> {
  if (
    !isSolanaAddress(input.walletAddress) ||
    !isSolanaAddress(input.winnerAddress) ||
    !/^\d+$/.test(input.lastValidBlockHeight)
  ) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_CLAIM",
      "The Solana claim request is invalid.",
      false,
    );
  }
  const bytes = signedTransactionBytesFromBase64(input.signedTransaction);
  if (bytes.byteLength > MAX_SIGNED_TRANSACTION_BYTES) {
    throw new ApiFailure(
      413,
      "CLAIM_TRANSACTION_TOO_LARGE",
      "The signed claim transaction is too large.",
      false,
    );
  }
  let transaction: ParsedClaimTransaction;
  try {
    transaction = parseSignedClaimTransaction(bytes);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "solana_claim_parse_failed",
        reason: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiFailure(
      400,
      "INVALID_SIGNED_CLAIM",
      "The signed transaction does not match a Walletor claim.",
      false,
    );
  }
  const config = readSolanaClaimConfig(env);
  const state = await entitlementState(env, input.walletAddress, fetcher);
  requireLiveClaimState(state);
  const entitlement = claimEntitlement(state, input.winnerAddress);
  validateSignedClaimTransaction(
    transaction,
    config.programId,
    input.walletAddress,
    entitlement,
  );
  await requireValidTransactionBlockhash(
    config.rpcUrl,
    transaction.recentBlockhash,
    fetcher,
  );
  const result = await solanaRpc(
    config.rpcUrl,
    "sendTransaction",
    [
      input.signedTransaction,
      {
        encoding: "base64",
        preflightCommitment: "confirmed",
        maxRetries: 3,
      },
    ],
    fetcher,
  );
  if (typeof result !== "string" || !isSolanaSignature(result)) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_SIGNATURE_INVALID",
      "Solana returned an invalid claim signature.",
      true,
    );
  }
  const signedTransactionSignature = bs58.encode(transaction.signature);
  if (result !== signedTransactionSignature) {
    throw new ApiFailure(
      502,
      "SOLANA_CLAIM_SIGNATURE_MISMATCH",
      "Solana returned a different claim signature than Walletor submitted.",
      true,
    );
  }
  const status = await waitForClaimConfirmation(config.rpcUrl, result, fetcher);
  return SolanaClaimSubmitResultSchema.parse({
    network: state.network,
    transactionSignature: result,
    status,
  });
}
