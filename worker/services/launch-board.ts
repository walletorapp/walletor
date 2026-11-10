import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { z } from "zod";
import type { LaunchEvent, LaunchToken } from "../../shared/launch-contracts";
import { isSolanaAddress } from "../lib/solana";
import { launchLink } from "../lib/launch-links";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const curveDiscriminator = [23, 183, 248, 55, 96, 216, 172, 96];
const globalDiscriminator = [167, 232, 232, 177, 200, 108, 114, 127];
const accountSchema = z
  .object({
    owner: z.string(),
    data: z.tuple([z.string().max(20000), z.literal("base64")]),
  })
  .nullable();
type Account = z.infer<typeof accountSchema>;
type Fetcher = typeof fetch;

export function parseLaunchEvent(
  raw: unknown,
  now: string,
): LaunchEvent | null {
  const parsed = z
    .object({
      txType: z.literal("create"),
      mint: z.string().refine(isSolanaAddress),
      name: z.string().trim().min(1).max(120),
      symbol: z.string().trim().min(1).max(24),
      pool: z.literal("pump"),
      uri: z.string().max(2048).optional().catch(undefined),
    })
    .safeParse(raw);
  return parsed.success
    ? {
        mint: parsed.data.mint,
        name: parsed.data.name,
        symbol: parsed.data.symbol,
        observedAt: now,
        eventType: "create",
        ...(parsed.data.uri ? { metadataUri: parsed.data.uri } : {}),
      }
    : null;
}

export function pumpAddresses(mint: string) {
  const program = new PublicKey(PUMP_PROGRAM);
  const key = new PublicKey(mint);
  const curve = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), key.toBuffer()],
    program,
  )[0];
  const authority = PublicKey.findProgramAddressSync(
    [Buffer.from("pool-authority"), key.toBuffer()],
    program,
  )[0];
  const pool = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      Buffer.from([0, 0]),
      authority.toBuffer(),
      key.toBuffer(),
      new PublicKey(SOL_MINT).toBuffer(),
    ],
    new PublicKey(AMM_PROGRAM),
  )[0];
  return { curve: curve.toBase58(), pool: pool.toBase58() };
}

function accountBytes(
  account: Account,
  owner: string,
  discriminator: number[],
  min: number,
): Buffer | null {
  if (account?.owner !== owner) return null;
  const bytes = Buffer.from(account.data[0], "base64");
  return bytes.length >= min &&
    discriminator.every((byte, index) => bytes[index] === byte)
    ? bytes
    : null;
}

export function classifyLaunch(
  curveAccount: Account,
  poolAccount: Account,
  globalAccount: Account,
  mint: string,
): Pick<LaunchToken, "stage" | "progressPercent" | "poolAddress"> {
  const unknown = {
    stage: "unknown",
    progressPercent: null,
    poolAddress: null,
  } as const;
  const curve = accountBytes(
    curveAccount,
    PUMP_PROGRAM,
    curveDiscriminator,
    49,
  );
  if (!curve || (curve[48] !== 0 && curve[48] !== 1)) return unknown;
  if (curve[48] === 1) {
    // The canonical migrated pool has index 0 and the program-derived authority.
    // A completed curve alone is NOT proof that migration has happened.
    const pool = accountBytes(
      poolAccount,
      AMM_PROGRAM,
      [241, 154, 109, 4, 17, 177, 109, 188],
      107,
    );
    if (
      !pool ||
      !pool.subarray(43, 75).equals(new PublicKey(mint).toBuffer()) ||
      !pool.subarray(75, 107).equals(new PublicKey(SOL_MINT).toBuffer())
    )
      return unknown;
    return {
      stage: "migrated",
      progressPercent: 100,
      poolAddress: pumpAddresses(mint).pool,
    };
  }
  const global = accountBytes(
    globalAccount,
    PUMP_PROGRAM,
    globalDiscriminator,
    105,
  );
  // Restrict the estimated progress baseline to the standard SOL-paired supply.
  // Custom quote mints/mayhem supply use different curve parameters.
  if (
    !global ||
    (curve.length > 81 && curve[81] !== 0) ||
    (curve.length >= 115 &&
      curve.subarray(83, 115).some((byte) => byte !== 0) &&
      !curve.subarray(83, 115).equals(new PublicKey(SOL_MINT).toBuffer())) ||
    curve.readBigUInt64LE(40) !== global.readBigUInt64LE(97)
  )
    return { ...unknown, stage: "new" };
  const initial = global.readBigUInt64LE(89);
  const remaining = curve.readBigUInt64LE(24);
  if (initial === 0n || remaining > initial)
    return { ...unknown, stage: "new" };
  const progressPercent =
    Number(((initial - remaining) * 10000n) / initial) / 100;
  return {
    stage: progressPercent >= 80 ? "almost" : "new",
    progressPercent,
    poolAddress: null,
  };
}

