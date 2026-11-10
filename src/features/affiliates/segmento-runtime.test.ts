import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createSegmentoRuntime } from "./segmento-runtime";
import { SEGMENTO_TEST_REFERRAL } from "./segmento-project";

const search = `?ref=${SEGMENTO_TEST_REFERRAL.referralCode}&utm_campaign=walletor-swap&sgm_rdr=1`;
function setup() {
  const client = {
    visit: vi.fn(),
    clear: vi.fn(),
    walletConnected: vi.fn(),
    swapConfirmed: vi.fn(),
  };
  const load = vi.fn().mockResolvedValue(client);
  const runtime = createSegmentoRuntime(load, () => window.sessionStorage);
  return { client, load, runtime };
}
beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("ignores native invites and malformed codes, and starts for the test referral", async () => {
  const { runtime, load, client } = setup();
  runtime.route("/", "?ref=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  runtime.choose("allow");
  expect(runtime.getSnapshot().referralCode).toBeNull();
  runtime.route("/", "?ref=../invalid");
  expect(runtime.getSnapshot().referralCode).toBeNull();
  expect(load).not.toHaveBeenCalled();
  runtime.route("/", search);
  runtime.connected("wallet-a");
  expect(runtime.getSnapshot().choice).toBe("automatic");
  await vi.waitFor(() => {
    expect(client.walletConnected).toHaveBeenCalledWith("wallet-a");
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(client.visit).toHaveBeenCalled();
});

it("isolates a direct Walletor visit from a previously saved Segmento session across navigation and reload", async () => {
  const { runtime, client } = setup();
  runtime.route("/", search);
  await vi.waitFor(() => {
    expect(client.visit).toHaveBeenCalled();
  });
  client.visit.mockClear();
  client.walletConnected.mockClear();
  client.swapConfirmed.mockClear();
  runtime.route(
    "/",
    "?ref=wlr-So11111111111111111111111111111111111111112&sgm_rdr=1",
  );
  runtime.connected("direct-wallet");
  runtime.swapReporter("direct-wallet")({
    status: "Success",
    signature: "direct-swap",
  });
  runtime.route("/airdrop", "");
  expect(runtime.getSnapshot().publicPage).toBe(false);
  expect(client.clear).toHaveBeenCalled();
  expect(client.walletConnected).not.toHaveBeenCalled();
  expect(client.swapConfirmed).not.toHaveBeenCalled();
  const reloaded = setup();
  reloaded.runtime.route("/", "");
  reloaded.runtime.connected("direct-wallet");
  expect(reloaded.runtime.getSnapshot().publicPage).toBe(false);
  expect(reloaded.load).not.toHaveBeenCalled();
  reloaded.runtime.route("/", search);
  await vi.waitFor(() => {
    expect(reloaded.load).toHaveBeenCalledTimes(1);
  });
});

it("passes a new creator's code and campaign to the SDK and preserves them on reload", async () => {
  const { runtime, load, client } = setup();
  runtime.route(
    "/",
    "?ref=bright-blue-falcon&utm_campaign=october-launch&sgm_rdr=1",
  );
  runtime.connected("wallet-a");
  runtime.swapReporter("wallet-a")({
    status: "Success",
    signature: "new-swap",
  });
  await vi.waitFor(() => {
    expect(client.swapConfirmed).toHaveBeenCalledWith("wallet-a", "new-swap");
  });
  expect(load).toHaveBeenCalledWith(
    expect.objectContaining({
      referralCode: "bright-blue-falcon",
      campaign: "october-launch",
    }),
  );
  runtime.route("/swap", "?ref=another-creator&utm_campaign=other");
  const next = setup();
  next.runtime.route("/", "");
  await vi.waitFor(() => {
    expect(next.load).toHaveBeenCalledWith(
      expect.objectContaining({
        referralCode: "bright-blue-falcon",
        campaign: "october-launch",
      }),
    );
  });
});

it("preserves opt-out for a new creator across reload and later referral links", () => {
  const { runtime } = setup();
  runtime.route("/", "?ref=bright-blue-falcon");
  runtime.choose("decline");
  const next = setup();
  next.runtime.route("/", "?ref=another-creator");
  expect(next.runtime.getSnapshot().choice).toBe("decline");
  expect(next.load).not.toHaveBeenCalled();
});

it("does not report rejected or pending swaps, or swaps begun before attribution or while stopped", async () => {
  const { runtime, client } = setup();
  const beforeReferral = runtime.swapReporter("wallet-a");
  runtime.route("/", search);
  beforeReferral({ status: "Success", signature: "old" });
  runtime.choose("decline");
  const whileStopped = runtime.swapReporter("wallet-a");
  runtime.choose("allow");
  whileStopped({ status: "Success", signature: "stopped" });
  const report = runtime.swapReporter("wallet-a");
  report({ status: "Failed", signature: "failed" });
  report({ status: "Pending", signature: "pending" });
  report({ status: "Success" });
  runtime.connected("wallet-b");
  report({ status: "Success", signature: "new-confirmed" });
  await vi.waitFor(() => {
    expect(client.swapConfirmed).toHaveBeenCalledTimes(1);
  });
  expect(client.swapConfirmed).toHaveBeenCalledWith(
    "wallet-a",
    "new-confirmed",
  );
});

it("retains automatic attribution through SPA navigation and reload in the same tab", async () => {
  const { runtime } = setup();
  runtime.route("/", search);
  runtime.route("/swap", "?ref=other-person");
  expect(runtime.getSnapshot().referralCode).toBe(
    SEGMENTO_TEST_REFERRAL.referralCode,
  );
  const next = setup();
  next.runtime.route("/swap", "");
  expect(next.runtime.getSnapshot().choice).toBe("automatic");
  next.runtime.connected("wallet");
  await vi.waitFor(() => {
    expect(next.client.walletConnected).toHaveBeenCalledWith("wallet");
  });
});

it("does not initialize on admin pages, even with an enabled saved preference", async () => {
  const initial = setup();
  initial.runtime.route("/", search);
  const next = setup();
  next.runtime.route("/admin", search);
  next.runtime.connected("admin-wallet");
  expect(next.load).not.toHaveBeenCalled();
  initial.runtime.route("/admin/settings", "");
  initial.runtime.connected("admin-wallet");
  await Promise.resolve();
  expect(initial.client.walletConnected).not.toHaveBeenCalled();
});

it("stops future reporting on decline, including a swap already in progress", async () => {
  const { runtime, client, load } = setup();
  runtime.route("/", search);
  await vi.waitFor(() => {
    expect(client.visit).toHaveBeenCalled();
  });
  const report = runtime.swapReporter("wallet-a");
  runtime.choose("decline");
  runtime.connected("wallet-a");
  report({ status: "Success", signature: "confirmed-after-decline" });
  expect(client.clear).toHaveBeenCalled();
  expect(client.swapConfirmed).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  const next = setup();
  next.runtime.route("/", search);
  expect(next.runtime.getSnapshot().choice).toBe("decline");
  expect(next.load).not.toHaveBeenCalled();
});

it("handles SDK loading failure without throwing from swap reporting", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const load = vi.fn().mockRejectedValue(new Error("chunk unavailable"));
  const runtime = createSegmentoRuntime(load, () => window.sessionStorage);
  runtime.route("/", search);
  expect(() => {
    runtime.swapReporter("wallet")({
      status: "Success",
      signature: "confirmed",
    });
  }).not.toThrow();
  await vi.waitFor(() => {
    expect(warn).toHaveBeenCalled();
  });
});

it("remains usable when session storage is unavailable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { client } = setup();
  const runtime = createSegmentoRuntime(
    () => Promise.resolve(client),
    () => {
      throw new Error("storage denied");
    },
  );
  runtime.route("/", search);
  runtime.connected("wallet");
  await vi.waitFor(() => {
    expect(client.walletConnected).toHaveBeenCalledWith("wallet");
  });
});

it("preserves a decline saved by the previous consent popup", () => {
  window.sessionStorage.setItem(
    "walletor:segmento-pilot:v1",
    JSON.stringify({
      referralCode: SEGMENTO_TEST_REFERRAL.referralCode,
      choice: "decline",
    }),
  );
  const { runtime, load } = setup();
  runtime.route("/", search);
  runtime.connected("wallet");
  runtime.route("/swap", search);
  runtime.swapReporter("wallet")({ status: "Success", signature: "confirmed" });
  expect(runtime.getSnapshot().choice).toBe("decline");
  expect(load).not.toHaveBeenCalled();
});
