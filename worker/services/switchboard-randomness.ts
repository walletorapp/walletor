import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";

import {
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
  type SwitchboardRandomnessRevealPrepareResult,
} from "../../shared/usdc-claim-contracts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../../shared/solana-foundation-rewards";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { ApiFailure } from "../lib/http";

const RPC_TIMEOUT_MS = 12_000;
const GATEWAY_TIMEOUT_MS = 12_000;
const MAX_RPC_RESPONSE_BYTES = 1_000_000;
const MAX_GATEWAY_RESPONSE_BYTES = 8_192;
const RANDOMNESS_ACCOUNT_SIZE = 480;
const RANDOMNESS_ACCOUNT_DISCRIMINATOR = Uint8Array.of(
  0x0a,
  0x42,
  0xe5,
  0x87,
  0xdc,
  0xef,
  0xd9,
  0x72,
);
const RANDOMNESS_REVEAL_DISCRIMINATOR = Uint8Array.of(
  0xc5,
  0xb5,
  0xbb,
  0x0a,
  0x1e,
  0x3a,
  0x14,
  0x49,
);
const SYSVAR_SLOT_HASHES_ID = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111",
);
const WRAPPED_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

type Fetcher = typeof fetch;

interface RpcAccount {
  data: Uint8Array;
  executable: boolean;
  owner: string;
}

interface RandomnessState {
  authority: PublicKey;
  oracle: PublicKey;
  queue: PublicKey;
  seedSlot: bigint;
  seedSlotHash: Uint8Array;
  revealSlot: bigint;
}

interface GatewayReveal {
  recoveryId: number;
  signature: Uint8Array;
  value: Uint8Array;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidRandomnessAccount(): ApiFailure {
  return new ApiFailure(
    409,
    "INVALID_SWITCHBOARD_RANDOMNESS_ACCOUNT",
    "The committed randomness account does not match Walletor's mainnet Switchboard configuration.",
    false,
  );
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Invalid base64 data.");
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function readPublicKey(data: Uint8Array, offset: number): PublicKey {
  const bytes = data.slice(offset, offset + 32);
  if (bytes.byteLength !== 32) throw invalidRandomnessAccount();
  return new PublicKey(bytes);
}

function readU64(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.byteLength) throw invalidRandomnessAccount();
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(offset, true);
}

function parseRandomnessState(account: RpcAccount): RandomnessState {
  if (
    account.executable ||
    account.owner !== SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID ||
    account.data.byteLength !== RANDOMNESS_ACCOUNT_SIZE ||
    !equalBytes(
      account.data.slice(0, RANDOMNESS_ACCOUNT_DISCRIMINATOR.byteLength),
      RANDOMNESS_ACCOUNT_DISCRIMINATOR,
    )
  ) {
    throw invalidRandomnessAccount();
  }
  return {
    authority: readPublicKey(account.data, 8),
    queue: readPublicKey(account.data, 40),
    seedSlotHash: account.data.slice(72, 104),
    seedSlot: readU64(account.data, 104),
    oracle: readPublicKey(account.data, 112),
    revealSlot: readU64(account.data, 144),
  };
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

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("The upstream response is too large.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new Error("The upstream response is too large.");
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
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
      headers: { "content-type": "application/json" },
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
      502,
      "SWITCHBOARD_SOLANA_RPC_UNAVAILABLE",
      "Solana could not validate the Switchboard randomness account.",
      true,
    );
  }

  let payload: unknown;
  try {
    payload = await readBoundedJson(response, MAX_RPC_RESPONSE_BYTES);
  } catch {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_SOLANA_RPC_INVALID_RESPONSE",
      "Solana returned an invalid response while preparing the reveal.",
      true,
    );
  }
  if (!response.ok || !isRecord(payload) || isRecord(payload.error)) {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_SOLANA_RPC_REJECTED",
      "Solana rejected the Switchboard account request.",
      true,
    );
  }
  return payload.result;
}

