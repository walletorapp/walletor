import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  LaunchEventSchema,
  type LaunchBoard,
  type LaunchEvent,
} from "../shared/launch-contracts";
import { enrichLaunches, parseLaunchEvent } from "./services/launch-board";
import { isSolanaAddress } from "./lib/solana";
import { BirdeyeLaunchSupplement } from "./services/birdeye-launches";
import { LaunchLogos } from "./services/launch-logos";
import { LaunchDiscovery } from "./services/launch-discovery";

// One outgoing connection for all visitors. Only the documented free creation
// stream is subscribed; no metered trade/account subscriptions or wallet keys.
export class LaunchFeed extends DurableObject<Env> {
  private readonly discovery = new LaunchDiscovery({
    get: () => this.ctx.storage.get("launch-discovery-v1"),
    put: (state) => this.ctx.storage.put("launch-discovery-v1", state),
    overviewBudget: () => this.ctx.storage.get("birdeye-budget-v1"),
  });
  private readonly logos = new LaunchLogos(
    {
      get: () => this.ctx.storage.get("launch-logos-v1"),
      put: (entries) => this.ctx.storage.put("launch-logos-v1", entries),
    },
    fetch,
    {
      apiKey: this.env.HELIUS_API_KEY,
      reserve: async () => {
        const next: unknown = await this.ctx.storage.get(
          "launch-logo-index-next-at",
        );
        if (
          (next !== undefined &&
            (typeof next !== "number" || !Number.isFinite(next))) ||
          (typeof next === "number" && next > Date.now())
        )
          return false;
        await this.ctx.storage.put(
          "launch-logo-index-next-at",
          Date.now() + 60000,
        );
        return true;
      },
    },
  );
  private readonly birdeye = new BirdeyeLaunchSupplement({
    get: () => this.ctx.storage.get("birdeye-budget-v1"),
    put: (state) => this.ctx.storage.put("birdeye-budget-v1", state),
  });
  private events: LaunchEvent[] = [];
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private nextConnectAt = 0;
  private failures = 0;
  private lastVisit = 0;
  private connected = false;
  private cached: { at: number; data: LaunchBoard } | null = null;
  private loading: Promise<LaunchBoard> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const stored = z
        .array(LaunchEventSchema)
        .max(400)
        .safeParse(await ctx.storage.get("events"));
      if (stored.success) this.events = stored.data;
      await this.logos.load();
    });
  }

  private async connectFeed() {
    if (this.socket || this.connecting || Date.now() < this.nextConnectAt)
      return this.connecting;
    this.connecting = (async () => {
      const controller = new AbortController();
      const handshakeTimeout = setTimeout(() => {
        controller.abort();
      }, 6000);
      try {
        const response = await fetch("https://pumpportal.fun/api/data", {
          headers: { Upgrade: "websocket" },
          signal: controller.signal,
          redirect: "manual",
        });
        clearTimeout(handshakeTimeout);
        const socket = response.webSocket;
        if (!socket) {
          console.warn(`launch_feed_handshake_http_${String(response.status)}`);
          await response.body?.cancel();
          throw new Error("Launch feed unavailable.");
        }
        socket.accept();
        this.socket = socket;
        this.connected = false;
        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string" || event.data.length > 20000)
            return;
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch {
            return;
          }
          const acknowledgement = z
            .object({ message: z.string() })
            .safeParse(raw);
          if (
            acknowledgement.success &&
            acknowledgement.data.message.startsWith("Successfully subscribed")
          ) {
            this.connected = true;
            this.failures = 0;
          }
          const token = parseLaunchEvent(raw, new Date().toISOString());
          if (token) {
            this.events = [
              token,
              ...this.events.filter((item) => item.mint !== token.mint),
            ];
          } else {
            const migrated = z
              .object({
                txType: z.literal("migrate"),
                mint: z.string().refine(isSolanaAddress),
              })
              .safeParse(raw);
            if (migrated.success) {
              const existing = this.events.find(
                (item) => item.mint === migrated.data.mint,
              );
              const entry: LaunchEvent = {
                ...(existing ?? {
                  mint: migrated.data.mint,
                  name: "Migrated token",
                  symbol: "TOKEN",
                  observedAt: new Date().toISOString(),
                }),
                eventType: "migration",
              };
              this.events = [
                entry,
                ...this.events.filter((item) => item.mint !== entry.mint),
              ];
            }
          }
          this.events = [
            ...this.events
              .filter((item) => item.eventType === "create")
              .slice(0, 300),
            ...this.events
              .filter((item) => item.eventType === "migration")
              .slice(0, 100),
          ].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
        });
        const closed = () => {
          if (this.socket !== socket) return;
          this.socket = null;
          this.connected = false;
          this.nextConnectAt =
            Date.now() +
            Math.min(60000, 5000 * 2 ** Math.min(this.failures++, 4));
        };
        socket.addEventListener("close", closed);
        socket.addEventListener("error", () => {
          socket.close();
          closed();
        });
        socket.send(JSON.stringify({ method: "subscribeNewToken" }));
        socket.send(JSON.stringify({ method: "subscribeMigration" }));
      } catch {
        this.connected = false;
        this.nextConnectAt = Date.now() + 30000;
        console.warn("launch_feed_connection_unavailable");
      } finally {
        clearTimeout(handshakeTimeout);
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  async snapshot(): Promise<LaunchBoard> {
    this.lastVisit = Date.now();
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    await this.connectFeed();
    if (this.cached && Date.now() - this.cached.at < 10000) {
      this.logos.apply(this.cached.data.tokens);
      return { ...this.cached.data, feedConnected: this.connected };
    }
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const recent = this.events.filter(
        (event) => Date.now() - Date.parse(event.observedAt) < 6 * 3600000,
      );
      const rpc =
        this.env.SOLANA_CLAIM_RPC_URL_PRIVATE || this.env.SOLANA_CLAIM_RPC_URL;
      // Check every retained candidate before choosing the three visible groups.
      const discovered = await this.discovery.snapshot(
        this.env.BIRDEYE_API_KEY,
      );
      const known = new Set(recent.map((event) => event.mint));
      const result = await enrichLaunches(
        [
          ...recent,
          ...discovered.events.filter((event) => !known.has(event.mint)),
        ],
        rpc,
      );
      this.discovery.apply(result.tokens);
      await this.birdeye.enrich(result.tokens, this.env.BIRDEYE_API_KEY);
      this.logos.apply(result.tokens);
      this.ctx.waitUntil(this.logos.refresh(result.tokens));
      const previous = new Map(
        this.cached?.data.tokens.map((token) => [token.mint, token]),
      );
      for (const token of result.tokens) {
        const old = previous.get(token.mint);
        if (
          !token.marketCheckedAt &&
          old?.marketCheckedAt &&
          Date.now() - Date.parse(old.marketCheckedAt) < 60000
        ) {
          token.priceUsd = old.priceUsd;
          token.marketCapUsd = old.marketCapUsd;
          token.liquidityUsd = old.liquidityUsd;
          token.volume24hUsd = old.volume24hUsd;
          token.holders ??= old.holders;
          token.transactions24h ??= old.transactions24h;
          token.buys24h ??= old.buys24h;
          token.sells24h ??= old.sells24h;
          token.websiteUrl ??= old.websiteUrl;
          token.twitterUrl ??= old.twitterUrl;
          token.telegramUrl ??= old.telegramUrl;
          token.logoUrl = old.logoUrl;
          token.marketCheckedAt = old.marketCheckedAt;
          if (token.eventType === "migration") {
            token.name = old.name;
            token.symbol = old.symbol;
          }
        }
        if (token.eventType === "migration" && token.marketCheckedAt) {
          const event = this.events.find((item) => item.mint === token.mint);
          if (event) {
            event.name = token.name;
            event.symbol = token.symbol;
          }
        }
      }
      const data: LaunchBoard = {
        ...result,
        feedConnected: this.connected,
        lastEventAt: recent[0]?.observedAt ?? null,
        checkedAt: new Date().toISOString(),
        discoveryAvailable: discovered.available,
        discoveryCheckedAt: discovered.checkedAt,
        discoveryStatus: discovered.status,
        discoveryRetryAt: discovered.retryAt,
      };
      this.cached = { at: Date.now(), data };
      return data;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async alarm() {
    await this.ctx.storage.put("events", this.events);
    if (Date.now() - this.lastVisit > 90000) {
      this.socket?.close(1000, "No active viewers");
      this.socket = null;
      this.connected = false;
      return;
    }
    await this.connectFeed();
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
