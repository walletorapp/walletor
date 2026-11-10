import {
  PRIZE_DRAW_ALGORITHM_VERSION,
  REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION,
  isHybridPrizeDraw,
  type PrizeDrawAlgorithmVersion,
  type PrizeDrawMerkleProofNode,
} from "../../shared/prize-draw-contracts";
import bs58 from "bs58";

const DRAW_DOMAIN_V2 = new TextEncoder().encode("WALLETOR_DRAW_V2");
const DRAW_DOMAIN_V3 = new TextEncoder().encode("WALLETOR_DRAW_V3");
const PARTICIPANT_DOMAIN_V3 = new TextEncoder().encode(
  "WALLETOR_PARTICIPANT_V3",
);
const SNAPSHOT_DOMAIN_V3 = new TextEncoder().encode("WALLETOR_SNAPSHOT_V3");
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_ATTEMPTS_PER_WINNER = 100_000;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface PrizeDrawParticipantInput {
  referralBoostBps?: number;
  walletAddress: string;
  eligibleSwapCount: number;
  eligibleVolumeCents: bigint;
  eligibleFeeContributionMicroUsd: bigint;
  multiplierBps: 10_000 | 11_000 | 12_500 | 15_000;
}

export interface PrizeDrawParticipant extends PrizeDrawParticipantInput {
  participantIndex: number;
  weight: bigint;
  rangeStart: bigint;
  rangeEnd: bigint;
  leafHash: string;
}

export interface PrizeDrawSnapshot {
  roundId: string;
  algorithmVersion: PrizeDrawAlgorithmVersion;
  configuredWinnerCount: number;
  winnerCount: number;
  participantCount: number;
  totalWeight: bigint;
  participantChecksum: string;
  participantMerkleRoot: string;
  participants: PrizeDrawParticipant[];
}

export interface PrizeDrawAttempt {
  counter: number;
  ticket: bigint;
  participantIndex: number;
  walletAddress: string;
  leafHash: string;
  merkleProof: PrizeDrawMerkleProofNode[];
  duplicate: boolean;
}

export interface PrizeDrawWinner {
  rank: number;
  walletAddress: string;
  participantIndex: number;
  winningTicket: bigint;
  attempts: PrizeDrawAttempt[];
}

export interface WinnerClaimAmounts {
  rank: number;
  grossLamports: bigint;
  claimFeeLamports: bigint;
  netLamports: bigint;
}

interface ParticipantWithoutProof extends PrizeDrawParticipantInput {
  participantIndex: number;
  weight: bigint;
  rangeStart: bigint;
  rangeEnd: bigint;
  leafHash: string;
}

function compareWalletAddress(
  left: PrizeDrawParticipantInput,
  right: PrizeDrawParticipantInput,
): number {
  if (left.walletAddress < right.walletAddress) return -1;
  if (left.walletAddress > right.walletAddress) return 1;
  return 0;
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareLeaderRank(
  left: PrizeDrawParticipantInput,
  right: PrizeDrawParticipantInput,
): number {
  const feeComparison = compareBigInt(
    right.eligibleFeeContributionMicroUsd,
    left.eligibleFeeContributionMicroUsd,
  );
  if (feeComparison !== 0) return feeComparison;
  const volumeComparison = compareBigInt(
    right.eligibleVolumeCents,
    left.eligibleVolumeCents,
  );
  if (volumeComparison !== 0) return volumeComparison;
  if (left.eligibleSwapCount !== right.eligibleSwapCount) {
    return right.eligibleSwapCount - left.eligibleSwapCount;
  }
  return compareWalletAddress(left, right);
}

function validateWinnerCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Prize draw winner count must be between 1 and 100.");
  }
}

function validateParticipant(participant: PrizeDrawParticipantInput): void {
  if (!SOLANA_ADDRESS_PATTERN.test(participant.walletAddress)) {
    throw new Error("Prize draw participant has an invalid Solana address.");
  }
  try {
    if (bs58.decode(participant.walletAddress).length !== 32) {
      throw new Error("invalid public key length");
    }
  } catch {
    throw new Error("Prize draw participant has an invalid Solana address.");
  }
  if (
    !Number.isInteger(participant.eligibleSwapCount) ||
    participant.eligibleSwapCount < 1
  ) {
    throw new Error("Prize draw participant must have an eligible swap.");
  }
  if (![10_000, 11_000, 12_500, 15_000].includes(participant.multiplierBps)) {
    throw new Error("Prize draw participant has an invalid tier weight.");
  }
  if (
    participant.eligibleVolumeCents < 0n ||
    participant.eligibleFeeContributionMicroUsd < 0n
  ) {
    throw new Error("Prize draw participant totals cannot be negative.");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-fA-F0-9]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error("Expected an even-length hexadecimal value.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function concatenateBytes(...values: Uint8Array[]): Uint8Array {
  const combined = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    combined.set(value, offset);
    offset += value.length;
  }
  return combined;
}

