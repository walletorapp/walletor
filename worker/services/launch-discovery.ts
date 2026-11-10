import { z } from "zod";
import {
  LaunchTokenSchema,
  type LaunchEvent,
  type LaunchToken,
} from "../../shared/launch-contracts";
import { isSolanaAddress } from "../lib/solana";
import { launchLink } from "../lib/launch-links";
import { birdeyeOverviewUsage } from "./birdeye-launches";

const WINDOW = 31 * 86400000;
const INTERVAL = 2 * 3600000;
const COST = 50;
const BUDGET = 19000;
const COMBINED_BUDGET = 24000;
const REQUEST_VERSION = 3;
const stateSchema = z.object({
  attempts: z.array(z.number().int().nonnegative()).max(380),
  nextAt: z.number().int().nonnegative(),
  candidates: z.array(LaunchTokenSchema).max(200),
  checkedAt: z.iso.datetime().nullable(),
  available: z.boolean(),
  requestVersion: z.number().int().optional(),
  failure: z.string().max(64).optional(),
});
const itemSchema = z.object({
  address: z.string().refine(isSolanaAddress),
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(24),
  logo_uri: z.string().max(2048).nullish(),
  price: z.number().nonnegative().nullish(),
  market_cap: z.number().nonnegative().nullish(),
  liquidity: z.number().nonnegative().nullish(),
  volume_24h_usd: z.number().nonnegative().nullish(),
  trade_24h_count: z.number().int().nonnegative().nullish(),
  buy_24h: z.number().int().nonnegative().nullish(),
  sell_24h: z.number().int().nonnegative().nullish(),
  holder: z.number().int().nonnegative().nullish(),
  extensions: z
    .object({
      website: z.string().nullish(),
      twitter: z.string().nullish(),
      telegram: z.string().nullish(),
    })
    .nullish(),
});
type State = z.infer<typeof stateSchema>;
interface Store {
  get: () => Promise<unknown>;
  put: (state: State) => Promise<void>;
  overviewBudget: () => Promise<unknown>;
}
export interface DiscoverySnapshot {
  events: LaunchEvent[];
  checkedAt: string | null;
  available: boolean;
  status?: string;
  retryAt?: string;
}

