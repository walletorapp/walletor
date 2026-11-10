import bs58 from "bs58";

import {
  PRIZE_DRAW_ALGORITHM_VERSION,
  type PublicPrizeDrawSnapshot,
} from "../../shared/prize-draw-contracts";
import { calculateWinnerClaimAmounts, hashPrizeDrawRoundId } from "./draw";

const DEVNET_SWITCHBOARD_PROGRAM =
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2";
const MAINNET_SWITCHBOARD_PROGRAM =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";
const FIXED_CLAIM_FEE_BPS = 50;

type SolanaClaimConfigKey =
  | "PAYOUTS_ENABLED"
  | "SOLANA_CLAIM_NETWORK"
  | "SOLANA_CLAIM_PROGRAM_ID"
  | "SOLANA_CLAIM_AUTHORITY_ADDRESS"
  | "SOLANA_CLAIM_COORDINATOR_ADDRESS"
  | "SOLANA_CLAIM_FEE_RECIPIENT_ADDRESS"
  | "SOLANA_SWITCHBOARD_PROGRAM_ID"
  | "SOLANA_CLAIM_RPC_URL"
  | "SOLANA_CLAIM_RPC_URL_PRIVATE";

type SolanaClaimConfigEnvironment = Partial<
  Record<SolanaClaimConfigKey, string>
>;

function optionalTrimmed(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

export type SolanaClaimNetwork = "DISABLED" | "DEVNET" | "MAINNET";

export interface SolanaClaimConfig {
  network: SolanaClaimNetwork;
  executionEnabled: boolean;
  programId: string;
  authorityAddress: string | null;
  coordinatorAddress: string | null;
  feeRecipientAddress: string | null;
  switchboardProgramId: string;
  rpcUrl: string;
}

export interface SolanaRoundManifest {
  algorithmVersion: PublicPrizeDrawSnapshot["algorithmVersion"];
  roundId: string;
  roundIdHash: string;
  participantRoot: string;
  participantChecksum: string;
  participantCount: number;
  winnerCount: number;
  totalWeight: string;
  grossPoolLamports: string;
  claimDeadlineUnixTimestamp: string;
  recoveryRecipient: string;
  claimFeeBps: 50;
  claims: {
    rank: number;
    grossLamports: string;
    claimFeeLamports: string;
    netLamports: string;
  }[];
}

function validatePublicKey(name: string, address: string): void {
  try {
    if (bs58.decode(address).length !== 32) throw new Error("wrong length");
  } catch {
    throw new Error(`${name} must be a valid Solana public key.`);
  }
}

function validateRpcUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SOLANA_CLAIM_RPC_URL must be a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("SOLANA_CLAIM_RPC_URL must use HTTPS.");
  }
}

