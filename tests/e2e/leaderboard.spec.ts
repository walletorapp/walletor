import { expect, test } from "@playwright/test";

const wallet = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
const signature = "2".repeat(88);
const winner = {
  id: "winner-1",
  roundId: "solana:mainnet:prize-pool:rolling:2026-09-27T12:00:00.000Z",
  walletAddress: wallet,
  rank: 1,
  netAmountAtomic: "97500000",
  poolAmountAtomic: "100000000",
  status: "CLAIMED",
  date: "2026-09-28T12:00:00.000Z",
  deadline: "2026-10-28T12:00:00.000Z",
  claimSignature: signature,
  fundingSignature: signature,
  requestSignature: signature,
  revealSignature: signature,
  randomnessAccount: wallet,
  randomnessProvider: "MagicBlock",
  merkleRoot: "a".repeat(64),
};
const totals = {
  claimedAtomic: "97500000",
  awardedAtomic: "195000000",
  winningWallets: 2,
  fundedDraws: 2,
};

test("winners, evidence, rankings and search work on every screen", async ({
  page,
}, testInfo) => {
  await page.route("**/api/leaderboard/winners**", (route) =>
    route.fulfill({
      json: {
        entries: [winner],
        totals,
        pagination: { offset: 0, total: 1, nextOffset: null },
        serverTime: "2026-09-28T12:05:00.000Z",
      },
    }),
  );
  await page.route("**/api/leaderboard/rankings**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        entries: params.get("search")
          ? []
          : [
              {
                rank: 1,
                walletAddress: wallet,
                points: params.get("period") === "round" ? "2" : "102",
                eligibleSwaps: 1,
                totalWonAtomic: "97500000",
              },
            ],
        yourPosition: null,
        pagination: {
          offset: 0,
          total: params.get("search") ? 0 : 1,
          nextOffset: null,
        },
        roundId: winner.roundId,
        roundEndsAt: "2026-09-29T12:00:00.000Z",
        serverTime: "2026-09-28T12:05:00.000Z",
      },
    });
  });
  await page.goto("/leaderboard");
  await expect(
    page.getByRole("heading", { name: "Leaderboard & Winners" }),
  ).toBeVisible();
  await expect(page.getByText("Claimed", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `/tmp/walletor-winners-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByText("Verify draw", { exact: false }).click();
  await expect(
    page.getByRole("link", { name: "Randomness result" }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "USDC funding" }),
  ).toHaveAttribute("href", `https://solscan.io/tx/${signature}`);
  await expect(
    page.getByRole("link", { name: "Locked snapshot" }),
  ).toHaveAttribute(
    "href",
    `/api/prize-pool/draws/${encodeURIComponent(winner.roundId)}`,
  );
  await page
    .getByRole("button", { name: "Leaderboard", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("cell", { name: "102", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "This round", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "2", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search wallet", { exact: true }).fill("ABCDE");
  await page.getByRole("button", { name: "Search wallets" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching wallets" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("outage is not presented as an empty or zero leaderboard", async ({
  page,
}) => {
  await page.route("**/api/leaderboard/**", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/leaderboard");
  await expect(page.getByRole("alert")).toContainText(
    "Couldn’t load these records",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
});
