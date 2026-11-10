import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { REWARDS_AUTOMATION_ADDRESS } from "../../shared/treasury-setup-contracts";
import { SOLANA_MAINNET_USDC_MINT } from "../../shared/usdc-claim-contracts";
import { SwapExecuteDataSchema } from "../../shared/swap-contracts";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { getRoundFeeSources } from "../accounting/runtime";
import { prepareTreasurySetup } from "./treasury-setup";
import { getJupiterReferralConfig } from "./jupiter-referral";
import { executeSwap, getSwapOrder } from "./jupiter-swap";
import {
  atomic,
  currentTreasuryOperation,
  persistTreasuryOperation,
  resolveTreasuryOperation,
  transactionResolution,
  type TreasuryOperation,
} from "./treasury-journal";

const WSOL = "So11111111111111111111111111111111111111112";
// Operating SOL is separately funded until a fee-funded reserve policy is approved.
const SOL_FLOOR = 20_000_000n;
const MAX_NETWORK_FEE = 100_000n;

export async function referralInstruction(
  name: "claimV2" | "createAdminTokenAccount",
  accounts: Record<string, PublicKey>,
) {
  const { IDL, PROGRAM_ID } = await import("@jup-ag/referral-sdk");
  const definition = IDL.instructions.find(
    (instruction) => instruction.name === name,
  );
  if (definition?.args.length !== 0)
    throw new Error("Unsupported referral instruction.");
  const keys: Record<string, PublicKey> = {
    ...accounts,
    systemProgram: SystemProgram.programId,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
  const discriminator =
    name === "claimV2" ? "claim_v2" : "create_admin_token_account";
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(
      sha256(new TextEncoder().encode(`global:${discriminator}`)).slice(0, 8),
    ),
    keys: definition.accounts.map((account) => {
      const pubkey = keys[account.name];
      if (!pubkey) throw new Error(`Missing referral account: ${account.name}`);
      return { pubkey, isWritable: account.isMut, isSigner: account.isSigner };
    }),
  });
}

function signerFor(env: Partial<Env>): Keypair {
  if (String(env.AUTOMATIC_CLAIM_SETTLEMENT_ENABLED) !== "true")
    throw new Error("Automatic treasury funding is disabled.");
  const signer = Keypair.fromSecretKey(
    bs58.decode(env.SOLANA_CLAIM_AUTOMATION_SECRET?.trim() ?? ""),
  );
  if (signer.publicKey.toBase58() !== REWARDS_AUTOMATION_ADDRESS)
    throw new Error("Treasury signer mismatch.");
  return signer;
}

function rpc(env: Partial<Env>) {
  return new Connection(readUsdcClaimConfig(env).rpcUrl, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
}

async function tokenAmount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const accounts = await connection.getTokenAccountsByOwner(
    owner,
    { mint },
    "finalized",
  );
  return accounts.value.reduce((sum, entry) => {
    if (entry.account.data.length < 165)
      throw new Error("Invalid treasury token account.");
    return sum + entry.account.data.readBigUInt64LE(64);
  }, 0n);
}

export async function snapshotRoundFees(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
) {
  const existing = await db
    .prepare("SELECT round_id FROM usdc_claim_distributions WHERE round_id = ?")
    .bind(roundId)
    .first();
  if (existing)
    throw new Error("Existing distributions cannot be funded a second time.");
  const sources = await getRoundFeeSources(env, roundId);
  for (const source of sources) {
    atomic(source.amountAtomic);
    await db
      .prepare(
        `INSERT INTO round_fee_sources (source_id, round_id, transaction_signature, mint, fee_amount_atomic)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO NOTHING`,
      )
      .bind(
        source.sourceId,
        roundId,
        source.transactionSignature,
        source.mint,
        source.amountAtomic,
      )
      .run();
  }
  const rows = await db
    .prepare(
      "SELECT mint, fee_amount_atomic FROM round_fee_sources WHERE round_id = ?",
    )
    .bind(roundId)
    .all<{ mint: string; fee_amount_atomic: string }>();
  const amounts = new Map<string, bigint>();
  for (const row of rows.results)
    amounts.set(
      row.mint,
      (amounts.get(row.mint) ?? 0n) + atomic(row.fee_amount_atomic),
    );
  return [...amounts]
    .filter(([, amount]) => amount > 0n)
    .map(([mint, amount]) => ({ mint, amountAtomic: amount.toString() }));
}