function unsignedBytes(value: bigint, byteLength: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(byteLength * 8)) {
    throw new Error(
      `Unsigned integer does not fit in ${String(byteLength)} bytes.`,
    );
  }
  const output = new Uint8Array(byteLength);
  let remaining = value;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(new ArrayBuffer(value.byteLength));
  input.set(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
}

async function sha256Text(value: string): Promise<string> {
  return bytesToHex(await sha256Bytes(new TextEncoder().encode(value)));
}

export async function hashPrizeDrawRoundId(
  roundId: string,
): Promise<Uint8Array> {
  if (roundId.trim().length === 0) {
    throw new Error("Prize draw round identifier is required.");
  }
  return sha256Bytes(new TextEncoder().encode(roundId));
}

async function hashPair(left: string, right: string): Promise<string> {
  return bytesToHex(
    await sha256Bytes(concatenateBytes(hexToBytes(left), hexToBytes(right))),
  );
}

function canonicalParticipantLeafBytes(
  roundIdHash: Uint8Array,
  participant: Omit<ParticipantWithoutProof, "leafHash">,
  version: PrizeDrawAlgorithmVersion = PRIZE_DRAW_ALGORITHM_VERSION,
): Uint8Array {
  return concatenateBytes(
    version === REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION
      ? new TextEncoder().encode("WALLETOR_PARTICIPANT_V4")
      : PARTICIPANT_DOMAIN_V3,
    roundIdHash,
    unsignedBytes(BigInt(participant.participantIndex), 4),
    bs58.decode(participant.walletAddress),
    unsignedBytes(BigInt(participant.eligibleSwapCount), 4),
    unsignedBytes(participant.eligibleVolumeCents, 8),
    unsignedBytes(participant.eligibleFeeContributionMicroUsd, 8),
    unsignedBytes(participant.weight, 8),
    unsignedBytes(participant.rangeStart, 8),
    unsignedBytes(participant.rangeEnd, 8),
    ...(version === REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION
      ? [unsignedBytes(BigInt(participant.referralBoostBps ?? 0), 2)]
      : []),
  );
}