export class LaunchDiscovery {
  private status = "pending";
  private candidates: LaunchToken[] = [];
  private running: Promise<DiscoverySnapshot> | null = null;
  constructor(
    private readonly store: Store,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  snapshot(
    key: string | undefined,
    now = Date.now(),
  ): Promise<DiscoverySnapshot> {
    if (this.running) return this.running;
    this.running = this.run(key, now)
      .catch(() => {
        console.warn("LAUNCH_DISCOVERY_STORAGE_UNAVAILABLE");
        return { events: [], checkedAt: null, available: false };
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private result(state: State, now: number): DiscoverySnapshot {
    this.candidates = state.candidates.filter(
      (token) =>
        token.marketCheckedAt &&
        Date.parse(token.marketCheckedAt) <= now &&
        now - Date.parse(token.marketCheckedAt) < 86400000,
    );
    return {
      events: this.candidates.map((token) => ({
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        observedAt: token.observedAt,
        eventType: "create",
      })),
      available:
        state.available &&
        state.checkedAt !== null &&
        Date.parse(state.checkedAt) <= now &&
        now - Date.parse(state.checkedAt) < 86400000,
      checkedAt: state.checkedAt,
      status: this.status,
      retryAt: new Date(state.nextAt).toISOString(),
    };
  }

  private async run(
    key: string | undefined,
    now: number,
  ): Promise<DiscoverySnapshot> {
    const raw = await this.store.get();
    const parsed = stateSchema.safeParse(raw);
    if (raw !== undefined && !parsed.success) {
      console.warn("LAUNCH_DISCOVERY_BUDGET_INVALID");
      return {
        events: [],
        checkedAt: null,
        available: false,
        status: "invalid-state",
      };
    }
    const state: State = parsed.success
      ? parsed.data
      : {
          attempts: [],
          nextAt: 0,
          candidates: [],
          checkedAt: null,
          available: false,
        };
    if (!key?.trim()) {
      this.status = "missing-key";
      console.warn("LAUNCH_DISCOVERY_KEY_MISSING");
      return this.result(state, now);
    }
    if (
      now < state.nextAt &&
      (state.available || state.requestVersion === REQUEST_VERSION)
    ) {
      this.status = state.available ? "ready" : (state.failure ?? "cooldown");
      return this.result(state, now);
    }
    state.attempts = state.attempts.filter((at) => at > now - WINDOW);
    const overviewUsage = birdeyeOverviewUsage(
      await this.store.overviewBudget(),
      now,
    );
    if (
      overviewUsage === null ||
      (state.attempts.length + 1) * COST > BUDGET ||
      overviewUsage + (state.attempts.length + 1) * COST > COMBINED_BUDGET
    ) {
      this.status =
        overviewUsage === null ? "invalid-overview-budget" : "budget-limited";
      return this.result(state, now);
    }
    state.attempts.push(now);
    state.requestVersion = REQUEST_VERSION;
    this.status = "requesting";
    state.nextAt = now + INTERVAL;
    await this.store.put(state);
    try {
      const url = new URL("https://public-api.birdeye.so/defi/v3/token/list");
      for (const [name, value] of Object.entries({
        sort_by: "last_trade_unix_time",
        sort_type: "desc",
        platform_name: "pump.fun",
        min_market_cap: "10000",
        max_market_cap: "150000",
        limit: "100",
        offset: "0",
      }))
        url.searchParams.set(name, value);
      // Workers' native fetch must not receive this class as its receiver.
      const fetcher = this.fetcher;
      const response = await fetcher(url.toString(), {
        headers: {
          "X-API-KEY": key.trim(),
          "x-chain": "solana",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(6000),
        redirect: "manual",
      });
      if (!response.ok) {
        this.status = `upstream-${String(response.status)}`;
        state.failure = this.status;
        if ([401, 403, 429].includes(response.status))
          state.nextAt = now + 86400000;
        await response.body?.cancel();
        console.warn(`LAUNCH_DISCOVERY_HTTP_${String(response.status)}`);
        state.available = false;
      } else {
        const envelope = z
          .object({
            success: z.literal(true),
            data: z.object({ items: z.array(z.unknown()).max(100) }),
          })
          .safeParse(await response.json());
        if (!envelope.success) throw new Error("LAUNCH_DISCOVERY_SCHEMA");
        const items = envelope.data.data.items.flatMap((item) => {
          const parsedItem = itemSchema.safeParse(item);
          return parsedItem.success ? [parsedItem.data] : [];
        });
        if (envelope.data.data.items.length && !items.length)
          throw new Error("LAUNCH_DISCOVERY_ITEMS");
        const previous = new Map(
          state.candidates.map((token) => [token.mint, token]),
        );
        const at = new Date(now).toISOString();
        const discovered = items.map((item): LaunchToken => ({
          mint: item.address,
          name: item.name,
          symbol: item.symbol,
          observedAt: previous.get(item.address)?.observedAt ?? at,
          eventType: "create",
          // Market cap only narrows discovery. Stage must be checked on-chain.
          stage: "unknown",
          progressPercent: null,
          poolAddress: null,
          logoUrl: launchLink(item.logo_uri),
          priceUsd: item.price ?? null,
          marketCapUsd: item.market_cap ?? null,
          liquidityUsd: item.liquidity ?? null,
          volume24hUsd: item.volume_24h_usd ?? null,
          marketCheckedAt: at,
          holders: item.holder ?? null,
          transactions24h: item.trade_24h_count ?? null,
          buys24h: item.buy_24h ?? null,
          sells24h: item.sell_24h ?? null,
          websiteUrl: launchLink(item.extensions?.website),
          twitterUrl: launchLink(item.extensions?.twitter, "twitter"),
          telegramUrl: launchLink(item.extensions?.telegram, "telegram"),
        }));
        const seen = new Set(discovered.map((token) => token.mint));
        state.candidates = [
          ...discovered,
          ...state.candidates.filter((token) => !seen.has(token.mint)),
        ].slice(0, 200);
        state.available = true;
        state.failure = undefined;
        this.status = "ready";
        state.checkedAt = at;
      }
    } catch (reason: unknown) {
      this.status =
        reason instanceof Error && reason.message === "LAUNCH_DISCOVERY_SCHEMA"
          ? "invalid-envelope"
          : reason instanceof Error &&
              reason.message === "LAUNCH_DISCOVERY_ITEMS"
            ? "invalid-items"
            : reason instanceof SyntaxError
              ? "invalid-json"
              : reason instanceof Error &&
                  ["TimeoutError", "AbortError"].includes(reason.name)
                ? "timeout"
                : reason instanceof TypeError
                  ? "request-type-error"
                  : "request-failed";
      state.failure = this.status;
      state.available = false;
      console.warn("LAUNCH_DISCOVERY_UNAVAILABLE");
    }
    await this.store.put(state);
    return this.result(state, now);
  }

  apply(tokens: LaunchToken[], now = Date.now()) {
    const byMint = new Map(this.candidates.map((token) => [token.mint, token]));
    for (const token of tokens) {
      const source = byMint.get(token.mint);
      if (
        !source?.marketCheckedAt ||
        Date.parse(source.marketCheckedAt) > now ||
        now - Date.parse(source.marketCheckedAt) >= 86400000
      )
        continue;
      token.logoUrl ??= source.logoUrl;
      token.websiteUrl ??= source.websiteUrl;
      token.twitterUrl ??= source.twitterUrl;
      token.telegramUrl ??= source.telegramUrl;
      if (token.symbol === "TOKEN") {
        token.name = source.name;
        token.symbol = source.symbol;
      }
      if (
        !source.marketCheckedAt ||
        now - Date.parse(source.marketCheckedAt) >= 60000
      )
        continue;
      for (const field of [
        "priceUsd",
        "marketCapUsd",
        "liquidityUsd",
        "volume24hUsd",
        "holders",
        "transactions24h",
        "buys24h",
        "sells24h",
      ] as const) {
        const value = source[field];
        if (value != null) token[field] ??= value;
      }
      token.marketCheckedAt ??= source.marketCheckedAt;
    }
  }
}
