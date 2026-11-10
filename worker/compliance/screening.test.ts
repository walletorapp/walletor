// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  assertScreenedWallets,
  complianceStatus,
  screenedSwapSigners,
  saveOfacSnapshot,
} from "./screening";
import {
  OFAC_SOURCE_URL,
  fetchOfacSnapshot,
  parseOfacSource,
  type OfacSnapshot,
} from "./ofac";
import { app } from "../app";
import {
  prepareUsdcClaimDistribution,
  buildUsdcClaimTransaction,
} from "../services/usdc-claims";
import { PRIZE_DRAW_ALGORITHM_VERSION } from "../../shared/prize-draw-contracts";

const now = new Date("2026-09-10T20:00:00.000Z");
const listed = "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi";
const wallet = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const snapshot: OfacSnapshot = {
  source: OFAC_SOURCE_URL,
  hash: "a".repeat(64),
  fetchedAt: now.toISOString(),
  publishedDate: "09/10/2026",
  recordCount: 1000,
  digitalAddressCount: 2,
  entries: [{ address: listed, entityId: "1" }],
};

function database(value: OfacSnapshot | null = snapshot) {
  const statement = {
    bind: vi.fn<D1PreparedStatement["bind"]>(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
    raw: vi.fn(),
  } satisfies D1PreparedStatement;
  statement.bind.mockReturnValue(statement);
  vi.mocked(statement.first).mockResolvedValue(
    value ? { snapshot_json: JSON.stringify(value) } : null,
  );
  const db = {
    prepare: vi.fn<(query: string) => D1PreparedStatement>(() => statement),
    batch: vi.fn(),
    exec: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required by the D1Database mock interface; never invoked.
    dump: vi.fn(),
    withSession: vi.fn(),
  } satisfies D1Database;
  return {
    db,
    statement,
    env: { DB: db, SANCTIONS_SCREENING_ENABLED: "true" as const },
  };
}

describe("sanctions enforcement", () => {
  it("persists a limited no-match decision without labelling a wallet AML cleared", async () => {
    const { env, statement } = database();
    await assertScreenedWallets(env, [wallet], "SWAP_ORDER", "order", now);
    expect(statement.bind).toHaveBeenCalledWith(
      expect.any(String),
      wallet,
      "SWAP_ORDER",
      "order",
      "NO_DIRECT_MATCH",
      "ofac-explicit-sol-v1",
      snapshot.hash,
      now.toISOString(),
    );
  });
  it("blocks a direct match and records a review reference", async () => {
    const { env, statement } = database();
    await expect(
      assertScreenedWallets(env, [listed], "SWAP_EXECUTE", "order", now),
    ).rejects.toMatchObject({ status: 403, code: "WALLET_RESTRICTED" });
    expect(statement.bind).toHaveBeenCalledWith(
      expect.any(String),
      listed,
      "SWAP_EXECUTE",
      "order",
      "RESTRICTED",
      "ofac-explicit-sol-v1",
      snapshot.hash,
      now.toISOString(),
    );
  });
  it.each([
    null,
    { ...snapshot, fetchedAt: "2026-09-09T19:59:59.000Z" },
    { ...snapshot, fetchedAt: "2026-09-11T00:00:00.000Z" },
  ])("never passes a missing, stale, or future source", async (source) => {
    const { env } = database(source);
    await expect(
      assertScreenedWallets(env, [wallet], "SWAP_ORDER", "order", now),
    ).rejects.toMatchObject({ code: "SCREENING_UNAVAILABLE" });
  });
  it("preserves a known restriction during a source outage", async () => {
    const { env } = database({
      ...snapshot,
      fetchedAt: "2026-09-08T00:00:00.000Z",
    });
    await expect(
      assertScreenedWallets(env, [listed], "CLAIM_BUILD", "claim", now),
    ).rejects.toMatchObject({ code: "WALLET_RESTRICTED" });
  });
  it("fails closed when audit persistence fails", async () => {
    const { env, db } = database();
    vi.mocked(db.batch).mockRejectedValue(new Error("offline"));
    await expect(
      assertScreenedWallets(env, [wallet], "SWAP_ORDER", "order", now),
    ).rejects.toMatchObject({ code: "SCREENING_UNAVAILABLE" });
  });
  it("reaches funding verification without querying screening records", async () => {
    const { env, db } = database();
    const upstream = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("RPC offline"));
    await expect(
      prepareUsdcClaimDistribution(
        db,
        {
          ...env,
          PAYOUTS_ENABLED: "true",
          USDC_DISTRIBUTION_FUNDING_ENABLED: "true",
          SOLANA_CLAIM_AUTHORITY_ADDRESS: wallet,
          SOLANA_CLAIM_NETWORK: "mainnet",
          SOLANA_CLAIM_PROGRAM_ID:
            "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
          SOLANA_CLAIM_RPC_URL: "https://api.mainnet-beta.solana.com",
          SOLANA_SWITCHBOARD_PROGRAM_ID:
            "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
          SOLANA_SWITCHBOARD_QUEUE_ADDRESS:
            "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w",
          PRIZE_POOL_CLAIM_FEE_BPS: "250",
        },
        {
          roundId: "round-1",
          seedAddress: wallet,
          randomnessAccount: wallet,
          randomnessCommitTransactionSignature: "x",
          randomnessRevealTransactionSignature: "y",
        },
        {
          grossPrizeAmountAtomic: "1000000",
          winners: [{ rank: 1, winnerAddress: listed }],
          randomnessValue: "a".repeat(64),
          algorithmVersion: PRIZE_DRAW_ALGORITHM_VERSION,
        },
        "operator@example.com",
        "request",
        upstream,
        now,
      ),
    ).rejects.toMatchObject({ code: "SOLANA_CLAIM_RPC_UNAVAILABLE" });
    expect(upstream).toHaveBeenCalled();
    expect(db.prepare).not.toHaveBeenCalled();
  });
  it("uses claim configuration instead of wallet screening without mutating entitlements", async () => {
    const { env, db } = database();
    await expect(
      buildUsdcClaimTransaction(env, listed, "entitlement", vi.fn(), now),
    ).rejects.toThrow("USDC claims require SOLANA_CLAIM_NETWORK=mainnet.");
    expect(
      vi
        .mocked(db.prepare)
        .mock.calls.every(([sql]) => !/UPDATE|DELETE/.test(sql)),
    ).toBe(true);
  });
  it.each([snapshot, null])(
    "swap orders do not query sanctions data",
    async (source) => {
      const { env, db } = database(source);
      const response = await app.request(
        `/api/swap/order?taker=${listed}`,
        {},
        env,
      );
      expect(response.status).not.toBe(403);
      expect(db.prepare).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain("SCREENING");
    },
  );
  it("reports missing source as unavailable", async () => {
    const { env } = database(null);
    expect((await complianceStatus(env, now)).state).toBe("UNAVAILABLE");
  });
  it("archives source evidence and atomically replaces only newer snapshots", async () => {
    const { db } = database();
    await saveOfacSnapshot(db, snapshot);
    expect(db.batch).toHaveBeenCalledOnce();
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining(
        "excluded.fetched_at > compliance_sources.fetched_at",
      ),
    );
  });
});

