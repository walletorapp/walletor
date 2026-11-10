// @vitest-environment node

import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { describe, expect, it, vi } from "vitest";

import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
} from "../../shared/usdc-claim-contracts";
import { prepareSwitchboardRandomnessReveal } from "./switchboard-randomness";

const authority = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const randomness = "AUpCxz1UZxJCrKmB2meDKg5BEQoWEar8512Zt2kxVBPb";
const oracle = "3Nv1DJdf7163FcB5dFEQGKbw6dUK4HqtwuUcyUf3DWni";
const privateRpc = "https://private-rpc.example/secret";
const publicRpc = "https://api.mainnet-beta.solana.com";
const gateway = "https://141.94.193.169.xip.switchboard-oracles.xyz/mainnet";

const env = {
  PAYOUTS_ENABLED: "true",
  SOLANA_CLAIM_NETWORK: "mainnet",
  SOLANA_CLAIM_PROGRAM_ID: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_CLAIM_AUTHORITY_ADDRESS: authority,
  SOLANA_CLAIM_RPC_URL: publicRpc,
  SOLANA_CLAIM_RPC_URL_PRIVATE: privateRpc,
  SOLANA_SWITCHBOARD_PROGRAM_ID: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
  SOLANA_SWITCHBOARD_QUEUE_ADDRESS: SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
  PRIZE_POOL_CLAIM_FEE_BPS: "250",
} as const satisfies Partial<Env>;

function accountResponse(data: Uint8Array): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      context: { slot: 444_794_300 },
      value: {
        data: [Buffer.from(data).toString("base64"), "base64"],
        executable: false,
        lamports: 1,
        owner: SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
        rentEpoch: 0,
      },
    },
  });
}

function randomnessAccountData(): Uint8Array {
  const data = new Uint8Array(480);
  data.set(Uint8Array.of(0x0a, 0x42, 0xe5, 0x87, 0xdc, 0xef, 0xd9, 0x72));
  data.set(new PublicKey(authority).toBytes(), 8);
  data.set(
    new PublicKey(SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS).toBytes(),
    40,
  );
  data.set(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    72,
  );
  new DataView(data.buffer).setBigUint64(104, 444_794_197n, true);
  data.set(new PublicKey(oracle).toBytes(), 112);
  return data;
}

function oracleAccountData(url = gateway): Uint8Array {
  const data = new Uint8Array(4_096);
  data.set(new TextEncoder().encode(url), 3_584);
  return data;
}

