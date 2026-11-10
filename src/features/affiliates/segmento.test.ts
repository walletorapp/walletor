import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeToken } from "@segmento/core";
import bs58 from "bs58";
import { prepareSegmentoSession } from "./segmento";
import { SEGMENTO_TEST_REFERRAL } from "./segmento-project";
import { createSegmentoRuntime } from "./segmento-runtime";

const wallet = bs58.encode(new Uint8Array(32).fill(7));
const signature = bs58.encode(new Uint8Array(64).fill(8));
const token = encodeToken("walletor-test", "Walletor test fixture");
const options = {
  enabled: true,
  projectToken: token,
  referralCode: SEGMENTO_TEST_REFERRAL.referralCode,
};

beforeEach(() => {
  for (const name of ["sgm_ref", "sgm_impression_sent"])
    document.cookie = `${name}=; Max-Age=0; path=/`;
  window.history.replaceState(
    null,
    "",
    "/?ref=untrusted&private=do-not-forward#private",
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const name of ["sgm_ref", "sgm_impression_sent"])
    document.cookie = `${name}=; Max-Age=0; path=/`;
  window.history.replaceState(null, "", "/");
});

describe("Segmento SDK adapter", () => {
  it("does nothing by default, including cookie writes and network calls", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(
      prepareSegmentoSession({ ...options, enabled: undefined, fetchImpl }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain("sgm_");
  });

  it("rejects invalid configuration before initializing", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(
      prepareSegmentoSession({ ...options, projectToken: "bad", fetchImpl }),
    ).toBeNull();
    expect(
      prepareSegmentoSession({ ...options, referralCode: "../bad", fetchImpl }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the published SDK contract while pinning attribution and removing unrelated page data", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null));
    const session = prepareSegmentoSession({ ...options, fetchImpl });
    session?.walletConnected(wallet);
    session?.swapConfirmed(wallet, signature);
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
    const bodies = fetchImpl.mock.calls.map(([, init]) => {
      if (typeof init?.body !== "string")
        throw new Error("Expected a JSON string");
      return JSON.parse(init.body) as unknown;
    });
    expect(bodies[0]).toEqual({
      url: "https://walletor.com/?ref=kind-mediumpurple-sparrow",
    });
    const expectedWallet = {
      project_id: "walletor-test",
      origin_url: "https://walletor.com/?ref=kind-mediumpurple-sparrow",
      referral_code: "kind-mediumpurple-sparrow",
      wallet_address: wallet,
      wallet_chain: "solana",
    };
    expect(bodies[1]).toEqual(expectedWallet);
    expect(bodies[2]).toEqual({
      ...expectedWallet,
      meta: { tx: signature },
    });
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      "https://referral.segmento.tech/manager-api/wallet-transaction",
    );
    expect(JSON.stringify(bodies)).not.toMatch(/private|untrusted/);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
    }
  });

  it("deduplicates overlapping and completed events within a session", async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(pending);
    const session = prepareSegmentoSession({ ...options, fetchImpl });
    session?.swapConfirmed(wallet, signature);
    session?.swapConfirmed(wallet, signature);
    session?.swapConfirmed(wallet, signature);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resolveRequest(new Response(null));
    await pending;
    session?.swapConfirmed(wallet, signature);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("observes HTTP errors without rejecting the swap and permits a later retry", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const session = prepareSegmentoSession({ ...options, fetchImpl });
    expect(() => session?.swapConfirmed(wallet, signature)).not.toThrow();
    await vi.waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    fetchImpl.mockResolvedValue(new Response(null));
    session?.swapConfirmed(wallet, signature);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      wallet,
    );
  });

  it("isolates network failures and invalid wallet or signature input", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    const session = prepareSegmentoSession({ ...options, fetchImpl });
    session?.walletConnected("bad-wallet");
    session?.swapConfirmed(wallet, "bad-signature");
    await vi.waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

it("reports a new KOL through the real runtime and SDK with its own attribution", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
  window.sessionStorage.clear();
  const runtime = createSegmentoRuntime(
    (config) =>
      Promise.resolve(prepareSegmentoSession({ ...config, fetchImpl })),
    () => window.sessionStorage,
  );
  runtime.route(
    "/swap",
    "?ref=bright-blue-falcon&utm_campaign=october-launch&private=omit-me",
  );
  runtime.connected(wallet);
  runtime.swapReporter(wallet)({ status: "Success", signature });
  await vi.waitFor(() => {
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  const request = fetchImpl.mock.calls.find(
    ([url]) => typeof url === "string" && url.endsWith("/wallet-transaction"),
  );
  const body = request?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected SDK JSON body");
  expect(JSON.parse(body)).toEqual({
    project_id: "walletor",
    origin_url:
      "https://walletor.com/?ref=bright-blue-falcon&utm_campaign=october-launch",
    referral_code: "bright-blue-falcon",
    wallet_address: wallet,
    wallet_chain: "solana",
    meta: { tx: signature },
  });
  expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("omit-me");
  runtime.choose("decline");
  window.sessionStorage.clear();
});
