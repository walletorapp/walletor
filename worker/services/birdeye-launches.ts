import { z } from "zod";
import {
  LaunchTokenSchema,
  type LaunchToken,
} from "../../shared/launch-contracts";
import { isSolanaAddress } from "../lib/solana";
import { launchLink } from "../lib/launch-links";

// Standard plan: overview costs 18 CU. Reserve part of the 30k allowance for
// operator checks. A rolling 31-day cap also covers non-calendar billing cycles.
const COST = 18;
const BUDGET = 5000;
const WINDOW = 31 * 86400000;
const INTERVAL = 3 * 3600000;
const stateSchema = z.object({
  attempts: z.array(z.number().int().nonnegative()).max(1333),
  nextAt: z.number().int().nonnegative(),
  requestVersion: z.number().int().optional(),
  cached: z
    .object({ at: z.number().int().nonnegative(), token: LaunchTokenSchema })
    .optional(),
});
const overviewSchema = z.object({
  success: z.literal(true),
  data: z
    .object({
      address: z.string().refine(isSolanaAddress),
      price: z.number().nonnegative().nullish(),
      marketCap: z.number().nonnegative().nullish(),
      liquidity: z.number().nonnegative().nullish(),
      v24hUSD: z.number().nonnegative().nullish(),
      logoURI: z.url().nullish(),
      name: z.string().trim().min(1).max(120).nullish(),
      symbol: z.string().trim().min(1).max(24).nullish(),
      holder: z.number().int().nonnegative().nullish(),
      trade24h: z.number().int().nonnegative().nullish(),
      buy24h: z.number().int().nonnegative().nullish(),
      sell24h: z.number().int().nonnegative().nullish(),
      extensions: z
        .object({
          website: z.string().nullish(),
          twitter: z.string().nullish(),
          telegram: z.string().nullish(),
        })
        .nullish(),
    })
    .nullable(),
});

type BudgetState = z.infer<typeof stateSchema>;
export function birdeyeOverviewUsage(raw: unknown, now: number): number | null {
  if (raw === undefined) return 0;
  const parsed = stateSchema.safeParse(raw);
  return parsed.success
    ? parsed.data.attempts.filter((at) => at > now - WINDOW).length * COST
    : null;
}
interface Store {
  get: () => Promise<unknown>;
  put: (state: BudgetState) => Promise<void>;
}

export class BirdeyeLaunchSupplement {
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async enrich(
    tokens: LaunchToken[],
    key: string | undefined,
    now = Date.now(),
  ) {
    if (!key?.trim() || this.running) return;
    this.running = this.run(tokens, key, now);
    try {
      await this.running;
    } catch {
      console.warn("BIRDEYE_STORAGE_UNAVAILABLE");
    } finally {
      this.running = null;
    }
  }

  private async run(tokens: LaunchToken[], key: string, now: number) {
    const stored = await this.store.get();
    const parsed = stateSchema.safeParse(stored);
    // Fail closed if persisted budget metadata is damaged; never reset a spent
    // budget merely because decoding failed.
    if (stored !== undefined && !parsed.success) {
      console.warn("BIRDEYE_BUDGET_INVALID");
      return;
    }
    const state: BudgetState = parsed.success
      ? parsed.data
      : { attempts: [], nextAt: 0 };
    const cached = state.cached;
    const matching = tokens.find((item) => item.mint === cached?.token.mint);
    if (cached && matching && cached.at <= now) {
      if (now - cached.at < 60000) {
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
          const value = cached.token[field];
          if (value != null) matching[field] ??= value;
        }
        matching.marketCheckedAt ??= cached.token.marketCheckedAt;
      }
      // Identity metadata may outlive the market snapshot. Never reuse stages.
      if (now - cached.at < 86400000) {
        matching.logoUrl ??= cached.token.logoUrl;
        matching.websiteUrl ??= cached.token.websiteUrl;
        matching.twitterUrl ??= cached.token.twitterUrl;
        matching.telegramUrl ??= cached.token.telegramUrl;
        if (matching.eventType === "migration") {
          matching.name = cached.token.name;
          matching.symbol = cached.token.symbol;
        }
      }
    }
    const candidates = tokens.filter(
      (token) =>
        isSolanaAddress(token.mint) &&
        (token.priceUsd === null ||
          token.marketCapUsd === null ||
          token.liquidityUsd === null ||
          token.volume24hUsd === null ||
          !token.logoUrl),
    );
    // Prefer indexed, migrated markets over seconds-old unindexed launches.
    const token =
      candidates.find((item) => item.stage === "migrated") ?? candidates[0];
    if (!token) return;
    state.attempts = state.attempts.filter((at) => at > now - WINDOW);
    if (
      (now < state.nextAt && state.requestVersion === 1) ||
      (state.attempts.length + 1) * COST > BUDGET
    )
      return;
    state.attempts.push(now);
    state.nextAt = now + INTERVAL;
    state.requestVersion = 1;
    // Reserve before sending, including failures/timeouts, and await persistence.
    await this.store.put(state);
    try {
      const url = new URL("https://public-api.birdeye.so/defi/token_overview");
      url.searchParams.set("address", token.mint);
      const fetcher = this.fetcher;
      const response = await fetcher(url.toString(), {
        headers: {
          "X-API-KEY": key,
          "x-chain": "solana",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(6000),
        redirect: "manual",
      });
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) {
          state.nextAt = now + 86400000;
          await this.store.put(state);
        }
        await response.body?.cancel();
        console.warn(`BIRDEYE_OVERVIEW_HTTP_${String(response.status)}`);
        return;
      }
      const result = overviewSchema.safeParse(await response.json());
      if (
        !result.success ||
        (result.data.data && result.data.data.address !== token.mint)
      ) {
        console.warn("BIRDEYE_OVERVIEW_SCHEMA");
        return;
      }
      const data = result.data.data;
      if (!data) return;
      let filled = false;
      for (const [target, source] of [
        ["priceUsd", "price"],
        ["marketCapUsd", "marketCap"],
        ["liquidityUsd", "liquidity"],
        ["volume24hUsd", "v24hUSD"],
        ["holders", "holder"],
        ["transactions24h", "trade24h"],
        ["buys24h", "buy24h"],
        ["sells24h", "sell24h"],
      ] as const) {
        if (token[target] == null && data[source] != null) {
          token[target] = data[source];
          filled = true;
        }
      }
      if (!token.logoUrl && data.logoURI?.startsWith("https://")) {
        token.logoUrl = data.logoURI;
      }
      token.websiteUrl ??= launchLink(data.extensions?.website);
      token.twitterUrl ??= launchLink(data.extensions?.twitter, "twitter");
      token.telegramUrl ??= launchLink(data.extensions?.telegram, "telegram");
      if (token.eventType === "migration") {
        token.name = data.name ?? token.name;
        token.symbol = data.symbol ?? token.symbol;
      }
      if (filled) token.marketCheckedAt ??= new Date(now).toISOString();
      state.cached = { at: now, token: structuredClone(token) };
      await this.store.put(state);
    } catch {
      // Never log request objects, response bodies, or credentials.
      console.warn("BIRDEYE_OVERVIEW_UNAVAILABLE");
    }
  }
}
