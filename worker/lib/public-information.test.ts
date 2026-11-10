import { expect, it } from "vitest";
import { isPublicInformationRequest } from "./public-information";

it("allows only read-only requests to exact public information paths", () => {
  for (const path of [
    "/about-walletor",
    "/about-walletor.html",
    "/robots.txt",
    "/sitemap.xml",
  ])
    for (const method of ["GET", "HEAD"])
      expect(
        isPublicInformationRequest(
          new Request(`https://walletor.com${path}`, { method }),
        ),
      ).toBe(true);
  for (const path of [
    "/",
    "/api/swap/order",
    "/admin",
    "/about-walletor.html/api",
    "/about-walletor/api",
    "/robots.txt/api",
  ])
    expect(
      isPublicInformationRequest(new Request(`https://walletor.com${path}`)),
    ).toBe(false);
  expect(
    isPublicInformationRequest(
      new Request("https://walletor.com/about-walletor.html", {
        method: "POST",
      }),
    ),
  ).toBe(false);
});
