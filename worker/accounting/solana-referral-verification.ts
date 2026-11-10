import { z } from "zod";

import type {
  JupiterSwapExecutionEvidence,
  JupiterSwapOrderEvidence,
} from "../../shared/accounting-contracts";
import { ApiFailure } from "../lib/http";

const HELIUS_MAINNET_RPC_URL = "https://mainnet.helius-rpc.com/";
const RPC_TIMEOUT_MS = 8_000;
const BPS_DENOMINATOR = 10_000n;
const STABLECOIN_DECIMALS = 6;
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLECOIN_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

const tokenBalanceSchema = z.object({
  accountIndex: z.number().int().nonnegative(),
  mint: z.string().min(32).max(44),
  owner: z.string().min(32).max(44).optional(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }),
});

const transactionResultSchema = z
  .object({
    blockTime: z.number().int().nonnegative(),
    meta: z.object({
      err: z.unknown().nullable(),
      preBalances: z.array(z.number().int().nonnegative()),
      postBalances: z.array(z.number().int().nonnegative()),
      preTokenBalances: z.array(tokenBalanceSchema).optional().default([]),
      postTokenBalances: z.array(tokenBalanceSchema).optional().default([]),
    }),
    transaction: z.object({
      message: z.object({
        accountKeys: z.array(
          z.object({
            pubkey: z.string().min(32).max(44),
            signer: z.boolean(),
          }),
        ),
      }),
    }),
  })
  .nullable();

const rpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

interface ReferralTokenBalance {
  owner: string;
  mint: string;
  amount: bigint;
}

export interface FinalizedSolanaTransactionEvidence {
  transactionHash: string;
  confirmedAt: string;
  signerAddresses: string[];
  preTokenBalances: ReferralTokenBalance[];
  postTokenBalances: ReferralTokenBalance[];
  nativeTokenBalanceChanges?: ReferralTokenBalance[];
}

export interface UnlinkedRecoveryConfig {
  referralAccount: string;
  referralFeeBps: number;
  partnerShareBps: number;
}

interface ReferralFeeVerificationOptions {
  maxQuoteVariationBps?: number;
  execution?: JupiterSwapExecutionEvidence;
}

function tokenBalances(
  values: z.infer<typeof tokenBalanceSchema>[],
): ReferralTokenBalance[] {
  return values.flatMap((value) =>
    value.owner
      ? [
          {
            owner: value.owner,
            mint: value.mint,
            amount: BigInt(value.uiTokenAmount.amount),
          },
        ]
      : [],
  );
}

function summedBalance(
  values: ReferralTokenBalance[],
  owner: string,
  mint: string,
): bigint {
  return values.reduce(
    (total, value) =>
      value.owner === owner && value.mint === mint
        ? total + value.amount
        : total,
    0n,
  );
}

function atomicStablecoinToUsdDecimal(amountAtomic: bigint): string {
  const denominator = 10n ** BigInt(STABLECOIN_DECIMALS);
  const whole = amountAtomic / denominator;
  const fractional = (amountAtomic % denominator)
    .toString()
    .padStart(STABLECOIN_DECIMALS, "0");
  return `${whole.toString()}.${fractional}`;
}

function positiveOwnerMintDeltas(
  before: ReferralTokenBalance[],
  after: ReferralTokenBalance[],
  owners: string[],
): ReferralTokenBalance[] {
  const pairs = new Map<string, { owner: string; mint: string }>();
  for (const balance of [...before, ...after]) {
    if (owners.includes(balance.owner)) {
      pairs.set(`${balance.owner}:${balance.mint}`, {
        owner: balance.owner,
        mint: balance.mint,
      });
    }
  }
  return [...pairs.values()].flatMap(({ owner, mint }) => {
    const delta =
      summedBalance(after, owner, mint) - summedBalance(before, owner, mint);
    return delta > 0n ? [{ owner, mint, amount: delta }] : [];
  });
}

function stablecoinSignerDebits(
  transaction: FinalizedSolanaTransactionEvidence,
): ReferralTokenBalance[] {
  return positiveOwnerMintDeltas(
    transaction.postTokenBalances,
    transaction.preTokenBalances,
    transaction.signerAddresses,
  ).filter((balance) => STABLECOIN_MINTS.has(balance.mint));
}

function referralCreditAmount(
  transaction: FinalizedSolanaTransactionEvidence,
  owner: string,
  mint: string,
): bigint {
  if (mint === WRAPPED_SOL_MINT && transaction.nativeTokenBalanceChanges) {
    return summedBalance(transaction.nativeTokenBalanceChanges, owner, mint);
  }
  return (
    summedBalance(transaction.postTokenBalances, owner, mint) -
    summedBalance(transaction.preTokenBalances, owner, mint)
  );
}

