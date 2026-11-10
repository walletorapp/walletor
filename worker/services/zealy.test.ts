// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleZealyTask } from "./zealy";
import { verifyZealyTask } from "../accounting/runtime";
vi.mock("../accounting/runtime", () => ({ verifyZealyTask: vi.fn() }));
const key = "test-key-".repeat(8);
const payload = {
  userId: "user",
  communityId: "community",
  subdomain: "walletor-6650",
  questId: "quest",
  requestId: "request",
  accounts: { wallet: "11111111111111111111111111111111" },
};
const rateLimit = vi.fn(() => Promise.resolve({ success: true }));
const env: Partial<Env> = {
  ZEALY_API_KEY: key,
  ZEALY_COMMUNITY_SUBDOMAIN: "walletor-6650",
  ZEALY_RATE_LIMIT: { limit: rateLimit },
};
function request(body: unknown = payload, apiKey = key) {
  return new Request("https://walletor.com/api/integrations/zealy/daily-swap", {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.mocked(verifyZealyTask).mockReset().mockResolvedValue("NO_SWAP");
  rateLimit.mockClear().mockResolvedValue({ success: true });
});
afterEach(() => vi.useRealTimers());
describe("Zealy endpoint", () => {
  it("requires a dedicated key before examining activity", async () => {
    expect((await handleZealyTask(request(payload, "wrong"), env)).status).toBe(
      400,
    );
    expect((await handleZealyTask(request(), {})).status).toBe(400);
    expect(verifyZealyTask).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload, subdomain: "other" },
    { ...payload, accounts: { wallet: "0xabc" } },
    { ...payload, accounts: {} },
    {},
  ])("rejects wrong community or malformed identification", async (body) => {
    expect((await handleZealyTask(request(body), env)).status).toBe(400);
    expect(verifyZealyTask).not.toHaveBeenCalled();
  });
  it("rejects oversized JSON and malformed JSON", async () => {
    expect(
      (
        await handleZealyTask(
          request({ ...payload, extra: "a".repeat(9000) }),
          env,
        )
      ).status,
    ).toBe(400);
    const malformed = request();
    expect(
      (await handleZealyTask(new Request(malformed, { body: "{" }), env))
        .status,
    ).toBe(400);
    expect(verifyZealyTask).not.toHaveBeenCalled();
  });
  it("returns only a Zealy message, with no private ledger details or reward mutation", async () => {
    vi.mocked(verifyZealyTask).mockResolvedValue("VERIFIED");
    const response = await handleZealyTask(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      message: "Today's eligible Walletor swap is verified.",
    });
  });
  it("fails closed on missing evidence, unavailable accounting, and rate limits", async () => {
    expect((await handleZealyTask(request(), env)).status).toBe(400);
    vi.mocked(verifyZealyTask).mockRejectedValue(new Error("database secret"));
    const response = await handleZealyTask(request(), env);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("database secret");
    rateLimit.mockResolvedValue({ success: false });
    expect((await handleZealyTask(request(), env)).status).toBe(400);
  });
});
