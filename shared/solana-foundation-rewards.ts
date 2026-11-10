import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  USDC_CLAIM_FEE_BPS,
  type UsdcClaimDistributionManifest,
} from "./usdc-claim-contracts";

export const SOLANA_REWARDS_SOURCE_REVISION =
  "4aa0ee540120652bf81b68bd825395054d3597df" as const;
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const REWARDS_PROGRAM_ID = new PublicKey(
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
);
export const MAINNET_USDC_MINT = new PublicKey(SOLANA_MAINNET_USDC_MINT);

const MAX_U64 = (1n << 64n) - 1n;
const IMMEDIATE_VESTING_SCHEDULE = Uint8Array.of(0);
const MERKLE_DISTRIBUTION_PREFIX = new TextEncoder().encode(
  "merkle_distribution",
);
const MERKLE_CLAIM_PREFIX = new TextEncoder().encode("merkle_claim");
const REVOCATION_PREFIX = new TextEncoder().encode("revocation");
// The deployed Solana Foundation Rewards program uses this literal seed.
// It is not Anchor's conventional "__event_authority" seed.
const EVENT_AUTHORITY_PREFIX = new TextEncoder().encode("event_authority");

export interface UsdcWinnerAllocation {
  rank: number;
  winnerAddress: string;
  grossAmountAtomic: string;
  claimFeeAmountAtomic: string;
  netAmountAtomic: string;
  leafHash: string;
  proof: string[];
}

export interface UsdcMerkleAllocationBundle {
  merkleRoot: string;
  grossPrizeAmountAtomic: string;
  claimFeeAmountAtomic: string;
  netDistributionAmountAtomic: string;
  entitlements: UsdcWinnerAllocation[];
}

export type UsdcPayoutModel = "EQUAL" | "HYBRID_20_10_70";

export interface ParsedMerkleDistribution {
  bump: number;
  revocable: number;
  authorityAddress: string;
  mintAddress: string;
  seedAddress: string;
  merkleRoot: string;
  totalAmountAtomic: bigint;
  totalClaimedAtomic: bigint;
  clawbackUnixTimestamp: bigint;
}

function concatenateBytes(...values: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    values.reduce((length, value) => length + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) break;
    if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
  }
  return left.length - right.length;
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Expected an even-length hexadecimal value.");
  }
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function u64Le(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_U64) {
    throw new Error("Amount must fit in an unsigned 64-bit integer.");
  }
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, true);
  return output;
}

function i64Le(value: bigint): Uint8Array {
  const minimum = -(1n << 63n);
  const maximum = (1n << 63n) - 1n;
  if (value < minimum || value > maximum) {
    throw new Error("Timestamp must fit in a signed 64-bit integer.");
  }
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigInt64(0, value, true);
  return output;
}

function u32Le(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Length must fit in an unsigned 32-bit integer.");
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function readU64Le(value: Uint8Array, offset: number): bigint {
  return new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  ).getBigUint64(offset, true);
}

function readI64Le(value: Uint8Array, offset: number): bigint {
  return new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  ).getBigInt64(offset, true);
}

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const pair = compareBytes(left, right) <= 0 ? [left, right] : [right, left];
  return keccak_256(concatenateBytes(...pair));
}

export function computeImmediateVestingLeaf(
  winnerAddress: string,
  totalAmountAtomic: bigint,
): Uint8Array {
  const claimant = new PublicKey(winnerAddress).toBytes();
  const innerHash = keccak_256(
    concatenateBytes(
      claimant,
      u64Le(totalAmountAtomic),
      IMMEDIATE_VESTING_SCHEDULE,
    ),
  );
  return keccak_256(concatenateBytes(Uint8Array.of(0), innerHash));
}

export function verifyMerkleProof(
  leaf: Uint8Array,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  const computed = proof.reduce(
    (current, sibling) => hashPair(current, sibling),
    leaf,
  );
  return compareBytes(computed, root) === 0;
}