function nativeTokenBalanceChanges(
  meta: NonNullable<z.infer<typeof transactionResultSchema>>["meta"],
): ReferralTokenBalance[] {
  return meta.postTokenBalances.flatMap((after) => {
    if (after.mint !== WRAPPED_SOL_MINT || !after.owner) return [];
    const before = meta.preTokenBalances.find(
      (balance) => balance.accountIndex === after.accountIndex,
    );
    if (
      before &&
      (before.mint !== after.mint || before.owner !== after.owner)
    ) {
      throw new Error("The native referral token account changed ownership.");
    }
    const preLamports = meta.preBalances[after.accountIndex];
    const postLamports = meta.postBalances[after.accountIndex];
    if (preLamports === undefined || postLamports === undefined) {
      throw new Error("Solana native token balance evidence is incomplete.");
    }
    const tokenDelta =
      BigInt(after.uiTokenAmount.amount) -
      BigInt(before?.uiTokenAmount.amount ?? "0");
    const lamportDelta = BigInt(postLamports) - BigInt(preLamports);
    // syncNative can recognize SOL deposited before this transaction. Only
    // credit funds received now; the token delta also excludes creation rent.
    return [
      {
        owner: after.owner,
        mint: after.mint,
        amount: tokenDelta < lamportDelta ? tokenDelta : lamportDelta,
      },
    ];
  });
}

export function buildStablecoinRecoveryOrder(
  transaction: FinalizedSolanaTransactionEvidence,
  config: UnlinkedRecoveryConfig,
): JupiterSwapOrderEvidence | null {
  const stablecoinDebits = stablecoinSignerDebits(transaction);
  const referralCredits = positiveOwnerMintDeltas(
    transaction.preTokenBalances,
    transaction.postTokenBalances,
    [config.referralAccount],
  )
    .map((credit) => ({
      ...credit,
      amount: referralCreditAmount(transaction, credit.owner, credit.mint),
    }))
    .filter((credit) => credit.amount > 0n);
  if (stablecoinDebits.length !== 1 || referralCredits.length !== 1) {
    return null;
  }
  const stablecoinDebit = stablecoinDebits[0];
  const referralCredit = referralCredits[0];
  if (!stablecoinDebit || !referralCredit || config.referralFeeBps <= 0) {
    return null;
  }
  const feeBasisAmountAtomic =
    (referralCredit.amount * BPS_DENOMINATOR) / BigInt(config.referralFeeBps);
  if (feeBasisAmountAtomic <= 0n) return null;

  const confirmedAtMs = Date.parse(transaction.confirmedAt);
  const registeredAt = new Date(confirmedAtMs - 60_000).toISOString();
  const expiresAt = new Date(confirmedAtMs + 60_000).toISOString();
  return {
    requestId: `finalized-recovery:${transaction.transactionHash}`,
    walletAddress: stablecoinDebit.owner,
    inputMint: stablecoinDebit.mint,
    outputMint: referralCredit.mint,
    inputAmountAtomic: stablecoinDebit.amount.toString(),
    outputAmountAtomic: feeBasisAmountAtomic.toString(),
    feeMint: referralCredit.mint,
    quotedFeeAmountAtomic: referralCredit.amount.toString(),
    referralAccount: config.referralAccount,
    referralFeeBps: config.referralFeeBps,
    partnerShareBps: config.partnerShareBps,
    valuationUsdDecimal: atomicStablecoinToUsdDecimal(stablecoinDebit.amount),
    valuationAmountAtomic: feeBasisAmountAtomic.toString(),
    rewardValuationUsdDecimal: atomicStablecoinToUsdDecimal(
      stablecoinDebit.amount,
    ),
    registeredAt,
    expiresAt,
  };
}

function withinAtomicTolerance(left: bigint, right: bigint): boolean {
  const difference = left >= right ? left - right : right - left;
  return difference <= 2n;
}

function withinBpsTolerance(
  observed: bigint,
  expected: bigint,
  maxVariationBps: number,
): boolean {
  if (withinAtomicTolerance(observed, expected)) return true;
  const allowedDifference =
    (expected * BigInt(maxVariationBps) + BPS_DENOMINATOR - 1n) /
    BPS_DENOMINATOR;
  const difference =
    observed >= expected ? observed - expected : expected - observed;
  return difference <= allowedDifference + 2n;
}

function feeMatchesRegisteredOrder(
  order: JupiterSwapOrderEvidence,
  feeAmountAtomic: bigint,
  maxQuoteVariationBps: number,
): boolean {
  if (order.quotedFeeAmountAtomic !== null) {
    return withinBpsTolerance(
      feeAmountAtomic,
      BigInt(order.quotedFeeAmountAtomic),
      maxQuoteVariationBps,
    );
  }
  const feeBasisAmount = BigInt(order.valuationAmountAtomic);
  const feeBps = BigInt(order.referralFeeBps);
  const grossBasisFee = (feeBasisAmount * feeBps) / 10_000n;
  const netBasisFee = (feeBasisAmount * feeBps) / (10_000n - feeBps);
  return (
    withinBpsTolerance(feeAmountAtomic, grossBasisFee, maxQuoteVariationBps) ||
    withinBpsTolerance(feeAmountAtomic, netBasisFee, maxQuoteVariationBps)
  );
}