async function accounts(
  addresses: string[],
  rpcUrl: string,
  fetcher: Fetcher,
): Promise<Account[]> {
  if (addresses.length > 100) {
    const chunks = Array.from(
      { length: Math.ceil(addresses.length / 100) },
      (_, i) => addresses.slice(i * 100, (i + 1) * 100),
    );
    return (
      await Promise.all(chunks.map((chunk) => accounts(chunk, rpcUrl, fetcher)))
    ).flat();
  }
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [addresses, { encoding: "base64", commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(6000),
    redirect: "manual",
  });
  if (!response.ok)
    throw new Error(`LAUNCH_RPC_HTTP_${String(response.status)}`);
  const parsed = z
    .object({ result: z.object({ value: z.array(accountSchema).max(100) }) })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error("LAUNCH_RPC_SCHEMA");
  if (parsed.data.result.value.length !== addresses.length)
    throw new Error("Launch account lookup was incomplete.");
  return parsed.data.result.value;
}

const marketSchema = z
  .array(
    z.object({
      chainId: z.string(),
      dexId: z.string(),
      baseToken: z.object({
        address: z.string(),
        name: z.string().max(120).optional(),
        symbol: z.string().max(24).optional(),
      }),
      priceUsd: z.string().nullish(),
      marketCap: z.number().nonnegative().nullish(),
      liquidity: z
        .object({ usd: z.number().nonnegative().nullish() })
        .nullish(),
      volume: z.object({ h24: z.number().nonnegative().nullish() }).nullish(),
      txns: z
        .object({
          h24: z
            .object({
              buys: z.number().int().nonnegative(),
              sells: z.number().int().nonnegative(),
            })
            .nullish(),
        })
        .nullish(),
      info: z
        .object({
          imageUrl: z.string().nullish(),
          websites: z
            .array(z.object({ url: z.string() }))
            .max(20)
            .nullish(),
          socials: z
            .array(z.object({ type: z.string(), url: z.string() }))
            .max(20)
            .nullish(),
        })
        .nullish(),
    }),
  )
  .max(2000);