function buildMerkleTree(leaves: readonly Uint8Array[]): {
  root: Uint8Array;
  proofs: Uint8Array[][];
} {
  if (leaves.length === 0) {
    throw new Error("A USDC claim distribution needs at least one winner.");
  }
  const proofs = leaves.map((): Uint8Array[] => []);
  let level = leaves
    .map((hash, originalIndex) => ({ hash, leafIndexes: [originalIndex] }))
    .sort((left, right) => compareBytes(left.hash, right.hash));

  while (level.length > 1) {
    const next: typeof level = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (!left) throw new Error("Merkle tree level is inconsistent.");
      if (!right) {
        next.push(left);
        continue;
      }
      for (const leafIndex of left.leafIndexes) {
        proofs[leafIndex]?.push(right.hash);
      }
      for (const leafIndex of right.leafIndexes) {
        proofs[leafIndex]?.push(left.hash);
      }
      next.push({
        hash: hashPair(left.hash, right.hash),
        leafIndexes: [...left.leafIndexes, ...right.leafIndexes],
      });
    }
    level = next;
  }
  const root = level[0]?.hash;
  if (!root) throw new Error("Merkle root could not be created.");
  return { root, proofs };
}

export function buildUsdcMerkleAllocationBundle(
  grossPrizeAmountAtomic: bigint,
  winners: readonly { rank: number; winnerAddress: string }[],
  payoutModel: UsdcPayoutModel = "EQUAL",
): UsdcMerkleAllocationBundle {
  if (grossPrizeAmountAtomic <= 0n || grossPrizeAmountAtomic > MAX_U64) {
    throw new Error("Gross USDC prize amount must be a positive u64 value.");
  }
  if (winners.length < 1 || winners.length > 100) {
    throw new Error("A USDC distribution needs between 1 and 100 winners.");
  }
  const uniqueAddresses = new Set<string>();
  const uniqueRanks = new Set<number>();
  for (const winner of winners) {
    new PublicKey(winner.winnerAddress);
    if (
      !Number.isInteger(winner.rank) ||
      winner.rank < 1 ||
      winner.rank > 100
    ) {
      throw new Error("Winner rank is invalid.");
    }
    if (uniqueAddresses.has(winner.winnerAddress)) {
      throw new Error("A wallet cannot win twice in one distribution.");
    }
    if (uniqueRanks.has(winner.rank)) {
      throw new Error("A winner rank cannot be duplicated.");
    }
    uniqueAddresses.add(winner.winnerAddress);
    uniqueRanks.add(winner.rank);
  }

  const rankedWinners = [...winners].sort(
    (left, right) => left.rank - right.rank,
  );
  const grossAmounts = allocateGrossUsdcPrizes(
    grossPrizeAmountAtomic,
    rankedWinners.length,
    payoutModel,
  );
  if (grossAmounts.some((amount) => amount === 0n)) {
    throw new Error(
      "The USDC pool must fund at least one atomic unit per winner.",
    );
  }
  const amounts = rankedWinners.map((winner, index) => {
    const grossAmountAtomic = grossAmounts[index];
    if (grossAmountAtomic === undefined) {
      throw new Error("A winner's gross USDC allocation is missing.");
    }
    const claimFeeAmountAtomic =
      (grossAmountAtomic * BigInt(USDC_CLAIM_FEE_BPS)) / 10_000n;
    const netAmountAtomic = grossAmountAtomic - claimFeeAmountAtomic;
    if (netAmountAtomic <= 0n) {
      throw new Error("A winner's net USDC allocation cannot be zero.");
    }
    return {
      ...winner,
      grossAmountAtomic,
      claimFeeAmountAtomic,
      netAmountAtomic,
    };
  });
  const leaves = amounts.map((winner) =>
    computeImmediateVestingLeaf(winner.winnerAddress, winner.netAmountAtomic),
  );
  const tree = buildMerkleTree(leaves);
  const claimFeeAmountAtomic = amounts.reduce(
    (total, winner) => total + winner.claimFeeAmountAtomic,
    0n,
  );
  const netDistributionAmountAtomic = amounts.reduce(
    (total, winner) => total + winner.netAmountAtomic,
    0n,
  );

  return {
    merkleRoot: bytesToHex(tree.root),
    grossPrizeAmountAtomic: grossPrizeAmountAtomic.toString(),
    claimFeeAmountAtomic: claimFeeAmountAtomic.toString(),
    netDistributionAmountAtomic: netDistributionAmountAtomic.toString(),
    entitlements: amounts.map((winner, index) => ({
      rank: winner.rank,
      winnerAddress: winner.winnerAddress,
      grossAmountAtomic: winner.grossAmountAtomic.toString(),
      claimFeeAmountAtomic: winner.claimFeeAmountAtomic.toString(),
      netAmountAtomic: winner.netAmountAtomic.toString(),
      leafHash: bytesToHex(leaves[index] ?? new Uint8Array()),
      proof: (tree.proofs[index] ?? []).map(bytesToHex),
    })),
  };
}

