import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import {
  bytesHex,
  drawAddress,
  hexBytes,
  instructionDiscriminator,
  MagicBlockEvidenceSchema,
  parseDrawAccount,
  requestDrawInstruction,
  roundHash,
  snapshotHash,
  WALLETOR_RANDOMNESS_PROGRAM_ID,
  usesMagicBlock,
  type MagicBlockEvidence,
} from "../../shared/magicblock-randomness";
import type { PublicPrizeDrawSnapshot } from "../../shared/prize-draw-contracts";
import { readUsdcClaimConfig } from "../accounting/usdc-claim-config";
import { ApiFailure } from "../lib/http";

type Environment = Parameters<typeof readUsdcClaimConfig>[0] & {
  MAGICBLOCK_ENABLED?: string;
  MAGICBLOCK_FIRST_ROUND_AT?: string;
  DB?: D1Database;
};
interface Binding {
  round_id: string;
  authority_address: string;
  randomness_account: string;
  snapshot_hash: string;
  minimum_request_slot: string;
}
const integer = z.number().int().nonnegative().refine(Number.isSafeInteger);
const rpcAccount = z.object({
  owner: z.string(),
  executable: z.boolean(),
  data: z.tuple([z.string(), z.literal("base64")]),
});
const instruction = z.object({
  programIdIndex: integer,
  accounts: z.array(integer),
  data: z.string(),
});
const transactionSchema = z.object({
  slot: integer,
  meta: z.object({
    err: z.null(),
    loadedAddresses: z
      .object({ writable: z.array(z.string()), readonly: z.array(z.string()) })
      .optional(),
    innerInstructions: z
      .array(z.object({ instructions: z.array(instruction) }))
      .nullable()
      .optional(),
  }),
  transaction: z.object({
    signatures: z.array(z.string()),
    message: z.object({
      header: z.object({ numRequiredSignatures: integer }),
      accountKeys: z.array(z.string()),
      instructions: z.array(instruction),
    }),
  }),
});

export function isMagicBlockRound(
  env: Pick<Environment, "MAGICBLOCK_FIRST_ROUND_AT">,
  roundId: string,
): boolean {
  return usesMagicBlock(roundId, env.MAGICBLOCK_FIRST_ROUND_AT);
}

export function magicBlockSettings(env: Environment) {
  const firstRoundAt = env.MAGICBLOCK_FIRST_ROUND_AT?.trim() ?? "";
  if (firstRoundAt) usesMagicBlock("", firstRoundAt);
  if (env.MAGICBLOCK_ENABLED === "true" && !firstRoundAt)
    throw new Error(
      "MagicBlock needs a fixed first round before it can be enabled.",
    );
  return {
    magicblockEnabled: env.MAGICBLOCK_ENABLED === "true",
    magicblockFirstRoundAt: firstRoundAt.length > 0 ? firstRoundAt : null,
  };
}

function invalid(message: string): ApiFailure {
  return new ApiFailure(409, "MAGICBLOCK_DRAW_INVALID", message, false);
}

