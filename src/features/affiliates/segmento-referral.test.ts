import { expect, it } from "vitest";
import { segmentoReferral } from "./segmento-referral";

it("never sends Walletor direct influencer links to Segmento, even with Segmento markers", () => {
  const code = "wlr-So11111111111111111111111111111111111111112";
  expect(
    segmentoReferral(`?ref=${code}&sgm_rdr=1&utm_campaign=walletor-swap`),
  ).toBeNull();
});

it("accepts creator links without a hardcoded campaign or redirect parameter", () => {
  expect(segmentoReferral("?ref=bright-blue-falcon")).toEqual({
    referralCode: "bright-blue-falcon",
    campaign: null,
  });
});

it("distinguishes native WLT hex invites from marked Segmento hex links", () => {
  const ref = "806a527b6a5c62032ebc00a02099b160";
  expect(segmentoReferral(`?ref=${ref}`)).toBeNull();
  expect(segmentoReferral(`?ref=${ref}&utm_campaign=unrelated`)).toBeNull();
  expect(segmentoReferral(`?ref=${ref}&sgm_rdr=1`)?.referralCode).toBe(ref);
  expect(
    segmentoReferral(`?ref=${ref}&utm_campaign=walletor-swap`)?.referralCode,
  ).toBe(ref);
});

it("rejects malformed or oversized codes and strips unsafe campaign values", () => {
  for (const ref of ["", "../secret", "a b", "a".repeat(129)]) {
    expect(segmentoReferral(`?ref=${encodeURIComponent(ref)}`)).toBeNull();
  }
  expect(
    segmentoReferral(
      "?ref=blue-falcon&utm_campaign=private%40example.com&email=secret",
    ),
  ).toEqual({
    referralCode: "blue-falcon",
    campaign: null,
  });
});
