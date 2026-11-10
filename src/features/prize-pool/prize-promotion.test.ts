import { expect, it } from "vitest";
import { prizePromotion } from "./prize-promotion";

it("adds the daily pledge to verified fees using exact integers", () => {
  expect(prizePromotion("40000")).toEqual({
    totalMicroUsd: "100040000",
    unfundedPledgeMicroUsd: "100000000",
  });
  expect(prizePromotion("0").totalMicroUsd).toBe("100000000");
});

it("does not count a funded daily seed twice", () => {
  expect(prizePromotion("100040000", "10000")).toEqual({
    totalMicroUsd: "100040000",
    unfundedPledgeMicroUsd: "0",
  });
  expect(prizePromotion("50040000", "5000").totalMicroUsd).toBe("100040000");
});

it("keeps the daily base when a new round resets the recorded balance", () => {
  expect(prizePromotion("3500000", "0").totalMicroUsd).toBe("103500000");
  expect(prizePromotion("10000", "0").totalMicroUsd).toBe("100010000");
});
