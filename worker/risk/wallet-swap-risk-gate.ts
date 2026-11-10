import { DurableObject } from "cloudflare:workers";

import {
  WalletSwapLimitDecisionSchema,
  WalletSwapQuoteRiskInputSchema,
  type WalletSwapLimitDecision,
  type WalletSwapQuoteRiskInput,
} from "../../shared/risk-contracts";
import { walletSwapLimitDecision } from "./swap-limit";

interface WalletSwapRiskRow extends Record<string, SqlStorageValue> {
  request_id: string;
  wallet_address: string;
  quoted_notional_microusd: number;
  status: "QUOTED" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toSafeInteger(value: bigint): number {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Wallet swap quote exceeds the supported integer range.");
  }
  return Number(value);
}

export class WalletSwapRiskGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS wallet_swap_risk_events (
          request_id TEXT PRIMARY KEY,
          wallet_address TEXT NOT NULL,
          quoted_notional_microusd INTEGER NOT NULL
            CHECK (quoted_notional_microusd > 0),
          status TEXT NOT NULL CHECK (status IN (
            'QUOTED', 'SUBMITTED', 'CONFIRMED', 'FAILED'
          )),
          expires_at TEXT NOT NULL,
          confirmed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wallet_swap_risk_status_time
          ON wallet_swap_risk_events(status, confirmed_at, expires_at);
      `);
      return Promise.resolve();
    });
  }

  registerQuote(
    rawInput: WalletSwapQuoteRiskInput,
    rollingLimitMicroUsd: string,
  ): WalletSwapLimitDecision {
    const input = WalletSwapQuoteRiskInputSchema.parse(rawInput);
    const registeredAtMs = Date.parse(input.registeredAt);
    const expiresAtMs = Date.parse(input.expiresAt);
    if (
      expiresAtMs <= registeredAtMs ||
      expiresAtMs - registeredAtMs > 15 * 60_000
    ) {
      throw new Error("Wallet swap quote has an invalid lifetime.");
    }
    const requestedMicroUsd = BigInt(input.quotedNotionalMicroUsd);
    const requestedStorageValue = toSafeInteger(requestedMicroUsd);
    const limitMicroUsd = BigInt(rollingLimitMicroUsd);
    const existing = this.ctx.storage.sql
      .exec<WalletSwapRiskRow>(
        "SELECT * FROM wallet_swap_risk_events WHERE request_id = ?",
        input.requestId,
      )
      .toArray()[0];
    if (existing) {
      if (
        existing.wallet_address !== input.walletAddress ||
        existing.quoted_notional_microusd !== requestedStorageValue ||
        existing.expires_at !== input.expiresAt
      ) {
        throw new Error("Wallet swap quote ID was registered with other data.");
      }
      return this.limitFor(
        requestedMicroUsd,
        limitMicroUsd,
        input.registeredAt,
      );
    }

    return this.ctx.storage.transactionSync(() => {
      const decision = this.limitFor(
        requestedMicroUsd,
        limitMicroUsd,
        input.registeredAt,
      );
      if (!decision.allowed) return decision;
      this.ctx.storage.sql.exec(
        `INSERT INTO wallet_swap_risk_events (
          request_id, wallet_address, quoted_notional_microusd, status,
          expires_at, confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'QUOTED', ?, NULL, ?, ?)`,
        input.requestId,
        input.walletAddress,
        requestedStorageValue,
        input.expiresAt,
        input.registeredAt,
        input.registeredAt,
      );
      return decision;
    });
  }

  beginExecution(
    requestId: string,
    walletAddress: string,
    serverTime: string,
    rollingLimitMicroUsd: string,
  ): WalletSwapLimitDecision {
    const limitMicroUsd = BigInt(rollingLimitMicroUsd);
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<WalletSwapRiskRow>(
          "SELECT * FROM wallet_swap_risk_events WHERE request_id = ?",
          requestId,
        )
        .toArray()[0];
      if (!row) {
        return this.rejection("QUOTE_NOT_REGISTERED", 0n, 0n, limitMicroUsd);
      }
      const requestedMicroUsd = BigInt(row.quoted_notional_microusd);
      if (row.wallet_address !== walletAddress) {
        return this.rejection(
          "QUOTE_WALLET_MISMATCH",
          0n,
          requestedMicroUsd,
          limitMicroUsd,
        );
      }
      if (row.status === "SUBMITTED") {
        return this.rejection(
          "EXECUTION_IN_PROGRESS",
          this.currentUsageMicroUsd(serverTime),
          requestedMicroUsd,
          limitMicroUsd,
        );
      }
      if (row.status === "CONFIRMED") {
        return this.rejection(
          "EXECUTION_ALREADY_CONFIRMED",
          this.currentUsageMicroUsd(serverTime),
          requestedMicroUsd,
          limitMicroUsd,
        );
      }
      if (row.status === "FAILED") {
        return this.rejection(
          "EXECUTION_PREVIOUSLY_FAILED",
          this.currentUsageMicroUsd(serverTime),
          requestedMicroUsd,
          limitMicroUsd,
        );
      }
      if (Date.parse(row.expires_at) <= Date.parse(serverTime)) {
        this.ctx.storage.sql.exec(
          `UPDATE wallet_swap_risk_events
           SET status = 'FAILED', updated_at = ? WHERE request_id = ?`,
          serverTime,
          requestId,
        );
        return this.rejection(
          "QUOTE_EXPIRED",
          this.currentUsageMicroUsd(serverTime),
          requestedMicroUsd,
          limitMicroUsd,
        );
      }
      const decision = this.limitFor(
        requestedMicroUsd,
        limitMicroUsd,
        serverTime,
      );
      if (!decision.allowed) return decision;
      const executionHoldUntil = new Date(
        Date.parse(serverTime) + 15 * 60_000,
      ).toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE wallet_swap_risk_events
         SET status = 'SUBMITTED', expires_at = ?, updated_at = ?
         WHERE request_id = ?`,
        executionHoldUntil,
        serverTime,
        requestId,
      );
      return decision;
    });
  }

  settleExecution(
    requestId: string,
    walletAddress: string,
    confirmed: boolean,
    serverTime: string,
  ): void {
    const row = this.ctx.storage.sql
      .exec<WalletSwapRiskRow>(
        "SELECT * FROM wallet_swap_risk_events WHERE request_id = ?",
        requestId,
      )
      .toArray()[0];
    if (row?.wallet_address !== walletAddress) {
      throw new Error("Wallet swap risk event does not match the execution.");
    }
    if (row.status === "CONFIRMED") return;
    if (row.status !== "SUBMITTED") {
      throw new Error("Wallet swap risk event was not submitted.");
    }
    this.ctx.storage.sql.exec(
      `UPDATE wallet_swap_risk_events
       SET status = ?, confirmed_at = ?, updated_at = ?
       WHERE request_id = ? AND status = 'SUBMITTED'`,
      confirmed ? "CONFIRMED" : "FAILED",
      confirmed ? serverTime : null,
      serverTime,
      requestId,
    );
  }

  private limitFor(
    requestedMicroUsd: bigint,
    limitMicroUsd: bigint,
    serverTime: string,
  ): WalletSwapLimitDecision {
    return walletSwapLimitDecision({
      usedMicroUsd: this.currentUsageMicroUsd(serverTime),
      requestedMicroUsd,
      limitMicroUsd,
    });
  }

  private currentUsageMicroUsd(serverTime: string): bigint {
    const windowStart = new Date(
      Date.parse(serverTime) - 24 * 60 * 60 * 1_000,
    ).toISOString();
    const row = this.ctx.storage.sql
      .exec<{ total: number }>(
        `SELECT COALESCE(SUM(quoted_notional_microusd), 0) AS total
         FROM wallet_swap_risk_events
         WHERE (status = 'CONFIRMED' AND confirmed_at > ?) OR
           (status = 'SUBMITTED' AND expires_at > ?)`,
        windowStart,
        serverTime,
      )
      .one();
    if (!Number.isSafeInteger(row.total) || row.total < 0) {
      throw new Error("Wallet swap usage exceeds the safe integer range.");
    }
    return BigInt(row.total);
  }

  private rejection(
    reason: Exclude<WalletSwapLimitDecision["reason"], "ALLOWED">,
    usedMicroUsd: bigint,
    requestedMicroUsd: bigint,
    limitMicroUsd: bigint,
  ): WalletSwapLimitDecision {
    return WalletSwapLimitDecisionSchema.parse({
      allowed: false,
      reason,
      limitMicroUsd: limitMicroUsd.toString(),
      usedMicroUsd: usedMicroUsd.toString(),
      requestedMicroUsd: requestedMicroUsd.toString(),
      remainingMicroUsd:
        usedMicroUsd >= limitMicroUsd
          ? "0"
          : (limitMicroUsd - usedMicroUsd).toString(),
      windowHours: 24,
    });
  }
}