async function getAccount(
  rpcUrl: string,
  address: string,
  fetcher: Fetcher,
): Promise<RpcAccount | null> {
  const result = await solanaRpc(
    rpcUrl,
    "getAccountInfo",
    [address, { commitment: "confirmed", encoding: "base64" }],
    fetcher,
  );
  if (!isRecord(result) || !("value" in result)) {
    throw new Error("Solana returned an incomplete account response.");
  }
  return parseRpcAccount(result.value);
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (
    let offset = 0;
    offset <= haystack.byteLength - needle.byteLength;
    offset += 1
  ) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function readGatewayUrl(oracleAccount: RpcAccount): URL {
  if (
    oracleAccount.executable ||
    oracleAccount.owner !== SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID
  ) {
    throw invalidRandomnessAccount();
  }
  const start = findBytes(
    oracleAccount.data,
    new TextEncoder().encode("https://"),
  );
  if (start < 0) throw invalidRandomnessAccount();

  let end = start;
  const maximumEnd = Math.min(start + 256, oracleAccount.data.byteLength);
  while (
    end < maximumEnd &&
    oracleAccount.data[end] !== 0 &&
    (oracleAccount.data[end] ?? 0) >= 0x20 &&
    (oracleAccount.data[end] ?? 0) <= 0x7e
  ) {
    end += 1;
  }
  const rawUrl = new TextDecoder().decode(oracleAccount.data.slice(start, end));
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidRandomnessAccount();
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.hostname.toLowerCase().endsWith(".switchboard-oracles.xyz") ||
    url.pathname.replace(/\/$/, "") !== "/mainnet"
  ) {
    throw invalidRandomnessAccount();
  }
  return url;
}

function parseGatewayReveal(value: unknown): GatewayReveal {
  if (
    !isRecord(value) ||
    typeof value.signature !== "string" ||
    !Number.isInteger(value.recovery_id) ||
    Number(value.recovery_id) < 0 ||
    Number(value.recovery_id) > 3 ||
    !Array.isArray(value.value) ||
    value.value.length !== 32 ||
    value.value.some(
      (byte) =>
        !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255,
    )
  ) {
    throw new Error("The oracle gateway returned invalid reveal data.");
  }
  const signature = decodeBase64(value.signature);
  if (signature.byteLength !== 64) {
    throw new Error("The oracle gateway returned an invalid signature.");
  }
  return {
    signature,
    recoveryId: Number(value.recovery_id),
    value: Uint8Array.from(value.value, Number),
  };
}

async function fetchGatewayReveal(
  gatewayUrl: URL,
  publicRpcUrl: string,
  randomnessAccount: PublicKey,
  state: RandomnessState,
  fetcher: Fetcher,
  attempt = 0,
): Promise<GatewayReveal> {
  const url = new URL(
    `${gatewayUrl.pathname.replace(/\/$/, "")}/gateway/api/v1/randomness_reveal`,
    gatewayUrl,
  );
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slothash: [...state.seedSlotHash],
        randomness_key: Array.from(randomnessAccount.toBytes(), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        slot: Number(state.seedSlot),
        rpc: publicRpcUrl,
      }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_RANDOMNESS_GATEWAY_UNAVAILABLE",
      "The Switchboard oracle gateway could not prepare the reveal. Try again shortly.",
      true,
    );
  }

  // Gateways can return HTML during an outage. Check HTTP status before JSON
  // validation, and retry only the same committed request once.
  if (!response.ok) {
    await response.body?.cancel();
    const unavailable = [429, 502, 503, 504].includes(response.status);
    if ([502, 503, 504].includes(response.status) && attempt === 0) {
      return fetchGatewayReveal(
        gatewayUrl,
        publicRpcUrl,
        randomnessAccount,
        state,
        fetcher,
        attempt + 1,
      );
    }
    throw new ApiFailure(
      502,
      unavailable
        ? "SWITCHBOARD_RANDOMNESS_GATEWAY_UNAVAILABLE"
        : "SWITCHBOARD_RANDOMNESS_GATEWAY_REJECTED",
      unavailable
        ? "The Switchboard oracle gateway is temporarily unavailable. Your commitment is saved. Retry Reveal in Phantom shortly."
        : "The Switchboard oracle gateway rejected the reveal request.",
      unavailable,
    );
  }

  let payload: unknown;
  try {
    payload = await readBoundedJson(response, MAX_GATEWAY_RESPONSE_BYTES);
  } catch {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_RANDOMNESS_GATEWAY_INVALID_RESPONSE",
      "The Switchboard oracle gateway returned invalid reveal data.",
      true,
    );
  }
  try {
    return parseGatewayReveal(payload);
  } catch {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_RANDOMNESS_GATEWAY_INVALID_RESPONSE",
      "The Switchboard oracle gateway returned invalid reveal data.",
      true,
    );
  }
}