describe("signed wallet binding", () => {
  function transaction(sponsored = false) {
    const signer = Keypair.generate();
    const payer = sponsored ? Keypair.generate().publicKey : signer.publicKey;
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: SystemProgram.programId.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    tx.sign([signer]);
    return {
      signer,
      tx,
      encoded: Buffer.from(tx.serialize()).toString("base64"),
      payer,
    };
  }
  it.each([false, true])(
    "verifies taker signatures including sponsored transactions: %s",
    (sponsored) => {
      const { encoded, signer, payer } = transaction(sponsored);
      expect(
        screenedSwapSigners(encoded, signer.publicKey.toBase58()),
      ).toContain(payer.toBase58());
    },
  );
  it("rejects a substituted wallet and a tampered signature", () => {
    const { tx, signer, encoded } = transaction();
    expect(() => screenedSwapSigners(encoded, wallet)).toThrow(
      /selected wallet/,
    );
    tx.signatures[0] = new Uint8Array(64);
    expect(() =>
      screenedSwapSigners(
        Buffer.from(tx.serialize()).toString("base64"),
        signer.publicKey.toBase58(),
      ),
    ).toThrow(/selected wallet/);
  });
});

describe("official XML ingestion", () => {
  function xml(id = listed) {
    const entries = Array.from(
      { length: 1000 },
      (_, i) =>
        `<sdnEntry><uid>${String(i + 1)}</uid>${i === 0 ? `<idList><id><idType>Digital Currency Address - SOL</idType><idNumber>${id}</idNumber></id></idList>` : ""}</sdnEntry>`,
    ).join("");
    return `<sdnList xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML"><publshInformation><Publish_Date>09/10/2026</Publish_Date><Record_Count>1000</Record_Count></publshInformation>${entries}</sdnList>`;
  }
  function stream(value: string) {
    const bytes = new TextEncoder().encode(value);
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) controller.close();
        else {
          controller.enqueue(bytes.slice(offset, offset + 71));
          offset += 71;
        }
      },
    });
  }
  it("parses split chunks and validates the complete source", async () => {
    const result = await parseOfacSource(stream(xml()), now);
    expect(result.entries).toEqual([{ address: listed, entityId: "1" }]);
    expect(result.recordCount).toBe(1000);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects source redirects outside the official download hosts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/fake.xml" },
      }),
    );
    await expect(fetchOfacSnapshot(fetcher, now)).rejects.toThrow(/untrusted/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("accepts the official government download redirect", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/Published/test/SDN.XML",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(stream(xml())));
    expect((await fetchOfacSnapshot(fetcher, now)).entries[0]?.address).toBe(
      listed,
    );
  });
  it.each([
    (source: string) =>
      source.replace("<Record_Count>1000", "<Record_Count>1001"),
    (source: string) => source.slice(0, -10),
    (source: string) => `<!DOCTYPE sdnList [<!ENTITY x "bad">]>${source}`,
    (source: string) => source.replace(listed, "invalid-address"),
    (source: string) => source.replace("exports/XML", "exports/UNKNOWN"),
  ])("rejects incomplete or untrusted source structures", async (mutate) => {
    await expect(parseOfacSource(stream(mutate(xml())), now)).rejects.toThrow();
  });
});

it("prevents edits to screening evidence in SQLite", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(
        new URL(
          "../../migrations/0014_sanctions_screening.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    db.prepare(
      "INSERT INTO compliance_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "id",
      wallet,
      "SWAP_ORDER",
      "ref",
      "NO_DIRECT_MATCH",
      "v1",
      "hash",
      now.toISOString(),
    );
    expect(() => {
      db.exec("UPDATE compliance_events SET decision='NO_DIRECT_MATCH'");
    }).toThrow(/append-only/);
    expect(() => {
      db.exec("DELETE FROM compliance_events");
    }).toThrow(/retention/);
  } finally {
    db.close();
  }
});