export function readSolanaClaimConfig(
  env: SolanaClaimConfigEnvironment,
): SolanaClaimConfig {
  const normalizedNetwork = (env.SOLANA_CLAIM_NETWORK ?? "disabled")
    .trim()
    .toUpperCase();
  let network: SolanaClaimNetwork;
  if (
    normalizedNetwork === "DISABLED" ||
    normalizedNetwork === "DEVNET" ||
    normalizedNetwork === "MAINNET"
  ) {
    network = normalizedNetwork;
  } else {
    throw new Error(
      "SOLANA_CLAIM_NETWORK must be disabled, devnet, or mainnet.",
    );
  }
  const programId = env.SOLANA_CLAIM_PROGRAM_ID?.trim() ?? "";
  const authorityAddress = optionalTrimmed(env.SOLANA_CLAIM_AUTHORITY_ADDRESS);
  const coordinatorAddress = optionalTrimmed(
    env.SOLANA_CLAIM_COORDINATOR_ADDRESS,
  );
  const feeRecipientAddress = optionalTrimmed(
    env.SOLANA_CLAIM_FEE_RECIPIENT_ADDRESS,
  );
  const switchboardProgramId = env.SOLANA_SWITCHBOARD_PROGRAM_ID?.trim() ?? "";
  const privateRpcUrl = env.SOLANA_CLAIM_RPC_URL_PRIVATE?.trim();
  const rpcUrl =
    privateRpcUrl && privateRpcUrl.length > 0
      ? privateRpcUrl
      : (env.SOLANA_CLAIM_RPC_URL?.trim() ?? "");
  validatePublicKey("SOLANA_CLAIM_PROGRAM_ID", programId);
  validatePublicKey("SOLANA_SWITCHBOARD_PROGRAM_ID", switchboardProgramId);
  validateRpcUrl(rpcUrl);
  for (const [name, address] of [
    ["SOLANA_CLAIM_AUTHORITY_ADDRESS", authorityAddress],
    ["SOLANA_CLAIM_COORDINATOR_ADDRESS", coordinatorAddress],
    ["SOLANA_CLAIM_FEE_RECIPIENT_ADDRESS", feeRecipientAddress],
  ] as const) {
    if (address !== null) validatePublicKey(name, address);
  }
  if (
    network === "MAINNET" &&
    (authorityAddress === null ||
      coordinatorAddress === null ||
      feeRecipientAddress === null)
  ) {
    throw new Error(
      "Mainnet claims require the expected authority, coordinator, and fee recipient addresses.",
    );
  }

  const expectedSwitchboardProgram =
    network === "MAINNET"
      ? MAINNET_SWITCHBOARD_PROGRAM
      : DEVNET_SWITCHBOARD_PROGRAM;
  if (
    network !== "DISABLED" &&
    switchboardProgramId !== expectedSwitchboardProgram
  ) {
    throw new Error(
      `SOLANA_SWITCHBOARD_PROGRAM_ID does not match ${network.toLowerCase()}.`,
    );
  }

  const payoutsEnabled = env.PAYOUTS_ENABLED === "true";
  if (network === "MAINNET" && !payoutsEnabled) {
    throw new Error(
      "Mainnet claim execution cannot start while PAYOUTS_ENABLED is false.",
    );
  }

  return {
    network,
    executionEnabled:
      network === "DEVNET" || (network === "MAINNET" && payoutsEnabled),
    programId,
    authorityAddress,
    coordinatorAddress,
    feeRecipientAddress,
    switchboardProgramId,
    rpcUrl,
  };
}

export async function buildSolanaRoundManifest(
  snapshot: PublicPrizeDrawSnapshot,
  grossPoolLamports: bigint,
  options: {
    claimDeadlineUnixTimestamp: bigint;
    recoveryRecipient: string;
  },
): Promise<SolanaRoundManifest> {
  if (snapshot.status !== "SNAPSHOT_LOCKED") {
    throw new Error("Only a locked Prize Draw snapshot can create a round.");
  }
  if (snapshot.algorithmVersion !== PRIZE_DRAW_ALGORITHM_VERSION) {
    throw new Error("Only a V2 Prize Draw snapshot can create a Solana round.");
  }
  if (snapshot.claimFeeBps !== FIXED_CLAIM_FEE_BPS) {
    throw new Error("The Solana claim program requires a fixed 50 bps fee.");
  }
  if (snapshot.winnerCount < 1 || snapshot.participantCount < 1) {
    throw new Error("An on-chain round requires at least one participant.");
  }
  if (grossPoolLamports < BigInt(snapshot.winnerCount)) {
    throw new Error(
      "The gross SOL pool must fund at least one lamport per winner.",
    );
  }
  if (options.claimDeadlineUnixTimestamp <= 0n) {
    throw new Error("The claim deadline must be a positive Unix timestamp.");
  }
  validatePublicKey("recoveryRecipient", options.recoveryRecipient);

  const claims = calculateWinnerClaimAmounts(
    grossPoolLamports,
    snapshot.winnerCount,
    snapshot.claimFeeBps,
  );
  const roundIdHash = await hashPrizeDrawRoundId(snapshot.roundId);

  return {
    algorithmVersion: snapshot.algorithmVersion,
    roundId: snapshot.roundId,
    roundIdHash: Array.from(roundIdHash, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    participantRoot: snapshot.participantMerkleRoot,
    participantChecksum: snapshot.participantChecksum,
    participantCount: snapshot.participantCount,
    winnerCount: snapshot.winnerCount,
    totalWeight: snapshot.totalWeight,
    grossPoolLamports: grossPoolLamports.toString(),
    claimDeadlineUnixTimestamp: options.claimDeadlineUnixTimestamp.toString(),
    recoveryRecipient: options.recoveryRecipient,
    claimFeeBps: FIXED_CLAIM_FEE_BPS,
    claims: claims.map((claim) => ({
      rank: claim.rank,
      grossLamports: claim.grossLamports.toString(),
      claimFeeLamports: claim.claimFeeLamports.toString(),
      netLamports: claim.netLamports.toString(),
    })),
  };
}
