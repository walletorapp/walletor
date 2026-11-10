// @vitest-environment node
import { expect, it } from "vitest";
import { shortLinkResponse } from "./short-links";

it("routes every Segmento code to the fixed resolver without hardcoding influencer links", () => {
  for (const code of ["1GK", "another-Code_250"]) {
    const response = shortLinkResponse(
      new Request(`https://campaign.walletor.com/${code}`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `https://referral.segmento.tech/${code}`,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
});

it("drops redirect overrides and does not accept foreign hosts or nested paths", () => {
  const response = shortLinkResponse(
    new Request(
      "https://campaign.walletor.com/1GK?url=https://example.org&ref=spoof",
    ),
  );
  expect(response.headers.get("Location")).toBe(
    "https://referral.segmento.tech/1GK",
  );
  for (const url of [
    "https://example.org/1GK",
    "https://campaign.walletor.com//example.org",
    "https://campaign.walletor.com/%2f%2fexample.org",
    "https://campaign.walletor.com/one/two",
    `https://campaign.walletor.com/${"a".repeat(129)}`,
  ])
    expect(shortLinkResponse(new Request(url)).status).toBe(404);
});

it("returns the homepage at the bare domain and does not redirect POST bodies", () => {
  expect(
    shortLinkResponse(
      new Request("https://campaign.walletor.com/"),
    ).headers.get("Location"),
  ).toBe("https://walletor.com/");
  expect(
    shortLinkResponse(
      new Request("https://campaign.walletor.com/1GK", { method: "HEAD" }),
    ).status,
  ).toBe(302);
  const response = shortLinkResponse(
    new Request("https://campaign.walletor.com/1GK", {
      method: "POST",
      body: "private",
    }),
  );
  expect(response.status).toBe(405);
  expect(response.headers.has("Location")).toBe(false);
});