async function success(
  db: D1Database,
  roundId: string,
  kind: TreasuryOperation["kind"],
  mint: string,
) {
  return db
    .prepare(
      "SELECT * FROM treasury_operations WHERE round_id = ? AND kind = ? AND mint = ? AND status = 'FINALIZED'",
    )
    .bind(roundId, kind, mint)
    .first<TreasuryOperation>();
}

async function unspentFees(db: D1Database, mint: string) {
  const operations = await db
    .prepare(
      "SELECT * FROM treasury_operations WHERE status = 'FINALIZED' AND mint = ?",
    )
    .bind(mint)
    .all<TreasuryOperation>();
  let balance = 0n;
  const signatures: string[] = [];
  for (const op of operations.results) {
    if (op.kind === "COLLECT") {
      balance += atomic(op.output_amount_atomic ?? "0");
      signatures.push(op.signature);
    }
    if (op.kind === "CONVERT") balance -= atomic(op.input_amount_atomic);
  }
  if (mint === SOLANA_MAINNET_USDC_MINT) {
    const reserved = await db
      .prepare(
        `SELECT s.fee_amount_atomic FROM round_fee_sources s
      INNER JOIN round_usdc_funding f ON f.round_id = s.round_id WHERE s.mint = ?`,
      )
      .bind(mint)
      .all<{ fee_amount_atomic: string }>();
    for (const row of reserved.results)
      balance -= atomic(row.fee_amount_atomic);
  }
  if (balance < 0n) throw new Error("Treasury fee ledger is overdrawn.");
  return { balance, signatures };
}

async function saveSigned(
  db: D1Database,
  roundId: string,
  kind: TreasuryOperation["kind"],
  mint: string,
  input: string,
  minimum: string,
  transaction: VersionedTransaction,
  lastHeight: string,
  jupiterRequestId: string | null,
) {
  const firstSignature = transaction.signatures[0];
  if (!firstSignature || firstSignature.every((byte) => byte === 0))
    throw new Error("Treasury transaction is unsigned.");
  const signature = bs58.encode(firstSignature);
  return persistTreasuryOperation(db, {
    operation_id: `${roundId}:${kind}:${mint}:${signature}`,
    round_id: roundId,
    kind,
    mint,
    input_amount_atomic: input,
    minimum_output_atomic: minimum,
    signature,
    signed_transaction: Buffer.from(transaction.serialize()).toString("base64"),
    last_valid_block_height: lastHeight,
    jupiter_request_id: jupiterRequestId,
  });
}

/** Builds the official claim instruction without the SDK's remote fee-estimator. */
export async function prepareCollection(
  connection: Connection,
  signer: Keypair,
  referralAddress: string,
  mint: string,
) {
  const { ReferralProvider } = await import("@jup-ag/referral-sdk");
  const provider = new ReferralProvider(connection);
  const referralKey = new PublicKey(referralAddress);
  const referral = await provider.getReferralAccount(referralKey);
  if (!referral.partner.equals(signer.publicKey))
    throw new Error("Referral authorization changed.");
  const project = await provider.getProject(referral.project);
  const mintKey = new PublicKey(mint);
  const mintAccount = await connection.getAccountInfo(mintKey, "finalized");
  if (
    !mintAccount ||
    ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((p) =>
      p.equals(mintAccount.owner),
    )
  )
    throw new Error("Invalid fee mint.");
  const tokenProgram = mintAccount.owner;
  const partnerToken = getAssociatedTokenAddressSync(
    mintKey,
    signer.publicKey,
    true,
    tokenProgram,
  );
  const adminToken = getAssociatedTokenAddressSync(
    mintKey,
    project.admin,
    true,
    tokenProgram,
  );
  const referralToken = provider.getReferralTokenAccountPubKeyV2({
    referralAccountPubKey: referralKey,
    mint: mintKey,
    tokenProgramId: tokenProgram,
  });
  const adminInstruction = await referralInstruction(
    "createAdminTokenAccount",
    {
      project: referral.project,
      projectAuthority: provider.getProjectAuthorityPubKey(project),
      admin: project.admin,
      projectAdminTokenAccount: adminToken,
      mint: mintKey,
      tokenProgram,
    },
  );
  const claim = await referralInstruction("claimV2", {
    payer: signer.publicKey,
    project: referral.project,
    admin: project.admin,
    projectAdminTokenAccount: adminToken,
    referralAccount: referralKey,
    referralTokenAccount: referralToken,
    partner: signer.publicKey,
    partnerTokenAccount: partnerToken,
    mint: mintKey,
    systemProgram: SystemProgram.programId,
    tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  });
  const lifetime = await connection.getLatestBlockhash("finalized");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: lifetime.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
        createAssociatedTokenAccountIdempotentInstruction(
          signer.publicKey,
          partnerToken,
          signer.publicKey,
          mintKey,
          tokenProgram,
        ),
        adminInstruction,
        claim,
      ],
    }).compileToV0Message(),
  );
  transaction.sign([signer]);
  return { transaction, lifetime };
}

