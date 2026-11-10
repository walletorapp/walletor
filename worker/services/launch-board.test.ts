// @vitest-environment node
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  classifyLaunch,
  enrichLaunches,
  parseLaunchEvent,
  PUMP_PROGRAM,
  selectLaunchColumns,
  pumpAddresses,
} from "./launch-board";

const mint = "So11111111111111111111111111111111111111112";
const now = "2026-10-27T12:00:00.000Z";
// Public mainnet account prefixes captured 27 October 2026. Independent of the
// synthetic layout below: Global.token_total_supply starts at byte 97, after
// initial_real_token_reserves, not at byte 105 (fee_basis_points).
it("decodes standard curve progress against real mainnet account layouts", () => {
  const global = Buffer.from(
    "p+joschscn8B07uMqzQc4FKEV/LDgX0yeEQZY9zVX+1YuiTJmd2sAqpKwvjQ3Vy8l+MonBl8tQYqVPPZVrnOblEV+WVnqlyz5gAQ2EfjzwMAAKwj/AYAAAAAeMX7UdECAACAxqR+jQMA",
    "base64",
  );
  const curve = Buffer.from(
    "F7f4N2DYrGAAENhH488DAACsI/wGAAAAAHjF+1HRAgAAAAAAAAAAAACAxqR+jQMAAAUqSdY4uTy3KRfx+v9SdGPp2yG4hPKXVWETmWOu7UBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    "base64",
  );
  expect(
    classifyLaunch(
      account(curve),
      null,
      account(global),
      "2b37qJ8aXCaoAazHo6mCqy8GtXJz4DuVXTcnQvduhP6J",
    ),
  ).toMatchObject({ stage: "new", progressPercent: 0 });
});
const event = {
  mint,
  name: "Example",
  symbol: "EX",
  observedAt: now,
  eventType: "create" as const,
};
const account = (bytes: Buffer, owner = PUMP_PROGRAM) => ({
  owner,
  data: [bytes.toString("base64"), "base64"] as [string, "base64"],
});
function fixture(remaining = 200n, complete = false) {
  const global = Buffer.alloc(113);
  Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]).copy(global);
  global.writeBigUInt64LE(1000n, 89);
  global.writeBigUInt64LE(1500n, 97);
  const curve = Buffer.alloc(115);
  Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(curve);
  curve.writeBigUInt64LE(remaining, 24);
  curve.writeBigUInt64LE(1500n, 40);
  curve[48] = complete ? 1 : 0;
  const pool = Buffer.alloc(107);
  Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]).copy(pool);
  new PublicKey(mint).toBuffer().copy(pool, 43);
  new PublicKey(mint).toBuffer().copy(pool, 75);
  return { global, curve, pool };
}
it("accepts only supported valid creation events and never trusts extra trade fields", () => {
  expect(
    parseLaunchEvent(
      {
        mint,
        name: "Example",
        symbol: "EX",
        txType: "create",
        pool: "pump",
        price: 999,
      },
      now,
    ),
  ).toEqual(event);
  expect(
    parseLaunchEvent(
      {
        mint: "x".repeat(32),
        name: "X",
        symbol: "X",
        txType: "create",
        pool: "pump",
      },
      now,
    ),
  ).toBeNull();
  expect(
    parseLaunchEvent({ ...event, txType: "buy", pool: "pump" }, now),
  ).toBeNull();
});
it("derives curve stages from exact reserves and leaves unsupported baselines unknown", () => {
  const f = fixture();
  expect(
    classifyLaunch(account(f.curve), null, account(f.global), mint),
  ).toMatchObject({ stage: "almost", progressPercent: 80 });
  f.curve.writeBigUInt64LE(201n, 24);
  expect(
    classifyLaunch(account(f.curve), null, account(f.global), mint),
  ).toMatchObject({ stage: "new", progressPercent: 79.9 });
  f.curve[83] = 1;
  expect(
    classifyLaunch(account(f.curve), null, account(f.global), mint)
      .progressPercent,
  ).toBeNull();
  expect(
    classifyLaunch(
      account(f.curve, "11111111111111111111111111111111"),
      null,
      account(f.global),
      mint,
    ).stage,
  ).toBe("unknown");
});
it("requires a correctly owned, typed and mint-matched canonical pool for migration", () => {
  const f = fixture(0n, true);
  expect(
    classifyLaunch(account(f.curve), null, account(f.global), mint).stage,
  ).toBe("unknown");
  const pool = account(f.pool, "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
  expect(
    classifyLaunch(account(f.curve), pool, account(f.global), mint).stage,
  ).toBe("migrated");
  f.pool[43] = 0;
  expect(
    classifyLaunch(
      account(f.curve),
      account(f.pool, pool.owner),
      account(f.global),
      mint,
    ).stage,
  ).toBe("unknown");
});
it("separates chain availability from market data and retains actual zero measurements", async () => {
  const f = fixture();
  const fetcher = vi.fn<typeof fetch>((input) => {
    if (input === "https://rpc.example")
      return Promise.resolve(
        Response.json({
          result: { value: [account(f.global), account(f.curve)] },
        }),
      );
    return Promise.resolve(
      Response.json([
        { chainId: "solana", baseToken: { address: "bad" } },
        {
          chainId: "solana",
          dexId: "pumpfun",
          baseToken: { address: mint },
          priceUsd: "0",
          liquidity: { usd: 0 },
          volume: { h24: 0 },
          marketCap: 0,
          txns: { h24: { buys: 0, sells: 0 } },
          info: {
            websites: [{ url: "https://example.com" }],
            socials: [{ type: "twitter", url: "https://x.com/example" }],
          },
        },
      ]),
    );
  });
  const result = await enrichLaunches([event], "https://rpc.example", fetcher);
  expect(result).toMatchObject({
    chainAvailable: true,
    marketAvailable: true,
    tokens: [
      {
        stage: "almost",
        marketCapUsd: 0,
        priceUsd: 0,
        liquidityUsd: 0,
        volume24hUsd: 0,
        transactions24h: 0,
        websiteUrl: "https://example.com/",
        twitterUrl: "https://x.com/example",
      },
    ],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const unavailable = await enrichLaunches([event], "https://rpc.example", () =>
    Promise.resolve(new Response("unavailable", { status: 503 })),
  );
  expect(unavailable).toMatchObject({
    chainAvailable: false,
    marketAvailable: false,
    tokens: [{ stage: "unknown", priceUsd: null, liquidityUsd: null }],
  });
});

it("checks older retained candidates past the original first 80 before selecting columns", async () => {
  const f = fixture(1000n);
  const near = fixture(100n);
  const events = Array.from({ length: 510 }, (_, i) => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(i + 1);
    return {
      ...event,
      mint: new PublicKey(bytes).toBase58(),
      symbol: `T${String(i)}`,
    };
  });
  const older = events[509];
  if (!older) throw new Error("Missing fixture");
  const nearAddress = pumpAddresses(older.mint).curve;
  const rpcSizes: number[] = [];
  const fetcher = vi.fn<typeof fetch>((url, init) => {
    if (url !== "https://rpc.example")
      return Promise.resolve(Response.json([]));
    const body: unknown = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    );
    const parsed = z
      .object({ params: z.tuple([z.array(z.string()), z.unknown()]) })
      .parse(body);
    const addresses = parsed.params[0];
    rpcSizes.push(addresses.length);
    return Promise.resolve(
      Response.json({
        result: {
          value: addresses.map((address) =>
            account(
              address === "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
                ? f.global
                : address === nearAddress
                  ? near.curve
                  : f.curve,
            ),
          ),
        },
      }),
    );
  });
  const result = await enrichLaunches(events, "https://rpc.example", fetcher);
  expect(result.tokens).toHaveLength(80);
  expect(
    result.tokens.find((token) => token.mint === older.mint),
  ).toMatchObject({ stage: "almost", progressPercent: 90 });
  expect(rpcSizes.every((size) => size <= 100)).toBe(true);
  expect(rpcSizes.reduce((a, b) => a + b, 0)).toBe(511);
});

it("reserves visible space for verified nearing and graduated tokens without inventing stages", () => {
  const base = {
    ...event,
    stage: "new" as const,
    progressPercent: 1,
    poolAddress: null,
    logoUrl: null,
    priceUsd: null,
    marketCapUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
    marketCheckedAt: null,
  };
  const rows = Array.from({ length: 100 }, (_, i) => ({
    ...base,
    mint: `token-${String(i)}`,
  }));
  const olderNear = {
    ...base,
    mint: "near",
    stage: "almost" as const,
    progressPercent: 99,
  };
  const graduated = {
    ...base,
    mint: "graduate",
    stage: "migrated" as const,
    progressPercent: 100,
  };
  const selected = selectLaunchColumns([...rows, olderNear, graduated]);
  expect(selected).toContain(olderNear);
  expect(selected).toContain(graduated);
  expect(selected).toHaveLength(80);
  expect(selected.filter((token) => token.stage === "almost")).toHaveLength(1);
});
