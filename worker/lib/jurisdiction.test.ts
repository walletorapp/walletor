import { describe, expect, it } from "vitest";

import {
  isRwaPageRequest,
  unavailableCountry,
  unavailableJurisdictionResponse,
  unavailableRwaCountry,
  unavailableRwaJurisdictionResponse,
} from "./jurisdiction";

describe("jurisdiction availability", () => {
  it.each([
    "AF",
    "CN",
    "CD",
    "CI",
    "CU",
    "IR",
    "IQ",
    "KP",
    "LY",
    "MK",
    "ML",
    "MM",
    "NI",
    "PS",
    "RU",
    "RS",
    "SO",
    "SD",
    "SY",
    "US",
    "YE",
    "ZW",
  ])("preserves the live block for %s", (country) => {
    const request = new Request("https://walletor.com/api/swap", {
      headers: { "CF-IPCountry": country, "CF-Connecting-IP": "192.0.2.5" },
    });
    expect(unavailableCountry(request)).toBe(country);
  });

  it("allows Kosovo from any IP while keeping listed countries blocked", () => {
    const request = (country: string, ip: string) =>
      new Request("https://walletor.com/", {
        headers: {
          "CF-IPCountry": country,
          "CF-Connecting-IP": ip,
          "X-Forwarded-For": "192.0.2.6",
        },
      });
    expect(unavailableCountry(request("XK", "192.0.2.6"))).toBeNull();
    expect(unavailableCountry(request("XK", "192.0.2.5"))).toBeNull();
    expect(unavailableCountry(request("XK", ""))).toBeNull();
    expect(unavailableCountry(request("US", "192.0.2.6"))).toBe("US");
    for (const path of ["/", "/api/swap/order", "/api/swap/execute"]) {
      const req = new Request(`https://walletor.com${path}`, {
        method: "POST",
      });
      Object.defineProperty(req, "cf", { value: { country: "XK" } });
      expect(unavailableCountry(req)).toBeNull();
    }
  });

  it("prefers trusted country metadata over a contradictory country header", () => {
    const request = new Request("https://walletor.com/", {
      headers: { "CF-IPCountry": "DE" },
    });
    Object.defineProperty(request, "cf", { value: { country: "US" } });
    expect(unavailableCountry(request)).toBe("US");
  });

  it("serves both official social links without application assets or scripts", async () => {
    const response = unavailableJurisdictionResponse(
      new Request("https://walletor.com/"),
      "XK",
    );
    const html = await response.text();
    expect(html).toContain(
      'href="https://x.com/walletorai" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain(
      'href="https://t.me/walletorswap" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).not.toMatch(/<script|src=/i);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it.each(["/api", "/api/swap", "/admin/api", "/admin/api/claims"])(
    "denies API %s with JSON for all methods",
    async (path) => {
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const response = unavailableJurisdictionResponse(
          new Request(`https://walletor.com${path}`, { method }),
          "XK",
        );
        expect(response.status).toBe(451);
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
        expect(await response.json()).toMatchObject({
          error: {
            code: "SERVICE_UNAVAILABLE_IN_JURISDICTION",
            retryable: false,
          },
        });
      }
    },
  );
  it("identifies Serbia using Cloudflare's trusted request metadata", () => {
    const request = new Request("https://walletor.com/");
    Object.defineProperty(request, "cf", {
      configurable: true,
      value: { country: "RS" },
    });

    expect(unavailableCountry(request)).toBe("RS");
  });

  it("uses Cloudflare's country header when request metadata is unavailable", () => {
    const request = new Request("https://walletor.com/", {
      headers: { "CF-IPCountry": "RS" },
    });

    expect(unavailableCountry(request)).toBe("RS");
  });

  it("does not restrict countries outside the unavailable list", () => {
    const request = new Request("https://walletor.com/", {
      headers: { "CF-IPCountry": "DE" },
    });

    expect(unavailableCountry(request)).toBeNull();
  });

  it("keeps the United States blocked and preserves the RWA restriction", () => {
    const request = new Request("https://walletor.com/stocks-rwa", {
      headers: { "CF-IPCountry": "US" },
    });

    expect(unavailableCountry(request)).toBe("US");
    expect(unavailableRwaCountry(request)).toBe("US");
    expect(isRwaPageRequest(request)).toBe(true);
    expect(
      isRwaPageRequest(
        new Request("https://walletor.com/stocks-rwa-lookalike"),
      ),
    ).toBe(false);
  });

  it("returns an HTML 451 response for unavailable application requests", async () => {
    const request = new Request("https://walletor.com/rewards", {
      headers: { "CF-IPCountry": "RS" },
    });
    const response = unavailableJurisdictionResponse(request, "RS");

    expect(response.status).toBe(451);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.text()).resolves.toContain(
      "Walletor is not available in your country or region.",
    );
  });

  it("returns a normalized JSON 451 response for unavailable API requests", async () => {
    const request = new Request("https://walletor.com/api/health", {
      headers: { "CF-IPCountry": "RS" },
    });
    const response = unavailableJurisdictionResponse(request, "RS");

    expect(response.status).toBe(451);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE_IN_JURISDICTION",
        retryable: false,
      },
      meta: { country: "RS" },
    });
  });

  it("returns an HTML 451 response for U.S. Stocks (RWA) page requests", async () => {
    const request = new Request("https://walletor.com/stocks-rwa", {
      headers: { "CF-IPCountry": "US" },
    });
    const response = unavailableRwaJurisdictionResponse(request, "US");

    expect(response.status).toBe(451);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toContain(
      "Stocks (RWA) are unavailable in the United States.",
    );
  });

  it("returns a normalized JSON 451 response for U.S. RWA API requests", async () => {
    const request = new Request("https://walletor.com/api/rwa/assets", {
      headers: { "CF-IPCountry": "US" },
    });
    const response = unavailableRwaJurisdictionResponse(request, "US");

    expect(response.status).toBe(451);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "RWA_UNAVAILABLE_IN_JURISDICTION",
        retryable: false,
      },
      meta: { country: "US" },
    });
  });
});