async function broadcast(
  db: D1Database,
  env: Partial<Env>,
  operation: TreasuryOperation,
): Promise<void> {
  if (operation.status !== "SIGNED") return;
  if (operation.kind === "CONVERT") {
    if (!operation.jupiter_request_id)
      throw new Error("Conversion request ID missing.");
    const result = await executeSwap(
      {
        signedTransaction: operation.signed_transaction,
        requestId: operation.jupiter_request_id,
        lastValidBlockHeight: operation.last_valid_block_height,
        market: "crypto",
        taker: REWARDS_AUTOMATION_ADDRESS,
      },
      env.JUPITER_API_KEY,
    );
    if (
      result.status !== "Success" ||
      result.code !== 0 ||
      result.signature !== operation.signature
    ) {
      throw new Error(
        "Jupiter has not confirmed the persisted conversion. Retaining the operation for reconciliation.",
      );
    }
    if (
      result.totalInputAmount === null ||
      atomic(result.totalInputAmount) !==
        atomic(operation.input_amount_atomic) ||
      result.totalOutputAmount === null ||
      atomic(result.totalOutputAmount) < atomic(operation.minimum_output_atomic)
    ) {
      throw new Error(
        "Jupiter conversion accounting differs from the signed intent.",
      );
    }
    await db
      .prepare(
        "UPDATE treasury_operations SET jupiter_result_json = ? WHERE operation_id = ? AND status = 'SIGNED'",
      )
      .bind(JSON.stringify(result), operation.operation_id)
      .run();
  } else {
    const signature = await rpc(env).sendRawTransaction(
      Buffer.from(operation.signed_transaction, "base64"),
      { skipPreflight: false, maxRetries: 2, preflightCommitment: "confirmed" },
    );
    if (signature !== operation.signature)
      throw new Error("Treasury transaction signature mismatch.");
  }
}

export async function reconcileTreasuryFunding(
  db: D1Database,
  env: Partial<Env>,
): Promise<boolean> {
  signerFor(env);
  const operation = await currentTreasuryOperation(db);
  if (!operation) return true;
  const connection = rpc(env);
  const resolution = await transactionResolution(
    connection,
    operation.signature,
    operation.last_valid_block_height,
  );
  if (resolution === "PENDING") {
    await broadcast(db, env, operation);
    return false;
  }
  if (resolution !== "FINALIZED") {
    await resolveTreasuryOperation(db, operation, resolution, null);
    return false;
  }
  const tx = await connection.getTransaction(operation.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta || tx.meta.err)
    throw new Error("Finalized treasury transaction evidence is unavailable.");
  const meta = tx.meta;
  const delta = (mint: string) => {
    const sum = (balances: typeof meta.preTokenBalances) =>
      (balances ?? []).reduce(
        (total, b) =>
          b.owner === REWARDS_AUTOMATION_ADDRESS && b.mint === mint
            ? total + atomic(b.uiTokenAmount.amount)
            : total,
        0n,
      );
    return sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
  };
  let output: bigint;
  if (operation.kind === "CONVERT") {
    if (!operation.jupiter_result_json) {
      await broadcast(db, env, operation);
      return false;
    }
    const result = SwapExecuteDataSchema.parse(
      JSON.parse(operation.jupiter_result_json),
    );
    output = delta(SOLANA_MAINNET_USDC_MINT);
    if (
      result.signature !== operation.signature ||
      result.status !== "Success" ||
      result.code !== 0 ||
      result.totalOutputAmount === null ||
      output !== atomic(result.totalOutputAmount)
    )
      throw new Error(
        "Finalized USDC proceeds differ from Jupiter confirmation.",
      );
    if (
      operation.mint !== WSOL &&
      -delta(operation.mint) !== atomic(operation.input_amount_atomic)
    )
      throw new Error(
        "Conversion token debit differs from the reserved fee lot.",
      );
  } else if (operation.kind === "UNWRAP") {
    output = -delta(WSOL);
    if (output !== atomic(operation.input_amount_atomic))
      throw new Error(
        "Wrapped SOL reconciliation differs from the signed amount.",
      );
  } else {
    output = delta(operation.mint);
  }
  await resolveTreasuryOperation(db, operation, "FINALIZED", output.toString());
  return true;
}