function requestMethod(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("Missing request body.");
  const parsed: unknown = JSON.parse(init.body);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("method" in parsed) ||
    typeof parsed.method !== "string"
  ) {
    throw new Error("Missing RPC method.");
  }
  return parsed.method;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("Switchboard randomness reveal preparation", () => {
  it.each([200, 503])(
    "preserves the Phantom signer after initial gateway status %s",
    async (initialStatus) => {
      let accountRequest = 0;
      let gatewayRequests = 0;
      const gatewayBodies: string[] = [];
      const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === privateRpc) {
          const method = requestMethod(init);
          if (method === "getAccountInfo") {
            accountRequest += 1;
            return Promise.resolve(
              accountResponse(
                accountRequest === 1
                  ? randomnessAccountData()
                  : oracleAccountData(),
              ),
            );
          }
          if (method === "getLatestBlockhash") {
            return Promise.resolve(
              Response.json({
                jsonrpc: "2.0",
                id: 2,
                result: {
                  context: { slot: 444_794_300 },
                  value: {
                    blockhash: oracle,
                    lastValidBlockHeight: 422_843_116,
                  },
                },
              }),
            );
          }
        }
        if (
          url === `${gateway}/gateway/api/v1/randomness_reveal` &&
          typeof init?.body === "string"
        ) {
          gatewayRequests += 1;
          gatewayBodies.push(init.body);
          expect(init.body).toContain(new URL(publicRpc).toString());
          expect(init.body).not.toContain(privateRpc);
          if (initialStatus === 503 && gatewayRequests === 1) {
            return Promise.resolve(
              new Response("<html>Unavailable</html>", { status: 503 }),
            );
          }
          return Promise.resolve(
            Response.json({
              signature: Buffer.alloc(64, 7).toString("base64"),
              recovery_id: 0,
              value: Array.from({ length: 32 }, (_, index) => index),
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      });

      const result = await prepareSwitchboardRandomnessReveal(
        env,
        randomness,
        fetcher,
      );
      const transaction = Transaction.from(
        Buffer.from(result.transaction, "base64"),
      );
      const instruction = transaction.instructions[0];

      expect(transaction.feePayer?.toBase58()).toBe(authority);
      expect(instruction?.programId.toBase58()).toBe(
        SWITCHBOARD_ON_DEMAND_MAINNET_PROGRAM_ID,
      );
      expect(instruction?.data.byteLength).toBe(105);
      expect(
        instruction ? bytesToHex(instruction.data.subarray(0, 8)) : null,
      ).toBe("c5b5bb0a1e3a1449");
      expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(randomness);
      expect(instruction?.keys[1]?.pubkey.toBase58()).toBe(oracle);
      expect(instruction?.keys[2]?.pubkey.toBase58()).toBe(
        SWITCHBOARD_ON_DEMAND_MAINNET_QUEUE_ADDRESS,
      );
      expect(instruction?.keys[5]).toMatchObject({
        isSigner: true,
        isWritable: true,
      });
      expect(instruction?.keys[5]?.pubkey.toBase58()).toBe(authority);
      expect(result.lastValidBlockHeight).toBe("422843116");
      expect(gatewayRequests).toBe(initialStatus === 503 ? 2 : 1);
      expect(new Set(gatewayBodies).size).toBe(1);
    },
  );

  it.each([
    [
      503,
      "<html>Service Temporarily Unavailable</html>",
      "SWITCHBOARD_RANDOMNESS_GATEWAY_UNAVAILABLE",
      2,
    ],
    [429, "Too many requests", "SWITCHBOARD_RANDOMNESS_GATEWAY_UNAVAILABLE", 1],
    [400, "Bad request", "SWITCHBOARD_RANDOMNESS_GATEWAY_REJECTED", 1],
    [
      200,
      "<html>Invalid</html>",
      "SWITCHBOARD_RANDOMNESS_GATEWAY_INVALID_RESPONSE",
      1,
    ],
    [
      200,
      JSON.stringify({ value: [1] }),
      "SWITCHBOARD_RANDOMNESS_GATEWAY_INVALID_RESPONSE",
      1,
    ],
  ])(
    "classifies HTTP %s and bounds retries",
    async (status, body, code, attempts) => {
      let accounts = 0;
      let requests = 0;
      const fetcher = vi.fn((input: RequestInfo | URL) => {
        if (requestUrl(input) === privateRpc) {
          accounts += 1;
          return Promise.resolve(
            accountResponse(
              accounts === 1 ? randomnessAccountData() : oracleAccountData(),
            ),
          );
        }
        requests += 1;
        return Promise.resolve(new Response(body, { status }));
      });
      await expect(
        prepareSwitchboardRandomnessReveal(env, randomness, fetcher),
      ).rejects.toMatchObject({ code });
      expect(accounts).toBe(2);
      expect(requests).toBe(attempts);
    },
  );

  it("rejects a non-Switchboard gateway before making an outbound request", async () => {
    let accountRequest = 0;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input) !== privateRpc) {
        return Promise.reject(
          new Error("The untrusted gateway must not be contacted."),
        );
      }
      expect(requestMethod(init)).toBe("getAccountInfo");
      accountRequest += 1;
      return Promise.resolve(
        accountResponse(
          accountRequest === 1
            ? randomnessAccountData()
            : oracleAccountData("https://untrusted.example/mainnet"),
        ),
      );
    });

    await expect(
      prepareSwitchboardRandomnessReveal(env, randomness, fetcher),
    ).rejects.toMatchObject({
      status: 409,
      code: "INVALID_SWITCHBOARD_RANDOMNESS_ACCOUNT",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
