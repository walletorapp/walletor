// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverQuestline,
  readQuestlineConfig,
  QUESTLINE_PUSH_URL,
} from "./questline";
import type { QuestlineJob } from "../accounting/questline";

const apiKey = `qlk_live_${"test".repeat(8)}`;
const job: QuestlineJob = {
  quest_id: 89,
  wallet_address: "11111111111111111111111111111111",
  utc_day: "2026-10-20",
  confirmed_at: "2026-10-20T11:00:00.000Z",
  transaction_hash: "verified-signature",
  lease: "lease",
  attempts: 1,
};
const now = new Date("2026-10-20T12:00:00.000Z");
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Questline server reporting", () => {
  it("uses project-key auth and sends the documented payload to the fixed provider", async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    expect(await deliverQuestline(job, apiKey, now)).toMatchObject({
      status: "ACCEPTED",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      QUESTLINE_PUSH_URL,
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` }),
        body: JSON.stringify({
          payload: {
            quest: 89,
            user: job.wallet_address,
            timestamp: now.getTime(),
          },
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).not.toContain("signature");
  });
  it("honors rate limits and never accepts a failed/ambiguous request", async () => {
    fetchMock.mockResolvedValue(
      new Response("private provider message", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
    );
    expect(await deliverQuestline(job, apiKey, now)).toEqual({
      status: "PENDING",
      code: "HTTP_429",
      retryAfterMs: 120_000,
    });
    fetchMock.mockResolvedValue(
      Response.json({ success: false, error: "not started" }),
    );
    expect((await deliverQuestline(job, apiKey, now)).status).toBe("PENDING");
    fetchMock.mockResolvedValue(
      new Response("maintenance", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect((await deliverQuestline(job, apiKey, now)).code).toBe(
      "INVALID_ACKNOWLEDGEMENT",
    );
  });
  it("does not follow redirects or forward the project key to another host", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.example/collect" },
      }),
    );
    expect(await deliverQuestline(job, apiKey, now)).toMatchObject({
      status: "PENDING",
      code: "HTTP_302",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
  it("keeps auth/draft failures retryable without leaking the key", async () => {
    fetchMock.mockResolvedValue(new Response(apiKey, { status: 403 }));
    expect(await deliverQuestline(job, apiKey, now)).toEqual({
      status: "PENDING",
      code: "HTTP_403",
      stop: true,
      retryAfterMs: 900_000,
    });
    fetchMock.mockRejectedValue(new Error(apiKey));
    expect(await deliverQuestline(job, apiKey, now)).toEqual({
      status: "PENDING",
      code: "NETWORK_OR_TIMEOUT",
    });
  });
  it("never sends yesterday's completion as today's reward or without credentials", async () => {
    expect(
      (
        await deliverQuestline(
          job,
          apiKey,
          new Date("2026-10-21T00:00:00.000Z"),
        )
      ).code,
    ).toBe("OUTSIDE_DAILY_WINDOW");
    expect((await deliverQuestline(job, "", now)).code).toBe(
      "KEY_NOT_CONFIGURED",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires explicit activation and valid campaign configuration", () => {
    expect(readQuestlineConfig({})).toBeNull();
    expect(() => readQuestlineConfig({ QUESTLINE_ENABLED: "true" })).toThrow(
      "invalid",
    );
    expect(
      readQuestlineConfig({
        QUESTLINE_ENABLED: "true",
        QUESTLINE_QUEST_ID: "89",
        QUESTLINE_CAMPAIGN_START_AT: now.toISOString(),
      }),
    ).toEqual({ questId: 89, startsAt: now.toISOString() });
  });
});