/** One resumable step. Calling again never creates a second unresolved spend. */
export async function advanceRoundFunding(
  db: D1Database,
  env: Partial<Env>,
  roundId: string,
): Promise<{ ready: boolean; amountAtomic?: string }> {
  const signer = signerFor(env);
  const connection = rpc(env);
  const setup = await prepareTreasurySetup(env, false);
  if (!setup.authorized)
    throw new Error("Treasury authorization is not finalized.");
  await db
    .prepare(
      "INSERT INTO treasury_round_lock (singleton, round_id) VALUES (1, ?) ON CONFLICT(singleton) DO NOTHING",
    )
    .bind(roundId)
    .run();
  const lock = await db
    .prepare("SELECT round_id FROM treasury_round_lock WHERE singleton = 1")
    .first<{ round_id: string }>();
  if (lock?.round_id !== roundId)
    throw new Error(
      "Another round is being funded. Waiting for its treasury reconciliation.",
    );
  if (!(await reconcileTreasuryFunding(db, env))) return { ready: false };
  const funded = await db
    .prepare("SELECT amount_atomic FROM round_usdc_funding WHERE round_id = ?")
    .bind(roundId)
    .first<{ amount_atomic: string }>();
  if (funded) {
    await db
      .prepare(
        "DELETE FROM treasury_round_lock WHERE singleton = 1 AND round_id = ?",
      )
      .bind(roundId)
      .run();
    return { ready: true, amountAtomic: funded.amount_atomic };
  }
  const fees = await snapshotRoundFees(db, env, roundId);
  if (fees.length === 0)
    throw new Error("This round has no verified fee sources.");
  let totalUsdc = 0n;
  const evidence: string[] = [];
  for (const fee of fees) {
    const converted = await success(db, roundId, "CONVERT", fee.mint);
    if (converted) {
      totalUsdc += atomic(converted.output_amount_atomic ?? "0");
      evidence.push(converted.signature);
      continue;
    }
    const collected = await success(db, roundId, "COLLECT", fee.mint);
    const available = await unspentFees(db, fee.mint);
    if (available.balance < atomic(fee.amountAtomic)) {
      if (collected)
        throw new Error(
          "Collected fees cannot cover this round. Historical treasury activity needs reconciliation.",
        );
      const sol = BigInt(
        await connection.getBalance(signer.publicKey, "finalized"),
      );
      if (sol < SOL_FLOOR + 5_000_000n)
        throw new Error(
          "Operating SOL reserve is low. No prize fees were deducted.",
        );
      const referral = getJupiterReferralConfig(env);
      if (!referral) throw new Error("Referral configuration missing.");
      const built = await prepareCollection(
        connection,
        signer,
        referral.account,
        fee.mint,
      );
      const saved = await saveSigned(
        db,
        roundId,
        "COLLECT",
        fee.mint,
        "0",
        "0",
        built.transaction,
        String(built.lifetime.lastValidBlockHeight),
        null,
      );
      await broadcast(db, env, saved);
      return { ready: false };
    }
    if (fee.mint === SOLANA_MAINNET_USDC_MINT) {
      totalUsdc += atomic(fee.amountAtomic);
      evidence.push(...available.signatures);
      continue;
    }
    if (fee.mint === WSOL && !(await success(db, roundId, "UNWRAP", WSOL))) {
      const account = getAssociatedTokenAddressSync(
        new PublicKey(WSOL),
        signer.publicKey,
      );
      const amount = await tokenAmount(
        connection,
        signer.publicKey,
        new PublicKey(WSOL),
      );
      if (amount > 0n) {
        const lifetime = await connection.getLatestBlockhash("finalized");
        const transaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: signer.publicKey,
            recentBlockhash: lifetime.blockhash,
            instructions: [
              createCloseAccountInstruction(
                account,
                signer.publicKey,
                signer.publicKey,
              ),
            ],
          }).compileToV0Message(),
        );
        transaction.sign([signer]);
        const saved = await saveSigned(
          db,
          roundId,
          "UNWRAP",
          WSOL,
          amount.toString(),
          amount.toString(),
          transaction,
          String(lifetime.lastValidBlockHeight),
          null,
        );
        await broadcast(db, env, saved);
        return { ready: false };
      }
    }
    const sol = BigInt(
      await connection.getBalance(signer.publicKey, "finalized"),
    );
    if (
      sol <
      SOL_FLOOR +
        MAX_NETWORK_FEE +
        (fee.mint === WSOL ? atomic(fee.amountAtomic) : 0n)
    )
      throw new Error(
        "Conversion would consume the separately funded SOL reserve.",
      );
    if (
      fee.mint !== WSOL &&
      (await tokenAmount(
        connection,
        signer.publicKey,
        new PublicKey(fee.mint),
      )) < atomic(fee.amountAtomic)
    )
      throw new Error("Fee token balance is insufficient.");
    const order = await getSwapOrder(
      {
        market: "crypto",
        inputMint: fee.mint,
        outputMint: SOLANA_MAINNET_USDC_MINT,
        amount: fee.amountAtomic,
        taker: REWARDS_AUTOMATION_ADDRESS,
      },
      env.JUPITER_API_KEY,
    );
    if (
      !order.transaction ||
      !order.lastValidBlockHeight ||
      order.inAmount !== fee.amountAtomic ||
      order.inputMint !== fee.mint ||
      order.outputMint !== SOLANA_MAINNET_USDC_MINT ||
      order.referralAccount !== null ||
      !order.otherAmountThreshold ||
      atomic(order.outAmount) <= 0n ||
      atomic(order.otherAmountThreshold) * 10_000n <
        atomic(order.outAmount) * 9_950n
    )
      throw new Error("Conversion quote failed the 0.5% slippage guard.");
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(order.transaction, "base64"),
    );
    if (!transaction.message.staticAccountKeys[0]?.equals(signer.publicKey))
      throw new Error("Jupiter does not request the treasury signature.");
    const feeQuote = await connection.getFeeForMessage(
      transaction.message,
      "finalized",
    );
    if (
      feeQuote.value === null ||
      !Number.isSafeInteger(feeQuote.value) ||
      BigInt(feeQuote.value) > MAX_NETWORK_FEE
    ) {
      throw new Error("Conversion network fee exceeds the operating budget.");
    }
    const impact = order.priceImpactPct?.match(/^-?(\d+)(?:\.(\d+))?$/);
    if (
      !impact?.[1] ||
      BigInt(`${impact[1]}${impact[2] ?? ""}`) >
        10n ** BigInt((impact[2] ?? "").length)
    ) {
      throw new Error("Conversion price impact exceeds 1% or is unavailable.");
    }
    if (
      order.rentFeeLamports === null ||
      atomic(order.rentFeeLamports) > 5_000_000n
    )
      throw new Error("Conversion account rent exceeds the operating budget.");
    transaction.sign([signer]);
    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      accounts: {
        encoding: "base64",
        addresses: [signer.publicKey.toBase58()],
      },
    });
    const simulatedBalance = simulation.value.accounts?.[0]?.lamports;
    if (
      simulation.value.err ||
      simulatedBalance === undefined ||
      !Number.isSafeInteger(simulatedBalance)
    )
      throw new Error("Treasury conversion simulation failed.");
    const maximumDebit =
      (fee.mint === WSOL ? atomic(fee.amountAtomic) : 0n) +
      MAX_NETWORK_FEE +
      atomic(order.rentFeeLamports);
    if (
      sol - BigInt(simulatedBalance) > maximumDebit ||
      BigInt(simulatedBalance) < SOL_FLOOR
    )
      throw new Error("Simulated conversion exceeds the authorized SOL debit.");
    const saved = await saveSigned(
      db,
      roundId,
      "CONVERT",
      fee.mint,
      fee.amountAtomic,
      order.otherAmountThreshold,
      transaction,
      order.lastValidBlockHeight,
      order.requestId,
    );
    await broadcast(db, env, saved);
    return { ready: false };
  }
  if (totalUsdc <= 0n)
    throw new Error("No confirmed USDC proceeds are available for prizes.");
  await db.batch([
    db
      .prepare(
        `INSERT INTO round_usdc_funding (round_id,authority_address,amount_atomic,evidence_json,reserved_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(round_id) DO NOTHING`,
      )
      .bind(
        roundId,
        REWARDS_AUTOMATION_ADDRESS,
        totalUsdc.toString(),
        JSON.stringify(evidence),
        new Date().toISOString(),
      ),
    db
      .prepare(
        "DELETE FROM treasury_round_lock WHERE singleton = 1 AND round_id = ?",
      )
      .bind(roundId),
  ]);
  return { ready: true, amountAtomic: totalUsdc.toString() };
}
