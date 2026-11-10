import type { SwapOrder } from "../../shared/swap-contracts";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";

interface RwaOrderRow {
  request_id: string;
  wallet_address: string;
  input_mint: string;
  output_mint: string;
  router: string | null;
  quote_id: string | null;
  maker: string | null;
  status: "QUOTED" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "EXPIRED";
  expires_at: string;
  transaction_signature: string | null;
  created_at: string;
  updated_at: string;
}

function permitExpiry(order: SwapOrder, now: Date): string {
  const maximum = now.getTime() + 10 * 60_000;
  const numericExpiry = Number(order.expireAt);
  const rfqExpiry =
    Number.isFinite(numericExpiry) && numericExpiry > 0
      ? numericExpiry > 1_000_000_000_000
        ? numericExpiry
        : numericExpiry * 1_000
      : order.expireAt
        ? Date.parse(order.expireAt)
        : Number.NaN;
  if (Number.isFinite(rfqExpiry) && rfqExpiry > now.getTime()) {
    return new Date(Math.min(rfqExpiry, maximum)).toISOString();
  }
  return new Date(maximum).toISOString();
}

async function readPermit(
  db: D1Database,
  requestId: string,
): Promise<RwaOrderRow | null> {
  return db
    .prepare("SELECT * FROM rwa_swap_orders WHERE request_id = ?")
    .bind(requestId)
    .first<RwaOrderRow>();
}

export async function registerRwaOrderPermit(
  db: D1Database,
  order: SwapOrder,
  walletAddress: string,
  now = new Date(),
): Promise<void> {
  if (
    order.market !== "rwa" ||
    !order.transaction ||
    !isSolanaAddress(walletAddress)
  ) {
    throw new ApiFailure(
      409,
      "RWA_ORDER_NOT_PERMITTED",
      "Walletor could not create a verified RWA order permit.",
      false,
    );
  }

  const existing = await readPermit(db, order.requestId);
  if (existing) {
    if (
      existing.wallet_address !== walletAddress ||
      existing.input_mint !== order.inputMint ||
      existing.output_mint !== order.outputMint
    ) {
      throw new ApiFailure(
        409,
        "RWA_ORDER_PERMIT_MISMATCH",
        "This Jupiter order ID is already bound to another RWA trade.",
        false,
      );
    }
    return;
  }

  const createdAt = now.toISOString();
  await db
    .prepare(
      `INSERT INTO rwa_swap_orders (
        request_id, wallet_address, input_mint, output_mint, router,
        quote_id, maker, status, expires_at, transaction_signature,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUOTED', ?, NULL, ?, ?)`,
    )
    .bind(
      order.requestId,
      walletAddress,
      order.inputMint,
      order.outputMint,
      order.router,
      order.quoteId,
      order.maker,
      permitExpiry(order, now),
      createdAt,
      createdAt,
    )
    .run();
}

export async function validateRwaOrderPermit(
  db: D1Database,
  requestId: string,
  walletAddress: string | undefined,
  now = new Date(),
): Promise<void> {
  if (!walletAddress || !isSolanaAddress(walletAddress)) {
    throw new ApiFailure(
      400,
      "RWA_WALLET_REQUIRED",
      "Reconnect the Solana wallet used to request this RWA order.",
      false,
    );
  }
  const permit = await readPermit(db, requestId);
  if (permit?.wallet_address !== walletAddress) {
    throw new ApiFailure(
      409,
      "RWA_ORDER_PERMIT_INVALID",
      "Request a fresh Walletor RWA quote before submitting this trade.",
      false,
    );
  }
  if (permit.status !== "QUOTED") {
    throw new ApiFailure(
      409,
      "RWA_ORDER_ALREADY_SUBMITTED",
      "This RWA order has already been submitted. Request a fresh quote.",
      false,
    );
  }
  if (Date.parse(permit.expires_at) <= now.getTime()) {
    await db
      .prepare(
        "UPDATE rwa_swap_orders SET status = 'EXPIRED', updated_at = ? WHERE request_id = ? AND status = 'QUOTED'",
      )
      .bind(now.toISOString(), requestId)
      .run();
    throw new ApiFailure(
      409,
      "RWA_ORDER_EXPIRED",
      "This RWA quote expired. Request a fresh quote and try again.",
      false,
    );
  }
}

export async function beginRwaOrderExecution(
  db: D1Database,
  requestId: string,
  walletAddress: string,
  now = new Date(),
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE rwa_swap_orders
       SET status = 'SUBMITTED', updated_at = ?
       WHERE request_id = ? AND wallet_address = ? AND status = 'QUOTED'`,
    )
    .bind(now.toISOString(), requestId, walletAddress)
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiFailure(
      409,
      "RWA_ORDER_ALREADY_SUBMITTED",
      "This RWA order is already being submitted.",
      false,
    );
  }
}

export async function settleRwaOrderExecution(
  db: D1Database,
  requestId: string,
  confirmed: boolean,
  signature: string | null,
  now = new Date(),
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE rwa_swap_orders
       SET status = ?, transaction_signature = ?, updated_at = ?
       WHERE request_id = ? AND status = 'SUBMITTED'`,
    )
    .bind(
      confirmed ? "CONFIRMED" : "FAILED",
      confirmed ? signature : null,
      now.toISOString(),
      requestId,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new Error("RWA order permit could not be settled exactly once.");
  }
}
