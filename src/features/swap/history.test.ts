// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadSwapHistory, saveSwapHistory } from "./history";

describe("swap history public launch cutover", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return values.size;
      },
      clear: () => {
        values.clear();
      },
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage);
  });

  it("removes pre-launch device history", () => {
    localStorage.setItem("walletor.confirmed-swaps.v1", "[]");

    expect(loadSwapHistory()).toEqual([]);
    expect(localStorage.getItem("walletor.confirmed-swaps.v1")).toBeNull();
  });

  it("writes new history only to the public launch storage version", () => {
    localStorage.setItem("walletor.confirmed-swaps.v1", "[]");

    saveSwapHistory([]);

    expect(localStorage.getItem("walletor.confirmed-swaps.v1")).toBeNull();
    expect(localStorage.getItem("walletor.confirmed-swaps.v2")).toBe("[]");
  });
});