async function buildMerkleLevels(
  leafHashes: string[],
  algorithmVersion: PrizeDrawAlgorithmVersion = PRIZE_DRAW_ALGORITHM_VERSION,
): Promise<string[][]> {
  if (leafHashes.length === 0) {
    return [[await sha256Text(`${algorithmVersion}:EMPTY`)]];
  }
  const levels = [leafHashes];
  let current = leafHashes;
  while (current.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      if (!left) throw new Error("Merkle tree is missing a left node.");
      const right = current[index + 1] ?? left;
      next.push(await hashPair(left, right));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

function merkleProofForIndex(
  levels: string[][],
  participantIndex: number,
): PrizeDrawMerkleProofNode[] {
  const proof: PrizeDrawMerkleProofNode[] = [];
  let index = participantIndex;
  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    if (!level) throw new Error("Merkle tree level is missing.");
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;
    const ownHash = level[index];
    const siblingHash = level[siblingIndex] ?? ownHash;
    if (!siblingHash) throw new Error("Merkle tree sibling is missing.");
    proof.push({ side: isRightNode ? "LEFT" : "RIGHT", hash: siblingHash });
    index = Math.floor(index / 2);
  }
  return proof;
}

export async function verifyPrizeDrawMerkleProof(
  leafHash: string,
  proof: PrizeDrawMerkleProofNode[],
  expectedRoot: string,
): Promise<boolean> {
  let current = leafHash;
  for (const node of proof) {
    current =
      node.side === "LEFT"
        ? await hashPair(node.hash, current)
        : await hashPair(current, node.hash);
  }
  return current === expectedRoot;
}

export async function buildPrizeDrawMerkleProof(
  snapshot: PrizeDrawSnapshot,
  participantIndex: number,
): Promise<PrizeDrawMerkleProofNode[]> {
  if (
    !Number.isInteger(participantIndex) ||
    participantIndex < 0 ||
    participantIndex >= snapshot.participants.length
  ) {
    throw new Error("Prize draw participant index is invalid.");
  }
  const levels = await buildMerkleLevels(
    snapshot.participants.map(({ leafHash }) => leafHash),
    snapshot.algorithmVersion,
  );
  return merkleProofForIndex(levels, participantIndex);
}

export async function buildPrizeDrawSnapshot(
  roundId: string,
  configuredWinnerCount: number,
  participantInputs: PrizeDrawParticipantInput[],
  algorithmVersion:
    | typeof PRIZE_DRAW_ALGORITHM_VERSION
    | typeof REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION = PRIZE_DRAW_ALGORITHM_VERSION,
): Promise<PrizeDrawSnapshot> {
  if (roundId.trim().length === 0) {
    throw new Error("Prize draw round identifier is required.");
  }
  validateWinnerCount(configuredWinnerCount);
  participantInputs.forEach(validateParticipant);
  for (const participant of participantInputs) {
    const boost = participant.referralBoostBps ?? 0;
    if (
      !Number.isInteger(boost) ||
      boost < 0 ||
      boost > 5000 ||
      boost % 1000 !== 0
    )
      throw new Error("Invalid referral boost.");
    if (
      algorithmVersion !== REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION &&
      boost !== 0
    )
      throw new Error("Referral boosts require a V4 round.");
  }

  const sorted = [...participantInputs].sort(compareWalletAddress);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.walletAddress === sorted[index]?.walletAddress) {
      throw new Error("Prize draw participant wallets must be unique.");
    }
  }

  const leaderWallets = new Set(
    [...sorted]
      .sort(compareLeaderRank)
      .slice(0, Math.min(2, sorted.length))
      .map(({ walletAddress }) => walletAddress),
  );
  const luckyContributions = sorted
    .filter(({ walletAddress }) => !leaderWallets.has(walletAddress))
    .map(({ eligibleFeeContributionMicroUsd }) =>
      eligibleFeeContributionMicroUsd > 0n
        ? eligibleFeeContributionMicroUsd
        : 1n,
    )
    .sort(compareBigInt);
  const medianContribution =
    luckyContributions[Math.floor((luckyContributions.length - 1) / 2)] ?? 0n;
  const luckyWeightCap = medianContribution * 5n;

  let rangeStart = 0n;
  const withoutHashes = sorted.map((participant, participantIndex) => {
    const contribution =
      participant.eligibleFeeContributionMicroUsd > 0n
        ? participant.eligibleFeeContributionMicroUsd
        : 1n;
    const baseWeight = leaderWallets.has(participant.walletAddress)
      ? 0n
      : contribution < luckyWeightCap
        ? contribution
        : luckyWeightCap;
    const weight =
      (baseWeight * BigInt(10000 + (participant.referralBoostBps ?? 0))) /
      10000n;
    const current: Omit<ParticipantWithoutProof, "leafHash"> = {
      ...participant,
      participantIndex,
      weight,
      rangeStart,
      rangeEnd: rangeStart + weight,
    };
    rangeStart = current.rangeEnd;
    return current;
  });
  const roundIdHash = await hashPrizeDrawRoundId(roundId);
  const canonicalLeaves = withoutHashes.map((participant) =>
    canonicalParticipantLeafBytes(roundIdHash, participant, algorithmVersion),
  );
  const leafHashes = await Promise.all(
    canonicalLeaves.map(async (leaf) => bytesToHex(await sha256Bytes(leaf))),
  );
  const levels = await buildMerkleLevels(leafHashes, algorithmVersion);
  const participantMerkleRoot = levels.at(-1)?.[0];
  if (!participantMerkleRoot)
    throw new Error("Prize draw Merkle root is empty.");

  const participants = withoutHashes.map<PrizeDrawParticipant>(
    (participant, index) => {
      const leafHash = leafHashes[index];
      if (!leafHash) throw new Error("Prize draw leaf hash is missing.");
      return {
        ...participant,
        leafHash,
      };
    },
  );

  return {
    roundId,
    algorithmVersion,
    configuredWinnerCount,
    winnerCount: Math.min(configuredWinnerCount, participants.length),
    participantCount: participants.length,
    totalWeight: rangeStart,
    participantChecksum: bytesToHex(
      await sha256Bytes(
        concatenateBytes(
          algorithmVersion === REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION
            ? new TextEncoder().encode("WALLETOR_SNAPSHOT_V4")
            : SNAPSHOT_DOMAIN_V3,
          roundIdHash,
          unsignedBytes(BigInt(participants.length), 4),
          ...leafHashes.map(hexToBytes),
        ),
      ),
    ),
    participantMerkleRoot,
    participants,
  };
}

function unsignedBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`);
}

async function drawTicket(
  randomness: Uint8Array,
  roundId: string,
  rank: number,
  counter: number,
  totalWeight: bigint,
  algorithmVersion: PrizeDrawAlgorithmVersion,
): Promise<bigint | null> {
  const roundIdHash = await hashPrizeDrawRoundId(roundId);
  const digest = await sha256Bytes(
    concatenateBytes(
      algorithmVersion === REFERRAL_PRIZE_DRAW_ALGORITHM_VERSION
        ? new TextEncoder().encode("WALLETOR_DRAW_V4")
        : algorithmVersion === PRIZE_DRAW_ALGORITHM_VERSION
          ? DRAW_DOMAIN_V3
          : DRAW_DOMAIN_V2,
      randomness,
      roundIdHash,
      unsignedBytes(BigInt(rank), 2),
      unsignedBytes(BigInt(counter), 4),
    ),
  );
  const candidate = unsignedBigInt(digest.slice(0, 16));
  const limit = MAX_UINT128 - (MAX_UINT128 % totalWeight);
  return candidate < limit ? candidate % totalWeight : null;
}

function participantForTicket(
  participants: PrizeDrawParticipant[],
  ticket: bigint,
): PrizeDrawParticipant {
  const participant = participants.find(
    (candidate) =>
      ticket >= candidate.rangeStart && ticket < candidate.rangeEnd,
  );
  if (!participant)
    throw new Error("Prize draw ticket is outside the snapshot.");
  return participant;
}

export async function selectPrizeDrawWinners(
  snapshot: PrizeDrawSnapshot,
  switchboardRandomnessHex: string,
): Promise<PrizeDrawWinner[]> {
  if (!/^[a-fA-F0-9]{64}$/.test(switchboardRandomnessHex)) {
    throw new Error("Switchboard randomness must be exactly 32 bytes.");
  }
  if (snapshot.winnerCount === 0) return [];

  const selectedWallets = new Set<string>();
  const winners: PrizeDrawWinner[] = [];
  if (isHybridPrizeDraw(snapshot.algorithmVersion)) {
    const leaders = [...snapshot.participants]
      .sort(compareLeaderRank)
      .slice(0, Math.min(2, snapshot.winnerCount));
    for (const [index, leader] of leaders.entries()) {
      selectedWallets.add(leader.walletAddress);
      winners.push({
        rank: index + 1,
        walletAddress: leader.walletAddress,
        participantIndex: leader.participantIndex,
        winningTicket: 0n,
        attempts: [],
      });
    }
  }
  if (winners.length === snapshot.winnerCount) return winners;
  if (snapshot.totalWeight <= 0n) {
    throw new Error("Prize draw total weight must be positive.");
  }

  const randomness = hexToBytes(switchboardRandomnessHex);
  const merkleLevels = await buildMerkleLevels(
    snapshot.participants.map(({ leafHash }) => leafHash),
    snapshot.algorithmVersion,
  );
  for (let rank = winners.length + 1; rank <= snapshot.winnerCount; rank += 1) {
    const attempts: PrizeDrawAttempt[] = [];
    let selected: PrizeDrawParticipant | null = null;
    let winningTicket = 0n;
    for (let counter = 0; counter < MAX_ATTEMPTS_PER_WINNER; counter += 1) {
      const ticket = await drawTicket(
        randomness,
        snapshot.roundId,
        rank,
        counter,
        snapshot.totalWeight,
        snapshot.algorithmVersion,
      );
      if (ticket === null) continue;
      const participant = participantForTicket(snapshot.participants, ticket);
      const duplicate = selectedWallets.has(participant.walletAddress);
      attempts.push({
        counter,
        ticket,
        participantIndex: participant.participantIndex,
        walletAddress: participant.walletAddress,
        leafHash: participant.leafHash,
        merkleProof: merkleProofForIndex(
          merkleLevels,
          participant.participantIndex,
        ),
        duplicate,
      });
      if (!duplicate) {
        selected = participant;
        winningTicket = ticket;
        break;
      }
    }
    if (!selected) {
      throw new Error("Prize draw could not derive a unique winner.");
    }
    selectedWallets.add(selected.walletAddress);
    winners.push({
      rank,
      walletAddress: selected.walletAddress,
      participantIndex: selected.participantIndex,
      winningTicket,
      attempts,
    });
  }
  return winners;
}

export function calculateWinnerClaimAmounts(
  grossPoolLamports: bigint,
  winnerCount: number,
  claimFeeBps: number,
): WinnerClaimAmounts[] {
  if (grossPoolLamports < 0n) {
    throw new Error("Gross Prize Pool lamports cannot be negative.");
  }
  validateWinnerCount(winnerCount);
  if (
    !Number.isInteger(claimFeeBps) ||
    claimFeeBps < 0 ||
    claimFeeBps > 10_000
  ) {
    throw new Error("Claim fee basis points are invalid.");
  }

  const divisor = BigInt(winnerCount);
  const baseAmount = grossPoolLamports / divisor;
  const remainder = grossPoolLamports % divisor;
  return Array.from({ length: winnerCount }, (_, index) => {
    const rank = index + 1;
    const grossLamports = baseAmount + (BigInt(index) < remainder ? 1n : 0n);
    const claimFeeLamports = (grossLamports * BigInt(claimFeeBps)) / 10_000n;
    return {
      rank,
      grossLamports,
      claimFeeLamports,
      netLamports: grossLamports - claimFeeLamports,
    };
  });
}