export async function getFinalizedSolanaTransactionEvidence(
  transactionHash: string,
  heliusApiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<FinalizedSolanaTransactionEvidence | null> {
  const apiKey = heliusApiKey?.trim();
  if (!apiKey) {
    throw new ApiFailure(
      503,
      "SOLANA_VERIFICATION_NOT_CONFIGURED",
      "Confirmed-swap verification is temporarily unavailable.",
      true,
    );
  }
  const response = await fetcher(
    `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          transactionHash,
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new ApiFailure(
      502,
      "SOLANA_VERIFICATION_UNAVAILABLE",
      "Solana has not returned finalized swap evidence yet.",
      true,
    );
  }
  const envelope = rpcEnvelopeSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!envelope.success || envelope.data.error) {
    throw new ApiFailure(
      502,
      "SOLANA_VERIFICATION_UNAVAILABLE",
      "Solana has not returned finalized swap evidence yet.",
      true,
    );
  }
  const parsed = transactionResultSchema.safeParse(envelope.data.result);
  if (!parsed.success) {
    throw new ApiFailure(
      502,
      "SOLANA_VERIFICATION_SCHEMA_MISMATCH",
      "Solana returned unreadable swap evidence.",
      true,
    );
  }
  if (parsed.data === null) return null;
  if (parsed.data.meta.err !== null) {
    throw new ApiFailure(
      409,
      "SOLANA_TRANSACTION_FAILED",
      "The submitted Solana transaction did not finalize successfully.",
      false,
    );
  }
  return {
    transactionHash,
    confirmedAt: new Date(parsed.data.blockTime * 1_000).toISOString(),
    signerAddresses: parsed.data.transaction.message.accountKeys
      .filter((account) => account.signer)
      .map((account) => account.pubkey),
    preTokenBalances: tokenBalances(parsed.data.meta.preTokenBalances),
    postTokenBalances: tokenBalances(parsed.data.meta.postTokenBalances),
    nativeTokenBalanceChanges: nativeTokenBalanceChanges(parsed.data.meta),
  };
}

export function verifiedReferralFeeFromTransaction(
  transaction: FinalizedSolanaTransactionEvidence,
  order: JupiterSwapOrderEvidence,
  options: ReferralFeeVerificationOptions = {},
): bigint {
  if (!transaction.signerAddresses.includes(order.walletAddress)) {
    throw new Error("The registered Walletor wallet did not sign this swap.");
  }
  const confirmedAtMs = Date.parse(transaction.confirmedAt);
  if (
    confirmedAtMs < Date.parse(order.registeredAt) ||
    confirmedAtMs > Date.parse(order.expiresAt)
  ) {
    throw new Error(
      "The finalized swap is outside its registered order window.",
    );
  }
  const feeAmountAtomic = referralCreditAmount(
    transaction,
    order.referralAccount,
    order.feeMint,
  );
  if (feeAmountAtomic <= 0n) {
    throw new Error(
      "The finalized swap did not credit the referral fee account.",
    );
  }
  const maxQuoteVariationBps = options.maxQuoteVariationBps ?? 0;
  if (
    !Number.isInteger(maxQuoteVariationBps) ||
    maxQuoteVariationBps < 0 ||
    maxQuoteVariationBps > 10_000
  ) {
    throw new Error("Referral-fee variation tolerance is invalid.");
  }
  if (
    !feeMatchesRegisteredOrder(order, feeAmountAtomic, maxQuoteVariationBps) &&
    !feeMatchesLinkedExecution(
      transaction,
      order,
      feeAmountAtomic,
      options.execution,
    )
  ) {
    throw new Error(
      "The finalized referral fee does not match this Walletor order.",
    );
  }
  return feeAmountAtomic;
}

/** A server-recorded Jupiter execution can replace a stale output quote.
 * The finalized recipient balance remains the authoritative credited amount.
 */
function feeMatchesLinkedExecution(
  transaction: FinalizedSolanaTransactionEvidence,
  order: JupiterSwapOrderEvidence,
  feeAmountAtomic: bigint,
  execution: JupiterSwapExecutionEvidence | undefined,
): boolean {
  if (
    execution?.verificationSource !== "JUPITER_EXECUTE" ||
    execution.requestId !== order.requestId ||
    execution.transactionHash !== transaction.transactionHash ||
    order.feeMint !== order.outputMint ||
    execution.inputAmountResult !== order.inputAmountAtomic ||
    execution.outputAmountResult === null
  )
    return false;

  return feeMatchesRegisteredOrder(
    {
      ...order,
      quotedFeeAmountAtomic: null,
      valuationAmountAtomic: execution.outputAmountResult,
    },
    feeAmountAtomic,
    0,
  );
}