export async function enrichLaunches(
  events: LaunchEvent[],
  rpcUrl: string,
  fetcher: Fetcher = fetch,
) {
  const selected = events
    .filter((event) => isSolanaAddress(event.mint))
    .slice(0, 600);
  let chainAvailable = true;
  let marketAvailable = true;
  let tokens: LaunchToken[] = selected.map((event) => ({
    ...event,
    stage: "unknown",
    progressPercent: null,
    poolAddress: null,
    logoUrl: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
    marketCheckedAt: null,
  }));
  if (!tokens.length) return { tokens, chainAvailable, marketAvailable };
  const chainWork = async () => {
    const state = await accounts(
      [GLOBAL, ...selected.map((event) => pumpAddresses(event.mint).curve)],
      rpcUrl,
      fetcher,
    );
    const completed = selected.flatMap((event, index) => {
      const bytes = accountBytes(
        state[index + 1] ?? null,
        PUMP_PROGRAM,
        curveDiscriminator,
        49,
      );
      return bytes?.[48] === 1 ? [{ mint: event.mint, index }] : [];
    });
    const pools = completed.length
      ? await accounts(
          completed.map((event) => pumpAddresses(event.mint).pool),
          rpcUrl,
          fetcher,
        )
      : [];
    const poolMap = new Map(
      completed.map((event, index) => [event.mint, pools[index] ?? null]),
    );
    tokens.forEach((token, index) =>
      Object.assign(
        token,
        classifyLaunch(
          state[index + 1] ?? null,
          poolMap.get(token.mint) ?? null,
          state[0] ?? null,
          token.mint,
        ),
      ),
    );
  };
  const marketWork = async () => {
    // One public batch per 30 mints, shared by the single feed coordinator.
    const batches = Array.from(
      { length: Math.ceil(tokens.length / 30) },
      (_, i) => tokens.slice(i * 30, (i + 1) * 30),
    );
    const results = await Promise.allSettled(
      batches.map(async (batch) => {
        const response = await fetcher(
          `https://api.dexscreener.com/tokens/v1/solana/${batch.map((token) => token.mint).join(",")}`,
          { signal: AbortSignal.timeout(6000), redirect: "manual" },
        );
        if (!response.ok)
          throw new Error(`LAUNCH_MARKET_HTTP_${String(response.status)}`);
        const parsedMarket = z
          .array(z.unknown())
          .max(2000)
          .safeParse(await response.json());
        if (!parsedMarket.success) throw new Error("LAUNCH_MARKET_SCHEMA");
        const pairs = parsedMarket.data.flatMap((value) => {
          const parsedPair = marketSchema.element.safeParse(value);
          return parsedPair.success ? [parsedPair.data] : [];
        });
        if (parsedMarket.data.length && !pairs.length)
          throw new Error("LAUNCH_MARKET_SCHEMA");
        for (const token of batch) {
          const pair = pairs
            .filter(
              (item) =>
                item.chainId === "solana" &&
                item.baseToken.address === token.mint,
            )
            .sort(
              (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
            )[0];
          if (!pair) continue;
          token.marketCheckedAt = new Date().toISOString();
          if (token.eventType === "migration") {
            token.name = pair.baseToken.name?.trim()
              ? pair.baseToken.name
              : token.name;
            token.symbol = pair.baseToken.symbol?.trim()
              ? pair.baseToken.symbol
              : token.symbol;
          }
          const price = Number(pair.priceUsd);
          token.priceUsd =
            typeof pair.priceUsd === "string" &&
            pair.priceUsd.trim() !== "" &&
            Number.isFinite(price) &&
            price >= 0
              ? price
              : null;
          token.marketCapUsd = pair.marketCap ?? null;
          token.liquidityUsd = pair.liquidity?.usd ?? null;
          token.volume24hUsd = pair.volume?.h24 ?? null;
          token.buys24h = pair.txns?.h24?.buys ?? null;
          token.sells24h = pair.txns?.h24?.sells ?? null;
          token.transactions24h =
            token.buys24h != null && token.sells24h != null
              ? token.buys24h + token.sells24h
              : null;
          token.websiteUrl = launchLink(pair.info?.websites?.[0]?.url);
          token.twitterUrl = launchLink(
            pair.info?.socials?.find((link) => link.type === "twitter")?.url,
            "twitter",
          );
          token.telegramUrl = launchLink(
            pair.info?.socials?.find((link) => link.type === "telegram")?.url,
            "telegram",
          );
          const image = pair.info?.imageUrl;
          token.logoUrl =
            image &&
            z.url().safeParse(image).success &&
            image.startsWith("https://")
              ? image
              : null;
        }
      }),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      const reason: unknown = failed.reason;
      throw new Error(
        reason instanceof Error ? reason.message : "LAUNCH_MARKET_UNAVAILABLE",
      );
    }
  };
  try {
    await chainWork();
  } catch (reason: unknown) {
    chainAvailable = false;
    console.warn(
      reason instanceof Error &&
        /^LAUNCH_RPC_(HTTP_\d{3}|SCHEMA)$/.test(reason.message)
        ? reason.message
        : "LAUNCH_RPC_UNAVAILABLE",
    );
  }
  tokens = selectLaunchColumns(tokens);
  try {
    await marketWork();
  } catch (reason: unknown) {
    marketAvailable = false;
    console.warn(
      reason instanceof Error &&
        /^LAUNCH_MARKET_(HTTP_\d{3}|SCHEMA)$/.test(reason.message)
        ? reason.message
        : "LAUNCH_MARKET_UNAVAILABLE",
    );
  }
  return { tokens, chainAvailable, marketAvailable };
}

export function selectLaunchColumns(tokens: LaunchToken[]): LaunchToken[] {
  const chosen = [
    ...tokens
      .filter((token) => token.stage === "almost")
      .sort((a, b) => (b.progressPercent ?? 0) - (a.progressPercent ?? 0))
      .slice(0, 25),
    ...tokens.filter((token) => token.stage === "migrated").slice(0, 25),
    ...tokens.filter((token) => token.stage === "new").slice(0, 30),
  ];
  const ids = new Set(chosen.map((token) => token.mint));
  return [...chosen, ...tokens.filter((token) => !ids.has(token.mint))].slice(
    0,
    80,
  );
}
