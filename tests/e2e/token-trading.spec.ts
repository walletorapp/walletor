import { expect, test } from "@playwright/test";
import { apiDetail, mint } from "../fixtures";
const chartPair = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/tokens/${mint}/chart-market`, (route) =>
    route.fulfill({
      json: {
        data: { mint, pairAddress: chartPair },
        meta: {
          source: "dexscreener",
          fetchedAt: new Date().toISOString(),
          requestId: "test",
        },
      },
    }),
  );
  await page.route("https://dexscreener.com/solana/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "Chart provider test fixture",
    }),
  );
  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            address: mint,
            symbol: "SOL",
            name: "Wrapped SOL",
            decimals: 9,
            logoUrl: null,
            isVerified: true,
            organicScore: null,
            organicScoreLabel: null,
            priceUsd: 156.42,
            marketCapUsd: null,
            liquidityUsd: null,
            holders: null,
            mintAuthorityDisabled: true,
            freezeAuthorityDisabled: false,
            topHoldersPercent: 12.5,
          },
        ],
        meta: {
          source: "jupiter",
          fetchedAt: new Date().toISOString(),
          requestId: "test",
        },
      },
    }),
  );
});

test("advanced token page combines the exact chart, controls and inline wallet swap", async ({
  page,
}) => {
  await page.route(`**/api/tokens/${mint}`, (route) =>
    route.fulfill({ json: apiDetail() }),
  );
  await page.goto(`/tokens/${mint}`);
  await expect(
    page.getByRole("heading", { name: "SOL", exact: true }),
  ).toBeVisible();
  const chart = page.getByTitle("SOL market chart on Dexscreener");
  await expect(chart).toHaveAttribute(
    "src",
    `https://dexscreener.com/solana/${chartPair}?embed=1&theme=dark&trades=1&info=0`,
  );
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  await expect(chart).toHaveAttribute("src", /trades=0/);
  await page
    .getByRole("button", { name: "Chart & trades", exact: true })
    .click();
  await expect(chart).toHaveAttribute("src", /trades=1/);
  const controls = page.getByRole("region", {
    name: "Token controls",
    exact: true,
  });
  await expect(controls.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(controls.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(controls.getByText("12.50%", { exact: true })).toBeVisible();
  const trade = page.getByRole("region", { name: "Trade SOL", exact: true });
  await expect(
    trade.getByRole("button", { name: "Choose token, currently SOL" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Market activity 24h" }),
  ).toContainText("120K");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("token-trading.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Trade", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tokens/${mint}#token-trade$`));
  await trade
    .getByRole("button", { name: "Connect / Swap", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a newly discovered token retains its identity but cannot trade an unrelated default token", async ({
  page,
}) => {
  await page.route(`**/api/tokens/${mint}/chart-market`, (route) =>
    route.fulfill({
      json: {
        data: { mint, pairAddress: null },
        meta: {
          source: "dexscreener",
          fetchedAt: new Date().toISOString(),
          requestId: "test",
        },
      },
    }),
  );
  await page.route(`**/api/tokens/${mint}`, (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: {
          code: "TOKEN_NOT_FOUND",
          message: "Not indexed",
          retryable: false,
        },
        meta: { requestId: "test" },
      },
    }),
  );
  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      json: {
        data: [],
        meta: {
          source: "jupiter",
          fetchedAt: new Date().toISOString(),
          requestId: "test",
        },
      },
    }),
  );
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      json: {
        data: {
          tokens: [
            {
              mint,
              name: "New launch",
              symbol: "NEW",
              eventType: "create",
              observedAt: new Date().toISOString(),
              stage: "new",
              progressPercent: 15,
              poolAddress: null,
              logoUrl: null,
              priceUsd: null,
              marketCapUsd: null,
              liquidityUsd: null,
              volume24hUsd: null,
            },
          ],
          feedConnected: true,
          lastEventAt: new Date().toISOString(),
          checkedAt: new Date().toISOString(),
          chainAvailable: true,
          marketAvailable: false,
        },
      },
    }),
  );
  let orders = 0;
  await page.route("**/api/swap/order?**", (route) => {
    orders++;
    return route.abort();
  });
  await page.goto(`/tokens/${mint}`);
  await expect(
    page.getByRole("heading", { name: "NEW", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Showing available Trenches data."),
  ).toBeVisible();
  await expect(
    page.getByText("No chart market found yet", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".token-terminal-chart iframe")).toHaveCount(0);
  await expect(
    page.getByText("The selected token could not be loaded.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Amount to pay").fill("1");
  await expect(
    page.getByText("The selected token could not be loaded.", { exact: false }),
  ).toBeVisible();
  expect(orders).toBe(0);
});

test("invalid token addresses never mount the chart or swap form", async ({
  page,
}) => {
  await page.goto("/tokens/not-a-solana-mint");
  await expect(
    page.getByRole("heading", { name: "Invalid token address" }),
  ).toBeVisible();
  await expect(page.locator(".token-terminal iframe")).toHaveCount(0);
  await expect(page.getByLabel("Amount to pay")).toHaveCount(0);
});