// Limit bytes while reading; do not buffer an unbounded RPC response first.
async function rpc(
  env: Environment,
  method: string,
  params: unknown[],
  fetcher: typeof fetch,
): Promise<unknown> {
  const { rpcUrl } = readUsdcClaimConfig(env);
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new ApiFailure(
      502,
      "MAGICBLOCK_RPC_UNAVAILABLE",
      "Solana is unavailable. The existing draw request is preserved; retry checking its status.",
      true,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1000000) {
        await reader.cancel();
        throw new Error("Solana response exceeds the allowed size.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const payload = z
    .object({ result: z.unknown(), error: z.unknown().optional() })
    .parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (payload.error !== undefined || payload.result === undefined)
    throw new Error("Solana rejected the randomness verification request.");
  return payload.result;
}

async function assertMainnet(env: Environment, fetcher: typeof fetch) {
  if (
    (await rpc(env, "getGenesisHash", [], fetcher)) !==
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
  )
    throw invalid("MagicBlock funding verification requires Solana mainnet.");
}

async function readBinding(
  env: Environment,
  roundId: string,
): Promise<Binding> {
  if (!env.DB) throw new Error("The randomness database is unavailable.");
  const binding = await env.DB.prepare(
    "SELECT round_id, authority_address, randomness_account, snapshot_hash, minimum_request_slot FROM magicblock_draw_requests WHERE round_id = ?",
  )
    .bind(roundId)
    .first<Binding>();
  if (!binding)
    throw invalid("No locked MagicBlock request exists for this round.");
  if (
    binding.randomness_account !==
    drawAddress(binding.authority_address, roundId)[0].toBase58()
  )
    throw invalid("The stored draw address is invalid.");
  return binding;
}

export async function assertMagicBlockSnapshot(
  env: Environment,
  snapshot: PublicPrizeDrawSnapshot,
): Promise<void> {
  const binding = await readBinding(env, snapshot.roundId);
  if (binding.snapshot_hash !== snapshotHash(snapshot))
    throw invalid(
      "The locked snapshot differs from the requested draw. Funding is blocked.",
    );
}

async function readDraw(
  env: Environment,
  binding: Binding,
  fetcher: typeof fetch,
  commitment: "confirmed" | "finalized" = "finalized",
) {
  const result = z
    .object({ value: rpcAccount.nullable() })
    .parse(
      await rpc(
        env,
        "getAccountInfo",
        [binding.randomness_account, { commitment, encoding: "base64" }],
        fetcher,
      ),
    );
  if (!result.value) return null;
  const account = result.value;
  const data = Uint8Array.from(atob(account.data[0]), (char) =>
    char.charCodeAt(0),
  );
  const state = parseDrawAccount(
    data,
    account.owner,
    account.executable,
    binding.authority_address,
    binding.round_id,
    binding.snapshot_hash,
  );
  if (
    !/^[1-9]\d*$/.test(binding.minimum_request_slot) ||
    state.requestedSlot < BigInt(binding.minimum_request_slot)
  )
    throw invalid(
      "The randomness request predates the locked snapshot reservation.",
    );
  return state;
}

async function verifyTransaction(
  env: Environment,
  binding: Binding,
  signature: string,
  slot: bigint,
  kind: "request" | "callback",
  randomness: string,
  fetcher: typeof fetch,
  allowUnrelated = false,
): Promise<boolean> {
  if (bs58.decode(signature).length !== 64)
    throw invalid("Invalid randomness transaction signature.");
  const tx = transactionSchema.parse(
    await rpc(
      env,
      "getTransaction",
      [
        signature,
        {
          commitment: "finalized",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        },
      ],
      fetcher,
    ),
  );
  if (BigInt(tx.slot) !== slot || tx.transaction.signatures[0] !== signature)
    throw invalid("Randomness transaction does not match the finalized draw.");
  const message = tx.transaction.message;
  const keys = [
    ...message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  const expectedData =
    kind === "request"
      ? requestDrawInstruction(
          binding.authority_address,
          binding.round_id,
          binding.snapshot_hash,
        ).data
      : Uint8Array.from([
          ...instructionDiscriminator("consume_draw"),
          ...hexBytes(randomness),
          ...roundHash(binding.round_id),
          ...hexBytes(binding.snapshot_hash),
        ]);
  const instructions =
    kind === "request"
      ? message.instructions
      : (tx.meta.innerInstructions ?? []).flatMap(
          (group) => group.instructions,
        );
  if (
    !instructions.some(
      (ix) =>
        keys[ix.programIdIndex] === WALLETOR_RANDOMNESS_PROGRAM_ID &&
        ix.accounts.some(
          (index) => keys[index] === binding.randomness_account,
        ) &&
        bytesHex(bs58.decode(ix.data)) === bytesHex(expectedData),
    )
  ) {
    if (allowUnrelated) return false;
    throw invalid("The expected randomness instruction is missing.");
  }
  if (
    kind === "request" &&
    !message.accountKeys
      .slice(0, message.header.numRequiredSignatures)
      .includes(binding.authority_address)
  )
    throw invalid("The draw authority did not sign this request.");
  return true;
}

export async function prepareMagicBlockRequest(
  env: Environment,
  snapshot: PublicPrizeDrawSnapshot,
  actorEmail: string,
  fetcher: typeof fetch = fetch,
) {
  const config = readUsdcClaimConfig(env);
  if (
    env.MAGICBLOCK_ENABLED !== "true" ||
    !isMagicBlockRound(env, snapshot.roundId)
  )
    throw invalid(
      "MagicBlock is not enabled for this round. Historical draws retain their original provider.",
    );
  if (
    !config.fundingEnabled ||
    snapshot.status !== "SNAPSHOT_LOCKED" ||
    snapshot.participantCount < 1 ||
    BigInt(snapshot.grossPoolCents) < 1n
  )
    throw invalid("This round is not ready for a randomness request.");
  if (!env.DB) throw new Error("The randomness database is unavailable.");
  await assertMainnet(env, fetcher);
  const program = z
    .object({ value: rpcAccount.nullable() })
    .parse(
      await rpc(
        env,
        "getAccountInfo",
        [
          WALLETOR_RANDOMNESS_PROGRAM_ID,
          { commitment: "finalized", encoding: "base64" },
        ],
        fetcher,
      ),
    );
  if (!program.value?.executable)
    throw invalid(
      "The Walletor MagicBlock program has not been deployed. No transaction was prepared.",
    );
  const digest = snapshotHash(snapshot);
  const address = drawAddress(
    config.authorityAddress,
    snapshot.roundId,
  )[0].toBase58();
  const existingDistribution = await env.DB.prepare(
    "SELECT status FROM usdc_claim_distributions WHERE round_id = ?",
  )
    .bind(snapshot.roundId)
    .first();
  if (existingDistribution)
    throw invalid("This round already has a USDC distribution.");
  const minimumRequestSlot =
    BigInt(
      integer.parse(
        await rpc(env, "getSlot", [{ commitment: "processed" }], fetcher),
      ),
    ) + 1n;
  await env.DB.prepare(
    "INSERT INTO magicblock_draw_requests (round_id, authority_address, randomness_account, snapshot_hash, minimum_request_slot, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(round_id) DO NOTHING",
  )
    .bind(
      snapshot.roundId,
      config.authorityAddress,
      address,
      digest,
      minimumRequestSlot.toString(),
      new Date().toISOString(),
      actorEmail,
    )
    .run();
  const binding = await readBinding(env, snapshot.roundId);
  if (
    binding.snapshot_hash !== digest ||
    binding.authority_address !== config.authorityAddress ||
    binding.randomness_account !== address
  )
    throw invalid(
      "This round is already bound to a different request. It cannot be rerolled.",
    );
  const base = {
    roundId: snapshot.roundId,
    authorityAddress: config.authorityAddress,
    randomnessAccount: address,
    snapshotHash: digest,
  };
  if (await readDraw(env, binding, fetcher, "confirmed"))
    return {
      ...base,
      transaction: null,
      blockhash: null,
      lastValidBlockHeight: null,
    };
  const lifetime = z
    .object({
      value: z.object({ blockhash: z.string(), lastValidBlockHeight: integer }),
    })
    .parse(
      await rpc(
        env,
        "getLatestBlockhash",
        [{ commitment: "confirmed" }],
        fetcher,
      ),
    ).value;
  const transaction = new Transaction({
    feePayer: new PublicKey(config.authorityAddress),
    ...lifetime,
  }).add(
    requestDrawInstruction(config.authorityAddress, snapshot.roundId, digest),
  );
  return {
    ...base,
    ...lifetime,
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  };
}

export async function magicBlockStatus(
  env: Environment,
  roundId: string,
  fetcher: typeof fetch = fetch,
) {
  await assertMainnet(env, fetcher);
  const binding = await readBinding(env, roundId);
  const draw = await readDraw(env, binding, fetcher);
  const base = { roundId, randomnessAccount: binding.randomness_account };
  if (!draw)
    return {
      ...base,
      status: "NOT_REQUESTED" as const,
      randomnessCommitTransactionSignature: null,
      randomnessRevealTransactionSignature: null,
    };
  // This PDA has only request + callback transactions; no close/retry mutation exists.
  const signatures = z
    .array(z.object({ signature: z.string(), slot: integer, err: z.unknown() }))
    .parse(
      await rpc(
        env,
        "getSignaturesForAddress",
        [binding.randomness_account, { commitment: "finalized", limit: 100 }],
        fetcher,
      ),
    )
    .filter((item) => item.err === null);
  let request: string | null = null;
  let callback: string | null = null;
  for (const item of signatures) {
    if (BigInt(item.slot) === draw.requestedSlot && request === null) {
      if (
        await verifyTransaction(
          env,
          binding,
          item.signature,
          draw.requestedSlot,
          "request",
          draw.randomnessValue,
          fetcher,
          true,
        )
      )
        request = item.signature;
    }
    if (
      draw.fulfilled &&
      BigInt(item.slot) === draw.fulfilledSlot &&
      callback === null
    ) {
      if (
        await verifyTransaction(
          env,
          binding,
          item.signature,
          draw.fulfilledSlot,
          "callback",
          draw.randomnessValue,
          fetcher,
          true,
        )
      )
        callback = item.signature;
    }
  }
  return {
    ...base,
    status:
      draw.fulfilled && request && callback
        ? ("FULFILLED" as const)
        : ("PENDING" as const),
    randomnessCommitTransactionSignature: request,
    randomnessRevealTransactionSignature: callback,
  };
}

export async function verifyMagicBlockRandomness(
  env: Environment,
  input: {
    roundId: string;
    randomnessAccount: string;
    randomnessCommitTransactionSignature: string;
    randomnessRevealTransactionSignature: string;
  },
  expected?: { magicblock: MagicBlockEvidence; randomnessValue: string },
  fetcher: typeof fetch = fetch,
) {
  await assertMainnet(env, fetcher);
  const binding = await readBinding(env, input.roundId);
  if (
    input.randomnessAccount !== binding.randomness_account ||
    input.randomnessCommitTransactionSignature ===
      input.randomnessRevealTransactionSignature
  )
    throw invalid("MagicBlock evidence belongs to a different request.");
  const draw = await readDraw(env, binding, fetcher);
  if (!draw?.fulfilled)
    throw new ApiFailure(
      409,
      "MAGICBLOCK_PENDING",
      "MagicBlock randomness is awaiting a finalized callback. Check again shortly.",
      true,
    );
  const magicblock = MagicBlockEvidenceSchema.parse({
    provider: "MAGICBLOCK",
    programId: WALLETOR_RANDOMNESS_PROGRAM_ID,
    snapshotHash: binding.snapshot_hash,
  });
  if (
    expected &&
    (JSON.stringify(expected.magicblock) !== JSON.stringify(magicblock) ||
      expected.randomnessValue !== draw.randomnessValue)
  )
    throw invalid(
      "The stored MagicBlock evidence does not match the finalized draw.",
    );
  await Promise.all([
    verifyTransaction(
      env,
      binding,
      input.randomnessCommitTransactionSignature,
      draw.requestedSlot,
      "request",
      draw.randomnessValue,
      fetcher,
    ),
    verifyTransaction(
      env,
      binding,
      input.randomnessRevealTransactionSignature,
      draw.fulfilledSlot,
      "callback",
      draw.randomnessValue,
      fetcher,
    ),
  ]);
  return { magicblock, randomnessValue: draw.randomnessValue };
}