export function allocateGrossUsdcPrizes(
  grossPrizeAmountAtomic: bigint,
  winnerCount: number,
  payoutModel: UsdcPayoutModel,
): bigint[] {
  if (grossPrizeAmountAtomic <= 0n) {
    throw new Error("Gross USDC prize amount must be positive.");
  }
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100) {
    throw new Error("A USDC distribution needs between 1 and 100 winners.");
  }
  if (payoutModel === "EQUAL") {
    const divisor = BigInt(winnerCount);
    const baseAmount = grossPrizeAmountAtomic / divisor;
    const remainder = grossPrizeAmountAtomic % divisor;
    return Array.from(
      { length: winnerCount },
      (_, index) => baseAmount + (BigInt(index) < remainder ? 1n : 0n),
    );
  }
  if (winnerCount === 1) return [grossPrizeAmountAtomic];
  if (winnerCount === 2) {
    const first = (grossPrizeAmountAtomic * 2n) / 3n;
    return [first, grossPrizeAmountAtomic - first];
  }

  const first = (grossPrizeAmountAtomic * 2_000n) / 10_000n;
  const second = (grossPrizeAmountAtomic * 1_000n) / 10_000n;
  const luckyPool = grossPrizeAmountAtomic - first - second;
  const luckyCount = BigInt(winnerCount - 2);
  const luckyBase = luckyPool / luckyCount;
  const luckyRemainder = luckyPool % luckyCount;
  return [
    first,
    second,
    ...Array.from(
      { length: winnerCount - 2 },
      (_, index) => luckyBase + (BigInt(index) < luckyRemainder ? 1n : 0n),
    ),
  ];
}

export function deriveDistributionAddress(
  authorityAddress: string,
  seedAddress: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      MERKLE_DISTRIBUTION_PREFIX,
      MAINNET_USDC_MINT.toBytes(),
      new PublicKey(authorityAddress).toBytes(),
      new PublicKey(seedAddress).toBytes(),
    ],
    REWARDS_PROGRAM_ID,
  );
}

export function deriveClaimAddress(
  distributionAddress: string,
  winnerAddress: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      MERKLE_CLAIM_PREFIX,
      new PublicKey(distributionAddress).toBytes(),
      new PublicKey(winnerAddress).toBytes(),
    ],
    REWARDS_PROGRAM_ID,
  );
}

export function deriveRevocationAddress(
  distributionAddress: string,
  winnerAddress: string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      REVOCATION_PREFIX,
      new PublicKey(distributionAddress).toBytes(),
      new PublicKey(winnerAddress).toBytes(),
    ],
    REWARDS_PROGRAM_ID,
  )[0];
}

export function deriveEventAuthorityAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_PREFIX],
    REWARDS_PROGRAM_ID,
  )[0];
}