function revealInstruction(
  randomnessAccount: PublicKey,
  authority: PublicKey,
  state: RandomnessState,
  reveal: GatewayReveal,
): TransactionInstruction {
  const programId = new PublicKey(SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID);
  const [stats] = PublicKey.findProgramAddressSync(
    [Buffer.from("OracleRandomnessStats"), state.oracle.toBuffer()],
    programId,
  );
  const [rewardEscrow] = PublicKey.findProgramAddressSync(
    [
      randomnessAccount.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      WRAPPED_SOL_MINT.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const [programState] = PublicKey.findProgramAddressSync(
    [Buffer.from("STATE")],
    programId,
  );
  const keys: AccountMeta[] = [
    { pubkey: randomnessAccount, isSigner: false, isWritable: true },
    { pubkey: state.oracle, isSigner: false, isWritable: false },
    { pubkey: state.queue, isSigner: false, isWritable: false },
    { pubkey: stats, isSigner: false, isWritable: true },
    { pubkey: state.authority, isSigner: true, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: SYSVAR_SLOT_HASHES_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: rewardEscrow, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: WRAPPED_SOL_MINT, isSigner: false, isWritable: false },
    { pubkey: programState, isSigner: false, isWritable: false },
  ];
  const data = new Uint8Array(
    RANDOMNESS_REVEAL_DISCRIMINATOR.byteLength +
      reveal.signature.byteLength +
      1 +
      reveal.value.byteLength,
  );
  data.set(RANDOMNESS_REVEAL_DISCRIMINATOR, 0);
  data.set(reveal.signature, RANDOMNESS_REVEAL_DISCRIMINATOR.byteLength);
  data[
    RANDOMNESS_REVEAL_DISCRIMINATOR.byteLength + reveal.signature.byteLength
  ] = reveal.recoveryId;
  data.set(
    reveal.value,
    RANDOMNESS_REVEAL_DISCRIMINATOR.byteLength +
      reveal.signature.byteLength +
      1,
  );
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(data),
  });
}

function readPublicGatewayRpcUrl(env: {
  SOLANA_CLAIM_RPC_URL?: string;
}): string {
  const value = env.SOLANA_CLAIM_RPC_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SOLANA_CLAIM_RPC_URL must be a valid public RPC URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("SOLANA_CLAIM_RPC_URL must use HTTPS.");
  }
  return url.toString();
}

async function getLatestBlockhash(
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
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
    !Number.isSafeInteger(result.value.lastValidBlockHeight) ||
    result.value.lastValidBlockHeight <= 0
  ) {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_SOLANA_RPC_INVALID_RESPONSE",
      "Solana returned an invalid blockhash while preparing the reveal.",
      true,
    );
  }
  try {
    if (bs58.decode(result.value.blockhash).byteLength !== 32)
      throw new Error();
  } catch {
    throw new ApiFailure(
      502,
      "SWITCHBOARD_SOLANA_RPC_INVALID_RESPONSE",
      "Solana returned an invalid blockhash while preparing the reveal.",
      true,
    );
  }
  return {
    blockhash: result.value.blockhash,
    lastValidBlockHeight: result.value.lastValidBlockHeight,
  };
}

export async function prepareSwitchboardRandomnessReveal(
  env: Parameters<typeof readUsdcClaimConfig>[0],
  randomnessAccountAddress: string,
  fetcher: Fetcher = fetch,
): Promise<SwitchboardRandomnessRevealPrepareResult> {
  const config = readUsdcClaimConfig(env);
  if (!config.executionEnabled) {
    throw new ApiFailure(
      409,
      "PAYOUT_EXECUTION_DISABLED",
      "The mainnet claim gate is not enabled.",
      false,
    );
  }
  const publicRpcUrl = readPublicGatewayRpcUrl(env);
  const randomnessAccount = new PublicKey(randomnessAccountAddress);
  const account = await getAccount(
    config.rpcUrl,
    randomnessAccountAddress,
    fetcher,
  );
  if (!account) throw invalidRandomnessAccount();
  const state = parseRandomnessState(account);
  if (
    state.authority.toBase58() !== config.authorityAddress ||
    state.queue.toBase58() !== SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS ||
    state.seedSlot <= 0n ||
    state.seedSlot > BigInt(Number.MAX_SAFE_INTEGER) ||
    state.revealSlot !== 0n
  ) {
    throw invalidRandomnessAccount();
  }
  const oracleAccount = await getAccount(
    config.rpcUrl,
    state.oracle.toBase58(),
    fetcher,
  );
  if (!oracleAccount) throw invalidRandomnessAccount();
  const gatewayUrl = readGatewayUrl(oracleAccount);
  const reveal = await fetchGatewayReveal(
    gatewayUrl,
    publicRpcUrl,
    randomnessAccount,
    state,
    fetcher,
  );
  const lifetime = await getLatestBlockhash(config.rpcUrl, fetcher);
  const authority = new PublicKey(config.authorityAddress);
  const transaction = new Transaction({
    feePayer: authority,
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
  }).add(revealInstruction(randomnessAccount, authority, state, reveal));

  return {
    randomnessAccount: randomnessAccountAddress,
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: String(lifetime.lastValidBlockHeight),
  };
}
