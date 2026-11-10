import { expect, test } from "@playwright/test";

const teslaMint = "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo";

test("Stocks (RWA) is a launch-safe coming-soon page", async ({ page }) => {
  let rwaApiRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/rwa/")) {
      rwaApiRequests += 1;
    }
  });

  await page.goto("/stocks-rwa");

  await expect(
    page.getByRole("heading", {
      name: "A safer stock experience is on the way.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Target: one month after Walletor's public launch"),
  ).toBeVisible();
  await expect(
    page.getByText("Trading is disabled for everyone", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Stocks launch safeguards").locator(":scope > article"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Trade crypto now" }),
  ).toHaveAttribute("href", "/");
  await expect(
    page.getByText("Not available for trading yet", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Amount to pay")).toHaveCount(0);
  await expect(page.getByText("Stocks / RWA swap")).toHaveCount(0);
  expect(rwaApiRequests).toBe(0);

  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("official stock searches suppress unverified look-alike tokens", async ({
  page,
}) => {
  let publicTokenSearchRequests = 0;
  await page.route("**/api/rwa/assets", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          stocksEnabled: true,
          tradingEnabled: false,
          jupiterzRouteBadgeEnabled: true,
          assets: [
            {
              mint: teslaMint,
              ticker: "TSLA",
              tokenSymbol: "TSLAon",
              companyName: "Tesla",
              issuer: "Ondo Finance",
              assetType: "tokenized_stock",
              productLabel: "Tokenized Stock",
              decimals: 9,
              logoUrl:
                "https://cdn.ondo.finance/tokens/logos/tslaon_160x160.png",
              priceUsd: 384.72,
              priceChange24hPercent: -8.24,
              verified: true,
              verificationStatus: "walletor_verified_mint",
              tradingAvailability: "discovery_only",
              requiresEligibilityCheck: true,
              issuerUrl: "https://ondo.finance/ondo-stocks",
              restrictionsSummary:
                "Tokenized economic exposure. Eligibility and jurisdiction restrictions apply.",
            },
          ],
        },
        meta: {
          source: "walletor-rwa-registry",
          fetchedAt: "2026-09-04T12:00:00.000Z",
          requestId: "rwa-search-e2e",
        },
      }),
    });
  });
  await page.route("**/api/tokens/search**", async (route) => {
    publicTokenSearchRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            address: "11111111111111111111111111111111",
            symbol: "TESLA",
            name: "Tesla pump token",
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("button", { name: "Choose token, currently USDC" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose a Solana token" });
  await picker.getByPlaceholder("Search tokens or paste a mint").fill("Tesla");

  const results = page.locator(".token-results > button");
  await expect(results).toHaveCount(1);
  await expect(results).toContainText("TSLAon");
  await expect(results).toContainText("Verified stock");
  await expect(results).toContainText("Coming soon");
  await expect(page.getByText("Tesla pump token")).toHaveCount(0);
  expect(publicTokenSearchRequests).toBe(0);

  await picker.getByPlaceholder("Search tokens or paste a mint").fill("");
  const stocksTab = picker.getByRole("tab", { name: "Stocks" });
  await stocksTab.click();
  await expect(stocksTab).toHaveAttribute("aria-selected", "true");
  await expect(
    picker.getByPlaceholder(
      "Search verified stocks by company, ticker, or mint",
    ),
  ).toBeVisible();
  await expect(
    picker
      .getByLabel("Popular tokenized stocks")
      .getByRole("button", { name: "Select TSLAon" }),
  ).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select SOL" })).toHaveCount(
    0,
  );
  await expect(results).toHaveCount(1);
  await picker
    .getByPlaceholder("Search verified stocks by company, ticker, or mint")
    .fill("Tes");
  await expect(results).toHaveCount(1);
  await expect(results).toContainText("Tesla");
  await expect(results).toContainText("Coming soon");
  await expect(page.getByText("Tesla pump token")).toHaveCount(0);
  expect(publicTokenSearchRequests).toBe(0);

  await results.click();
  await expect(page).toHaveURL(new RegExp(`/stocks-rwa\\?asset=${teslaMint}$`));
  await expect(
    page.getByRole("heading", {
      name: "A safer stock experience is on the way.",
    }),
  ).toBeVisible();
});