export function deriveAssociatedTokenAddress(
  ownerAddress: string,
  mintAddress = SOLANA_MAINNET_USDC_MINT,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(ownerAddress).toBytes(),
      TOKEN_PROGRAM_ID.toBytes(),
      new PublicKey(mintAddress).toBytes(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function createAssociatedTokenAccountIdempotentInstruction(
  payerAddress: string,
  ownerAddress: string,
  mintAddress = SOLANA_MAINNET_USDC_MINT,
): TransactionInstruction {
  const mint = new PublicKey(mintAddress);
  const owner = new PublicKey(ownerAddress);
  const associatedToken = deriveAssociatedTokenAddress(
    ownerAddress,
    mintAddress,
  );
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(payerAddress), isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export function createMerkleClaimInstruction(input: {
  distributionAddress: string;
  distributionVaultAddress: string;
  winnerAddress: string;
  netAmountAtomic: bigint;
  proof: readonly string[];
}): TransactionInstruction {
  const [claimAccount, claimBump] = deriveClaimAddress(
    input.distributionAddress,
    input.winnerAddress,
  );
  const claimantTokenAccount = deriveAssociatedTokenAddress(
    input.winnerAddress,
  );
  const proofBytes = input.proof.map((node) => {
    const decoded = hexToBytes(node);
    if (decoded.byteLength !== 32) {
      throw new Error("Merkle proof node must be 32 bytes.");
    }
    return decoded;
  });
  const keys: AccountMeta[] = [
    {
      pubkey: new PublicKey(input.winnerAddress),
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: new PublicKey(input.winnerAddress),
      isSigner: true,
      isWritable: false,
    },
    {
      pubkey: new PublicKey(input.distributionAddress),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: claimAccount, isSigner: false, isWritable: true },
    {
      pubkey: deriveRevocationAddress(
        input.distributionAddress,
        input.winnerAddress,
      ),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: MAINNET_USDC_MINT, isSigner: false, isWritable: false },
    {
      pubkey: new PublicKey(input.distributionVaultAddress),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: claimantTokenAccount, isSigner: false, isWritable: true },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: deriveEventAuthorityAddress(),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: REWARDS_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const data = concatenateBytes(
    Uint8Array.of(6, claimBump),
    u64Le(input.netAmountAtomic),
    u64Le(0n),
    IMMEDIATE_VESTING_SCHEDULE,
    u32Le(proofBytes.length),
    ...proofBytes,
  );
  return new TransactionInstruction({
    programId: REWARDS_PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}

export function createMerkleDistributionInstruction(input: {
  payerAddress: string;
  authorityAddress: string;
  seedAddress: string;
  merkleRoot: string;
  netDistributionAmountAtomic: bigint;
  clawbackUnixTimestamp: bigint;
}): {
  distributionAddress: string;
  distributionVaultAddress: string;
  instruction: TransactionInstruction;
} {
  const [distribution, bump] = deriveDistributionAddress(
    input.authorityAddress,
    input.seedAddress,
  );
  const distributionVault = deriveAssociatedTokenAddress(
    distribution.toBase58(),
  );
  const authorityTokenAccount = deriveAssociatedTokenAddress(
    input.authorityAddress,
  );
  const merkleRoot = hexToBytes(input.merkleRoot);
  if (merkleRoot.byteLength !== 32) {
    throw new Error("Merkle root must be 32 bytes.");
  }
  const data = concatenateBytes(
    Uint8Array.of(5, bump, 0),
    u64Le(input.netDistributionAmountAtomic),
    merkleRoot,
    u64Le(input.netDistributionAmountAtomic),
    i64Le(input.clawbackUnixTimestamp),
  );
  return {
    distributionAddress: distribution.toBase58(),
    distributionVaultAddress: distributionVault.toBase58(),
    instruction: new TransactionInstruction({
      programId: REWARDS_PROGRAM_ID,
      keys: [
        {
          pubkey: new PublicKey(input.payerAddress),
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: new PublicKey(input.authorityAddress),
          isSigner: true,
          isWritable: false,
        },
        {
          pubkey: new PublicKey(input.seedAddress),
          isSigner: true,
          isWritable: false,
        },
        { pubkey: distribution, isSigner: false, isWritable: true },
        { pubkey: MAINNET_USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: distributionVault, isSigner: false, isWritable: true },
        {
          pubkey: authorityTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: deriveEventAuthorityAddress(),
          isSigner: false,
          isWritable: false,
        },
        { pubkey: REWARDS_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    }),
  };
}

export function parseMerkleDistributionAccount(
  data: Uint8Array,
): ParsedMerkleDistribution {
  if (data.byteLength !== 162 || data[0] !== 2 || data[1] !== 1) {
    throw new Error("Rewards account is not a current Merkle distribution.");
  }
  return {
    bump: data[2] ?? 0,
    revocable: data[3] ?? 0,
    authorityAddress: new PublicKey(data.slice(10, 42)).toBase58(),
    mintAddress: new PublicKey(data.slice(42, 74)).toBase58(),
    seedAddress: new PublicKey(data.slice(74, 106)).toBase58(),
    merkleRoot: bytesToHex(data.slice(106, 138)),
    totalAmountAtomic: readU64Le(data, 138),
    totalClaimedAtomic: readU64Le(data, 146),
    clawbackUnixTimestamp: readI64Le(data, 154),
  };
}

export function parseMerkleClaimAmount(data: Uint8Array): bigint {
  if (data.byteLength !== 18 || data[0] !== 3 || data[1] !== 1) {
    throw new Error("Rewards account is not a current Merkle claim.");
  }
  return readU64Le(data, 10);
}

export function validateUsdcClaimManifest(
  manifest: UsdcClaimDistributionManifest,
): void {
  const expectedDistribution = deriveDistributionAddress(
    manifest.authorityAddress,
    manifest.seedAddress,
  )[0].toBase58();
  if (manifest.distributionAddress !== expectedDistribution) {
    throw new Error(
      "Distribution address does not match its authority and seed.",
    );
  }
  const expectedVault = deriveAssociatedTokenAddress(
    manifest.distributionAddress,
  ).toBase58();
  if (manifest.distributionVaultAddress !== expectedVault) {
    throw new Error(
      "Distribution vault is not the expected USDC token account.",
    );
  }
  const root = hexToBytes(manifest.merkleRoot);
  const uniqueWallets = new Set<string>();
  const uniqueRanks = new Set<number>();
  let grossTotal = 0n;
  let feeTotal = 0n;
  let netTotal = 0n;
  for (const entitlement of manifest.entitlements) {
    if (uniqueWallets.has(entitlement.winnerAddress)) {
      throw new Error("Claim manifest contains a duplicate winner wallet.");
    }
    if (uniqueRanks.has(entitlement.rank)) {
      throw new Error("Claim manifest contains a duplicate winner rank.");
    }
    uniqueWallets.add(entitlement.winnerAddress);
    uniqueRanks.add(entitlement.rank);
    const gross = BigInt(entitlement.grossAmountAtomic);
    const fee = BigInt(entitlement.claimFeeAmountAtomic);
    const net = BigInt(entitlement.netAmountAtomic);
    if (
      fee !== (gross * BigInt(USDC_CLAIM_FEE_BPS)) / 10_000n ||
      gross - fee !== net ||
      net <= 0n
    ) {
      throw new Error("Claim manifest contains an invalid 250 bps fee split.");
    }
    const leaf = computeImmediateVestingLeaf(entitlement.winnerAddress, net);
    if (bytesToHex(leaf) !== entitlement.leafHash) {
      throw new Error("Claim manifest contains an invalid winner leaf.");
    }
    if (!verifyMerkleProof(leaf, entitlement.proof.map(hexToBytes), root)) {
      throw new Error("Claim manifest contains an invalid Merkle proof.");
    }
    grossTotal += gross;
    feeTotal += fee;
    netTotal += net;
  }
  if (
    grossTotal !== BigInt(manifest.grossPrizeAmountAtomic) ||
    feeTotal !== BigInt(manifest.claimFeeAmountAtomic) ||
    netTotal !== BigInt(manifest.netDistributionAmountAtomic) ||
    grossTotal - feeTotal !== netTotal ||
    netTotal > MAX_U64
  ) {
    throw new Error("Claim manifest totals do not reconcile.");
  }
}

export async function usdcClaimManifestChecksum(
  manifest: UsdcClaimDistributionManifest,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}
