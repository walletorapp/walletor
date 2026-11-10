import { expect, test } from "@playwright/test";
import type { WalletAccount, WindowAppReadyEvent } from "@wallet-standard/base";
import type { WalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { apiDetail, prizePoolFixture, tokenDetail } from "../fixtures";

const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const makeToken = (stage: string, symbol: string, address = mint) => ({
  mint: address,
  name: `${symbol} example`,
  symbol,
  eventType: "create",
  observedAt: new Date().toISOString(),
  stage,
  progressPercent: stage === "almost" ? 91 : stage === "migrated" ? 100 : 15,
  poolAddress: null,
  logoUrl: null,
  priceUsd: null,
  marketCapUsd: 12345,
  liquidityUsd: null,
  volume24hUsd: 0,
  holders: 42,
  transactions24h: 10,
  buys24h: 6,
  sells24h: 4,
  twitterUrl: "https://x.com/example",
  websiteUrl: "https://example.com/",
});

test("launch board shows stages, filters and opens the exact selected swap mint", async ({
  page,
  isMobile,
}) => {
  const prizePool = prizePoolFixture(Date.now());
  await page.route("**/api/prize-pool", (route) =>
    route.fulfill({
      json: {
        data: { ...prizePool, serverTime: new Date().toISOString() },
        meta: {
          source: "walletor-ledger",
          fetchedAt: new Date().toISOString(),
          requestId: "test-pool",
        },
      },
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("walletName", JSON.stringify("Backpack"));
  });
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      json: {
        data: {
          tokens: [
            makeToken("new", "FIRST"),
            makeToken(
              "almost",
              "NEAR",
              "So11111111111111111111111111111111111111112",
            ),
            makeToken(
              "migrated",
              "POOL",
              "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
            ),
          ],
          feedConnected: true,
          lastEventAt: new Date().toISOString(),
          checkedAt: new Date().toISOString(),
          chainAvailable: true,
          marketAvailable: true,
        },
      },
    }),
  );
  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            address: mint,
            name: "First token",
            symbol: "FIRST",
            decimals: 6,
            logoUrl: null,
            isVerified: true,
            organicScore: null,
            organicScoreLabel: null,
            priceUsd: 1,
            marketCapUsd: null,
            liquidityUsd: null,
            holders: null,
            mintAuthorityDisabled: null,
            freezeAuthorityDisabled: null,
            topHoldersPercent: null,
            source: "jupiter",
            discoveredAt: null,
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
  await page.goto("/");
  await expect(page.getByLabel("Amount to pay")).toBeVisible();
  await expect(
    page.locator(".concept-reactor-core .live-pool-amount"),
  ).toHaveText("$123.45");
  const swapBackground = await page
    .locator(".walletor-concept-two")
    .evaluate((node) => getComputedStyle(node).backgroundImage);
  if (isMobile) {
    await page
      .getByRole("navigation", { name: "Walletor mobile navigation" })
      .getByRole("link", { name: "Trenches", exact: true })
      .click();
  } else {
    await page.getByRole("button", { name: "Trenches", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/trenches$/);
  await expect(
    page.getByRole("heading", { name: "Trenches", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Feed connected", { exact: true })).toBeVisible();
  const poolBar = page.getByRole("region", {
    name: "Live prize pool and countdown",
  });
  await expect(poolBar).toBeVisible();
  await expect(poolBar.locator(".live-pool-amount")).toHaveText("$123.45");
  const timer = poolBar.getByRole("timer");
  await expect(timer).toHaveText(/\d{2}:\d{2}:\d{2}/);
  const initialTime = await timer.textContent();
  await expect(timer).not.toHaveText(initialTime ?? "");
  expect(
    await page
      .locator(".walletor-concept-two")
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toBe(swapBackground);
  await expect(
    page.locator(".launch-column--new").getByLabel("FIRST holders: 42"),
  ).toBeVisible();
  await expect(
    page.locator(".launch-column--new").getByLabel("Developer holdings: —"),
  ).toBeVisible();
  await expect(
    page
      .locator(".launch-column--new")
      .getByLabel("FIRST X account", { exact: true }),
  ).toHaveAttribute("href", "https://x.com/example");
  await expect(
    page
      .locator(".launch-column--new")
      .getByLabel("6 buys and 4 sells in 24 hours"),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("trenches-details.png"),
    fullPage: false,
  });
  if (isMobile) {
    await page.getByRole("button", { name: /About to graduate/ }).click();
    await expect(
      page.getByRole("link", { name: "NEAR", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^New/ }).click();
  }
  await page.getByRole("button", { name: "Pause live updates" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  const newColumn = page.locator(".launch-column--new");
  await page
    .getByRole("searchbox", { name: "Search New tokens" })
    .fill("missing");
  await expect(newColumn.getByText("No matches in this stage.")).toBeVisible();
  if (!isMobile) {
    await expect(
      page.getByRole("link", { name: "NEAR", exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("searchbox", { name: "Search New tokens" })
    .fill("missing, FIRST");
  await expect(
    newColumn.getByRole("link", { name: "FIRST", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Search New tokens" }).fill("");
  await newColumn.locator("summary").click();
  await page
    .getByRole("spinbutton", { name: "Minimum market cap for New" })
    .fill("20000");
  await expect(newColumn.getByText("No matches in this stage.")).toBeVisible();
  await page.getByRole("button", { name: "Reset New filters" }).click();
  await expect(
    newColumn.getByRole("link", { name: "FIRST", exact: true }),
  ).toBeVisible();
  await newColumn.locator("summary").click();
  await page.locator(".launch-display summary").click();
  await page.getByRole("checkbox", { name: "Price", exact: true }).uncheck();
  await expect(newColumn.locator('[aria-label="FIRST price"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Price", exact: true }).check();
  await expect(newColumn.locator('[aria-label="FIRST price"]')).toHaveCount(1);
  await page.locator(".launch-display summary").click();
  await page
    .getByRole("link", { name: "Connect wallet to swap FIRST" })
    .click();
  await expect(page).toHaveURL(new RegExp(`outputMint=${mint}`));
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /Phantom/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("walletName")),
  ).toBeNull();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Choose token, currently FIRST" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/new-tokens?source=legacy#board");
  await expect(page).toHaveURL(/\/trenches\?source=legacy#board$/);
  await expect(
    page.getByRole("heading", { name: "Trenches", exact: true }),
  ).toBeVisible();
});

test("Trenches opens the exact swap token without reconnecting the connected wallet", async ({
  page,
}) => {
  const walletCalls: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("walletor-test-wallet:")) {
      walletCalls.push(message.text());
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("walletName", JSON.stringify("Test Wallet"));
    const accounts: WalletAccount[] = [
      {
        address: "11111111111111111111111111111111",
        publicKey: new Uint8Array(32),
        chains: ["solana:mainnet"],
        features: ["solana:signTransaction"],
      },
    ];
    const wallet: WalletAdapterCompatibleStandardWallet = {
      version: "1.0.0",
      name: "Test Wallet",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      chains: ["solana:mainnet"],
      accounts,
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: () => {
            console.info("walletor-test-wallet:connect");
            return Promise.resolve({ accounts });
          },
        },
        "standard:events": { version: "1.0.0", on: () => () => undefined },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: () => {
            console.info("walletor-test-wallet:sign");
            return Promise.reject(new Error("Test cannot sign"));
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => {
      (event as WindowAppReadyEvent).detail.register(wallet);
    });
  });
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      json: {
        data: {
          tokens: [makeToken("new", "HANDOFF")],
          feedConnected: true,
          lastEventAt: new Date().toISOString(),
          chainAvailable: true,
          marketAvailable: true,
          checkedAt: new Date().toISOString(),
        },
      },
    }),
  );
  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            address: mint,
            name: "Handoff token",
            symbol: "HANDOFF",
            decimals: 6,
            logoUrl: null,
            isVerified: true,
            organicScore: null,
            organicScoreLabel: null,
            priceUsd: 1,
            marketCapUsd: null,
            liquidityUsd: null,
            holders: null,
            mintAuthorityDisabled: null,
            freezeAuthorityDisabled: null,
            topHoldersPercent: null,
            source: "jupiter",
            discoveredAt: null,
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
  await page.goto("/trenches");
  const connectedWallet = page.getByRole("button", { name: /Test Wallet ·/ });
  await expect(connectedWallet).toBeVisible();
  const beforeNavigation = [...walletCalls];
  await page.evaluate(() => {
    document.body.dataset.walletorRouteProbe = "keep";
  });
  await page.getByRole("link", { name: "Swap HANDOFF", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`outputMint=${mint}`));
  await expect(connectedWallet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Choose token, currently HANDOFF" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.body.dataset.walletorRouteProbe),
  ).toBe("keep");
  expect(await page.evaluate(() => localStorage.getItem("walletName"))).toBe(
    '"Test Wallet"',
  );
  expect(walletCalls).toEqual(beforeNavigation);
  expect(walletCalls).not.toContain("walletor-test-wallet:sign");
  await page.route(`**/api/tokens/${mint}`, (route) =>
    route.fulfill({
      json: apiDetail({
        ...tokenDetail,
        address: mint,
        symbol: "HANDOFF",
        name: "Handoff token",
        decimals: 6,
      }),
    }),
  );
  await page.route(`**/api/tokens/${mint}/chart-market`, (route) =>
    route.fulfill({
      json: {
        data: { mint, pairAddress: mint },
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
  await page.goBack();
  await page.getByRole("link", { name: "HANDOFF", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tokens/${mint}$`));
  await expect(
    page.getByRole("heading", { name: "HANDOFF", exact: true }),
  ).toBeVisible();
  await expect(connectedWallet).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose token, currently HANDOFF" }),
  ).toBeVisible();
  expect(walletCalls).toEqual(beforeNavigation);
});

test("verified snapshot changes move a token through all three columns", async ({
  page,
  isMobile,
}) => {
  let stage = "new";
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      json: {
        data: {
          tokens: [makeToken(stage, "MOVE")],
          feedConnected: true,
          chainAvailable: true,
          marketAvailable: true,
          checkedAt: new Date().toISOString(),
          lastEventAt: new Date().toISOString(),
        },
      },
    }),
  );
  await page.goto("/trenches");
  await expect(
    page
      .locator(".launch-column--new")
      .getByRole("link", { name: "MOVE", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause live updates" }).click();
  stage = "almost";
  await page.getByRole("button", { name: "Refresh launches" }).click();
  if (isMobile)
    await page.getByRole("button", { name: /About to graduate/ }).click();
  await expect(
    page
      .locator(".launch-column--almost")
      .getByRole("link", { name: "MOVE", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".launch-column--new .launch-card")).toHaveCount(0);
  stage = "migrated";
  await page.getByRole("button", { name: "Refresh launches" }).click();
  if (isMobile) await page.getByRole("button", { name: /^Graduate/ }).click();
  await expect(
    page
      .locator(".launch-column--migrated")
      .getByRole("link", { name: "MOVE", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".launch-column--almost .launch-card")).toHaveCount(
    0,
  );
});

test("token artwork recovers when a failed thumbnail is replaced", async ({
  page,
}) => {
  let logoUrl = "https://images.example.com/first.png";
  await page.route("https://images.example.com/first.png", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.route("https://images.example.com/second.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>',
    }),
  );
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      json: {
        data: {
          tokens: [{ ...makeToken("new", "ART"), logoUrl }],
          feedConnected: true,
          lastEventAt: new Date().toISOString(),
          checkedAt: new Date().toISOString(),
          chainAvailable: true,
          marketAvailable: false,
        },
      },
    }),
  );
  await page.goto("/trenches");
  const avatar = page.getByRole("link", { name: "Open ART trading page" });
  await expect(avatar.locator("span")).toHaveText("AR");
  logoUrl = "https://images.example.com/second.svg";
  await page.getByRole("button", { name: "Refresh launches" }).click();
  const art = avatar.locator(
    'img[src="https://images.example.com/second.svg"]',
  );
  await expect(art).toBeVisible();
  await expect
    .poll(() =>
      art.evaluate(
        (img) =>
          img instanceof HTMLImageElement &&
          img.complete &&
          img.naturalWidth > 0,
      ),
    )
    .toBeTruthy();
});

test("a graduation discovery outage is not presented as an empty market", async ({
  page,
  isMobile,
}) => {
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      json: {
        data: {
          tokens: [],
          feedConnected: true,
          chainAvailable: true,
          marketAvailable: false,
          discoveryAvailable: false,
          discoveryCheckedAt: null,
          checkedAt: new Date().toISOString(),
          lastEventAt: null,
        },
      },
    }),
  );
  await page.goto("/trenches");
  if (isMobile)
    await page.getByRole("button", { name: /About to graduate/ }).click();
  await expect(
    page.getByText("Near-graduation discovery is temporarily unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No verified candidates are near graduation in this snapshot.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("unavailable feed shows an explicit error without fabricated launches", async ({
  page,
}) => {
  await page.route("**/api/tokens/launches", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "LAUNCH_FEED_UNAVAILABLE",
          message: "Unavailable",
          retryable: false,
        },
        meta: { requestId: "test" },
      },
    }),
  );
  await page.goto("/trenches");
  await expect(page.getByRole("alert")).toContainText(
    "Launch data is temporarily unavailable",
  );
  await expect(page.locator(".launch-swap")).toHaveCount(0);
});

test("an unresolved launch mint cannot silently trade the default token", async ({
  page,
}) => {
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
  let orders = 0;
  await page.route("**/api/swap/order?**", (route) => {
    orders++;
    return route.abort();
  });
  await page.goto(`/?outputMint=${mint}`);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "The selected token could not be loaded" }),
  ).toBeVisible();
  await page.getByLabel("Amount to pay").fill("0.1");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "The selected token could not be loaded" }),
  ).toBeVisible();
  expect(orders).toBe(0);
});
