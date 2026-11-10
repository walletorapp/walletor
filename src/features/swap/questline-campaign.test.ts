import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("only tags explicit quest visits, persists within the tab/day and expires at UTC midnight", async () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-20T23:59:00.000Z");
  const campaign = await import("./questline-campaign");
  expect(campaign.questlineCampaign()).toBeUndefined();
  window.history.replaceState(null, "", "/?quest=89");
  expect(campaign.rememberQuestlineCampaign()).toBe(89);
  window.history.replaceState(null, "", "/?inputMint=SOL");
  expect(campaign.questlineCampaign()).toBe(89);
  vi.setSystemTime("2026-10-21T00:00:00.000Z");
  expect(campaign.questlineCampaign()).toBeUndefined();
});

it("allows leaving the campaign and does not reactivate while the URL is changing", async () => {
  const campaign = await import("./questline-campaign");
  window.history.replaceState(null, "", "/?quest=89");
  campaign.rememberQuestlineCampaign();
  campaign.leaveQuestlineCampaign();
  expect(campaign.questlineCampaign()).toBeUndefined();
  expect(campaign.rememberQuestlineCampaign()).toBeUndefined();
  expect(sessionStorage.getItem("walletor:questline:89:v1")).toBeNull();
});

it("still works from an explicit URL if the browser blocks storage", async () => {
  const campaign = await import("./questline-campaign");
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  window.history.replaceState(null, "", "/?quest=89");
  expect(campaign.rememberQuestlineCampaign()).toBe(89);
  campaign.leaveQuestlineCampaign();
  expect(campaign.questlineCampaign()).toBeUndefined();
});
