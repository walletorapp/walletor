import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { z } from "zod";
import { SEED_DEPOSIT_ATOMIC } from "../../shared/prize-seed-contracts";
import { SOLANA_MAINNET_USDC_MINT } from "../../shared/usdc-claim-contracts";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { coordinatorRules, referralCoordinator } from "../accounting/runtime";
import { ApiFailure } from "../lib/http";

export function seedDestination(env: Partial<Env>) {
  const config = readUsdcClaimConfig(env);
  if (String(env.AUTOMATIC_CLAIM_SETTLEMENT_ENABLED) === "true") {
    throw new ApiFailure(
      409,
      "SEED_MANUAL_FUNDING_REQUIRED",
      "Daily seed funding currently requires manual distribution approval.",
      false,
    );
  }
  return {
    ...config,
    depositAccount: getAssociatedTokenAddressSync(
      new PublicKey(SOLANA_MAINNET_USDC_MINT),
      new PublicKey(config.authorityAddress),
    ).toBase58(),
  };
}

const transferSchema = z.object({
  type: z.enum(["transfer", "transferChecked"]),
  info: z.object({
    destination: z.string(),
    source: z.string(),
    authority: z.string(),
    amount: z.string().optional(),
    tokenAmount: z
      .object({ amount: z.string(), decimals: z.literal(6) })
      .optional(),
    mint: z.string().optional(),
  }),
});

/** Accept a fresh, direct deposit only; never reuse swap/referral/claim proceeds. */
export function verifySeedDepositTransaction(
  tx: ParsedTransactionWithMeta | null,
  authority: string,
  destination: string,
  requestedAt: string,
  now: Date,
): void {
  if (
    !tx?.meta ||
    tx.meta.err ||
    !tx.blockTime ||
    tx.blockTime * 1000 < Date.parse(requestedAt) ||
    tx.blockTime * 1000 > now.getTime()
  ) {
    throw new Error(
      "Deposit must be a successful finalized transfer made after preparing this reserve.",
    );
  }
  let transfers = 0;
  const keys = tx.transaction.message.accountKeys;
  const destinationIndex = keys.findIndex(
    (key) => key.pubkey.toBase58() === destination,
  );
  for (const instruction of tx.transaction.message.instructions) {
    if (instruction.programId.equals(TOKEN_PROGRAM_ID)) {
      if (!("parsed" in instruction))
        throw new Error("Unparsed reserve transfer.");
      const parsed = transferSchema.parse(instruction.parsed);
      const amount = parsed.info.amount ?? parsed.info.tokenAmount?.amount;
      if (
        parsed.info.destination !== destination ||
        amount !== SEED_DEPOSIT_ATOMIC ||
        (parsed.info.mint !== undefined &&
          parsed.info.mint !== SOLANA_MAINNET_USDC_MINT) ||
        parsed.info.authority === authority ||
        !keys.some(
          (key) =>
            key.signer && key.pubkey.toBase58() === parsed.info.authority,
        )
      ) {
        throw new Error(
          "Send exactly 700 USDC from another wallet to the distribution wallet.",
        );
      }
      const sourceIndex = keys.findIndex(
        (key) => key.pubkey.toBase58() === parsed.info.source,
      );
      const source = tx.meta.preTokenBalances?.find(
        (entry) => entry.accountIndex === sourceIndex,
      );
      if (
        source?.mint !== SOLANA_MAINNET_USDC_MINT ||
        source.owner !== parsed.info.authority
      ) {
        throw new Error(
          "Reserve source must be the sending wallet's USDC account.",
        );
      }
      transfers++;
    } else if (
      ![
        "ComputeBudget111111111111111111111111111111",
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      ].includes(instruction.programId.toBase58())
    ) {
      throw new Error(
        "Use a direct USDC transfer, not a swap, bridge, fee collection or claim.",
      );
    }
  }
  if (transfers !== 1)
    throw new Error("A single 700 USDC transfer is required.");
  const pre = tx.meta.preTokenBalances?.find(
    (entry) => entry.accountIndex === destinationIndex,
  );
  const post = tx.meta.postTokenBalances?.find(
    (entry) => entry.accountIndex === destinationIndex,
  );
  if (
    post?.owner !== authority ||
    post.mint !== SOLANA_MAINNET_USDC_MINT ||
    post.uiTokenAmount.decimals !== 6 ||
    BigInt(post.uiTokenAmount.amount) -
      BigInt(pre?.uiTokenAmount.amount ?? "0") !==
      BigInt(SEED_DEPOSIT_ATOMIC)
  ) {
    throw new Error(
      "The distribution wallet did not receive exactly 700 USDC.",
    );
  }
}

export async function getPrizeSeed(env: Partial<Env>, prepare = false) {
  const config = seedDestination(env);
  const stub = await referralCoordinator(env);
  return prepare
    ? stub.preparePrizeSeed(
        config.authorityAddress,
        config.depositAccount,
        new Date().toISOString(),
      )
    : stub.getPrizeSeedState(config.authorityAddress, config.depositAccount);
}

export async function confirmPrizeSeed(env: Partial<Env>, signature: string) {
  const config = seedDestination(env);
  const stub = await referralCoordinator(env);
  const state = await stub.getPrizeSeedState(
    config.authorityAddress,
    config.depositAccount,
  );
  if (state.depositSignature === signature) return state;
  if (state.fundedAt)
    throw new Error(
      "This seven-day reserve is already funded. Do not send another deposit.",
    );
  if (!state.requestedAt)
    throw new Error("Prepare the reserve before sending USDC.");
  const connection = new Connection(config.rpcUrl, "finalized");
  if (
    (await connection.getGenesisHash()) !==
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
  )
    throw new Error("Reserve verification requires Solana mainnet.");
  const now = new Date();
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (tx?.transaction.signatures[0] !== signature) {
    throw new Error(
      "The deposit receipt does not match the requested transaction.",
    );
  }
  verifySeedDepositTransaction(
    tx,
    config.authorityAddress,
    config.depositAccount,
    state.requestedAt,
    now,
  );
  const balance = await connection.getTokenAccountBalance(
    new PublicKey(config.depositAccount),
    "finalized",
  );
  if (
    balance.context.slot < tx.slot ||
    BigInt(balance.value.amount) < BigInt(SEED_DEPOSIT_ATOMIC)
  )
    throw new Error(
      "The distribution wallet must still hold the 700 USDC reserve.",
    );
  return stub.activatePrizeSeed(
    config.authorityAddress,
    config.depositAccount,
    signature,
    now.toISOString(),
    coordinatorRules(env),
  );
}
