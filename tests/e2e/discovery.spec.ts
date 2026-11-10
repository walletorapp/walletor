import { expect, test, type Page } from "@playwright/test";
import type { WalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletAccount, WindowAppReadyEvent } from "@wallet-standard/base";

import type { SwapOrder } from "../../shared/swap-contracts";
import { apiDetail, mint } from "../fixtures";

const usdtMint = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const reviewWalletAddress = "11111111111111111111111111111111";
const serializedTestTransaction = new VersionedTransaction(
  new TransactionMessage({
    payerKey: new PublicKey(reviewWalletAddress),
    recentBlockhash: reviewWalletAddress,
    instructions: [],
  }).compileToV0Message(),
).serialize();
let testTransactionBinary = "";
for (const byte of serializedTestTransaction) {
  testTransactionBinary += String.fromCharCode(byte);
}
const testTransactionBase64 = btoa(testTransactionBinary);

const testSwapOrder: SwapOrder = {
  requestId: "e2e-order",
  transaction: testTransactionBase64,
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "1000000000",
  outAmount: "150000000",
  otherAmountThreshold: "149000000",
  priceImpactPct: "0.01",
  inUsdValue: 150,
  outUsdValue: 149.9,
  inUsdValueDecimal: "150",
  outUsdValueDecimal: "149.9",
  router: "iris",
  mode: "ultra",
  referralAccount: "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
  walletorPartnerShareBps: 8000,
  feeBps: 50,
  feeMint: "So11111111111111111111111111111111111111112",
  platformFee: {
    amount: null,
    feeBps: 50,
    feeMint: "So11111111111111111111111111111111111111112",
  },
  routePlan: [],
  gasless: false,
  signatureFeePayer: null,
  prioritizationFeePayer: null,
  rentFeePayer: null,
  signatureFeeLamports: null,
  prioritizationFeeLamports: null,
  rentFeeLamports: null,
  slippageBps: 50,
  totalTimeMs: 25,
  errorCode: null,
  errorMessage: null,
  lastValidBlockHeight: null,
};

function swapOrderResponse(overrides: Partial<SwapOrder> = {}) {
  return {
    data: { ...testSwapOrder, ...overrides },
    meta: {
      source: "jupiter",
      fetchedAt: "2026-07-22T12:00:00.000Z",
      requestId: "test-request",
    },
  };
}

async function installReviewWallet(
  page: Page,
  options: { allowSigning?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ address, allowSigning }) => {
      const accounts: WalletAccount[] = [
        {
          address,
          publicKey: new Uint8Array(32),
          chains: ["solana:mainnet"],
          features: ["solana:signTransaction"],
        },
      ];
      const testWallet: WalletAdapterCompatibleStandardWallet = {
        version: "1.0.0",
        name: "Walletor Review Wallet",
        icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        chains: ["solana:mainnet"],
        accounts,
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: () => Promise.resolve({ accounts }),
          },
          "standard:events": { version: "1.0.0", on: () => () => undefined },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: (...inputs) => {
              const browserWindow = window as typeof window & {
                __walletorSignRequests?: number;
              };
              browserWindow.__walletorSignRequests =
                (browserWindow.__walletorSignRequests ?? 0) + 1;
              if (allowSigning) {
                return Promise.resolve(
                  inputs.map((input) => ({
                    signedTransaction: input.transaction,
                  })),
                );
              }
              return Promise.reject(
                new Error("Review wallet cannot sign transactions"),
              );
            },
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => {
        (event as WindowAppReadyEvent).detail.register(testWallet);
      });
    },
    {
      address: reviewWalletAddress,
      allowSigning: options.allowSigning ?? false,
    },
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/swap/order?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(swapOrderResponse()),
    }),
  );
  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            address: usdtMint,
            symbol: "USDT",
            name: "Tether USD",
            logoUrl: null,
            decimals: 6,
            isVerified: true,
            organicScore: 99,
            organicScoreLabel: "high",
            priceUsd: 1,
            marketCapUsd: 4_000_000_000,
            liquidityUsd: 500_000_000,
            holders: 2_000_000,
            mintAuthorityDisabled: true,
            freezeAuthorityDisabled: true,
            topHoldersPercent: 12.5,
          },
        ],
        meta: {
          source: "jupiter",
          fetchedAt: "2026-07-22T12:00:00.000Z",
          requestId: "test-request",
        },
      }),
    }),
  );
  await page.route(`**/api/tokens/${mint}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiDetail()),
    }),
  );
});

test("footer exposes the official Walletor community links", async ({
  page,
}) => {
  await page.goto("/swap");
  await expect(
    page.getByText(
      "Walletor will never ask you for money or seed phrases or contact you.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Walletor on X" }),
  ).toHaveAttribute("href", "https://x.com/walletorai");
  await expect(
    page.getByRole("link", { name: "Walletor on Telegram" }),
  ).toHaveAttribute("href", "https://t.me/walletorswap");
  await expect(
    page.getByRole("link", { name: "Walletor on Discord" }),
  ).toHaveAttribute("href", "https://discord.gg/hUCrahcEZK");
});

test("How it works explains the same verified flow from swap, pool, and footer", async ({
  page,
}, testInfo) => {
  await page.goto("/swap");
  await expect(page.getByRole("button", { name: "How it works" })).toHaveCount(
    3,
  );
  await expect(
    page.locator(".swap-mode-actions .how-it-works-trigger"),
  ).toHaveCount(0);
  const swapHelp = page.locator(".swap-support-row").getByRole("button", {
    name: "How it works",
  });
  const poolHelp = page.locator(".revenue-column").getByRole("button", {
    name: "How it works",
  });
  for (const button of [swapHelp, poolHelp]) {
    await expect(button).toBeVisible();
    const size = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const scale = box.width / element.clientWidth;
      return {
        height: box.height,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize) * scale,
        iconSize: element.querySelector("svg")?.getBoundingClientRect().width,
      };
    });
    expect(size.height).toBeGreaterThanOrEqual(48);
    expect(size.fontSize).toBeGreaterThanOrEqual(16);
    expect(size.iconSize).toBeGreaterThanOrEqual(22);
  }
  await expect(
    page.locator(".revenue-hero").getByRole("button", {
      name: "How it works",
    }),
  ).toHaveCount(0);
  await poolHelp.click();
  const explanation = page.getByRole("dialog", {
    name: "How Walletor works",
  });
  await expect(explanation).toBeVisible();
  await expect(explanation.getByText("Swap tokens")).toBeVisible();
  await expect(explanation.getByRole("listitem")).toHaveCount(4);
  await expect(explanation.getByText("Winners every 24 hours")).toBeVisible();
  await expect(explanation.getByText("Claim your USDC")).toBeVisible();
  const originalViewport = page.viewportSize();
  await page.setViewportSize({
    width: originalViewport?.width ?? 390,
    height: 480,
  });
  for (const control of [
    explanation.getByRole("button", { name: "Close How it works" }),
    explanation.getByRole("link", { name: "View pool accounting" }),
    explanation.getByRole("link", { name: "Claim Rewards" }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(480);
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
  await explanation.getByRole("button", { name: "Close How it works" }).click();
  await expect(poolHelp).toBeFocused();

  await swapHelp.focus();
  await page.keyboard.press("Enter");
  await expect(explanation).toBeVisible();
  await expect(explanation.getByText("Swap tokens")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(explanation).not.toBeVisible();
  await expect(swapHelp).toBeFocused();

  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 740 });
  }
  const placement = await page.locator(".swap-flow").evaluate((element) => {
    const card = element.querySelector(".swap-card")?.getBoundingClientRect();
    const credit = element
      .querySelector(".jupiter-credit")
      ?.getBoundingClientRect();
    const button = element
      .querySelector(".how-it-works-trigger")
      ?.getBoundingClientRect();
    if (!card || !credit || !button) {
      throw new Error(
        "Swap card, Jupiter credit, and help button must be present.",
      );
    }
    return {
      cardBottom: card.bottom,
      creditBottom: credit.bottom,
      creditRight: credit.right,
      buttonTop: button.top,
      buttonLeft: button.left,
      buttonRight: button.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(placement.buttonTop).toBeGreaterThanOrEqual(placement.cardBottom);
  expect(placement.buttonLeft).toBeGreaterThanOrEqual(0);
  expect(placement.buttonRight).toBeLessThanOrEqual(placement.viewportWidth);
  if (testInfo.project.name === "mobile-chromium") {
    expect(placement.buttonTop).toBeGreaterThanOrEqual(placement.creditBottom);
  } else {
    expect(placement.buttonLeft).toBeGreaterThanOrEqual(placement.creditRight);
  }

  await page.goto("/revenue-pool");
  await expect(page.getByRole("button", { name: "How it works" })).toHaveCount(
    2,
  );
});

test("Prize Pool publishes its treasury, fee policy, and distribution evidence", async ({
  page,
}) => {
  await page.goto("/revenue-pool");
  await expect(
    page.getByRole("heading", { name: "Distribution ledger" }),
  ).toBeVisible();
  await expect(page.getByText("Append-only records")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Distribution calendar" }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose a highlighted date to view its winners"),
  ).toBeVisible();
  await expect(page.getByText("Walletor fee allocation")).toBeVisible();
  await expect(
    page.getByText("0.4% · 100% for active users & influencers"),
  ).toBeVisible();
  await expect(page.getByText("0.5% total · 0.1% Jupiter")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View on Solscan" }),
  ).toHaveAttribute(
    "href",
    "https://solscan.io/account/Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
  );
});

test("Claim Rewards is a first-class route in the Walletor menu", async ({
  page,
}) => {
  await page.goto("/claim-rewards");
  await expect(page).toHaveURL(/\/claim-rewards$/);
  await expect(
    page.getByRole("heading", { name: "Your rewards, verified.", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "See what you’ve earned" }),
  ).toBeVisible();
  await expect(page.locator('a[href="/claim-rewards"]')).toHaveCount(1);
  await expect(
    page.getByText("Prize Pool withdrawals are not live yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "WLT points earned" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "WLT points earned" })
      .getByText("—", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "WLT points are off-chain rewards, not withdrawable tokens.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Legacy swap route remains operational and displays a Jupiter quote", async ({
  page,
}, testInfo) => {
  await page.goto("/swap");
  await expect(page).toHaveURL(/\/swap$/);
  await expect(page.getByText(/Minimum \$5\.00 swap to qualify/i)).toHaveCount(
    0,
  );
  await expect(page.getByText(/This quote is below \$5\.00/i)).toHaveCount(0);
  const networkSelector = page.locator(".network-row");
  if (testInfo.project.name === "mobile-chromium") {
    await expect(networkSelector).toBeHidden();
    const poolCard = await page.locator(".revenue-hero").boundingBox();
    const claimAction = await page
      .getByRole("button", { name: /Claim Your Earnings/ })
      .boundingBox();
    expect(poolCard).not.toBeNull();
    expect(claimAction).not.toBeNull();
    if (poolCard && claimAction) {
      const poolCenter = poolCard.x + poolCard.width / 2;
      const claimCenter = claimAction.x + claimAction.width / 2;
      expect(Math.abs(poolCenter - claimCenter)).toBeLessThanOrEqual(1);
    }
  } else {
    await expect(networkSelector).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Prize pool" })).toBeVisible();
  await expect(page.getByText("Distributed by Walletor AI")).toBeVisible();
  const roundTimer = page.getByRole("timer", {
    name: "Time until next distribution",
  });
  await expect(roundTimer).toBeVisible();
  await expect(roundTimer).toHaveAttribute("aria-live", "off");
  await expect(roundTimer.locator(".revenue-schedule__unit small")).toHaveText([
    "Hours",
    "Minutes",
    "Seconds",
  ]);
  await expect(page.getByText("UTC round", { exact: true })).toHaveCount(0);
  for (const unit of await roundTimer
    .locator(".revenue-schedule__unit")
    .all()) {
    await expect(unit.locator("strong")).toHaveText(/^\d{2}$/);
    const alignment = await unit.evaluate((element) => {
      const number = element.querySelector("strong")?.getBoundingClientRect();
      const label = element.querySelector("small")?.getBoundingClientRect();
      if (!number || !label)
        throw new Error("Each timer unit needs a number and label.");
      return {
        numberBottom: number.bottom,
        labelTop: label.top,
        centerOffset: Math.abs(
          number.left + number.width / 2 - (label.left + label.width / 2),
        ),
      };
    });
    expect(alignment.labelTop).toBeGreaterThan(alignment.numberBottom);
    expect(alignment.centerOffset).toBeLessThanOrEqual(1);
  }
  await expect(
    page.getByRole("heading", { name: "Walletor Rewards" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Swap tokens with Jupiter" }),
  ).toBeAttached();
  await expect(page.locator(".quote-disclosure")).toHaveCount(0);
  await page.getByLabel("Amount to pay").fill("1");
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "150",
  );
  await expect(page.getByText(/iris · 0.01% impact/i)).toBeVisible();
  await expect(page.getByText(/This quote is below \$5\.00/i)).toHaveCount(0);
  const feeDetails = page.locator(".quote-disclosure");
  const feeToggle = feeDetails.locator("summary");
  await expect(feeToggle).toHaveText("Fees & details");
  await expect(feeDetails).toHaveJSProperty("open", false);
  await expect(page.getByText("149 USDC")).toBeHidden();
  await expect(feeDetails.getByText("Fee breakdown")).toBeHidden();
  await expect(feeDetails.getByText("Network costs")).toBeHidden();

  await feeToggle.click();
  await expect(feeDetails).toHaveJSProperty("open", true);
  await expect(page.getByText("149 USDC")).toBeVisible();
  await expect(feeDetails.getByText("0.5% total swap fee")).toBeVisible();
  await expect(
    feeDetails.getByText("Walletor fee", { exact: true }),
  ).toBeVisible();
  await expect(feeDetails.getByText("0.4%", { exact: true })).toBeVisible();
  await expect(feeDetails.getByText("Jupiter share")).toBeVisible();
  await expect(feeDetails.getByText("0.1%", { exact: true })).toBeVisible();
  expect(
    await feeDetails.getByText("0.5% total swap fee").evaluate((element) => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      fits: element.scrollWidth <= element.clientWidth,
    })),
  ).toEqual({ whiteSpace: "normal", fits: true });
  await expect(feeDetails.getByText("Network costs")).toBeVisible();
  const refreshedQuote = page.waitForResponse((response) =>
    response.url().includes("/api/swap/order?"),
  );
  await page.locator(".quote-status").getByRole("button").click();
  await refreshedQuote;
  await expect(feeDetails).toHaveJSProperty("open", true);

  await feeToggle.focus();
  await feeToggle.press("Enter");
  await expect(feeDetails).toHaveJSProperty("open", false);
  await expect(feeDetails.getByText("Fee breakdown")).toBeHidden();
  await feeToggle.press("Space");
  await expect(feeDetails).toHaveJSProperty("open", true);
  await page.getByLabel("Amount to pay").fill("");
  await expect(feeDetails).toHaveCount(0);
  await page.getByLabel("Amount to pay").fill("1");
  await expect(feeDetails).toHaveJSProperty("open", false);
  await expect(
    page.getByRole("button", { name: "Connect Wallet", exact: true }),
  ).toBeVisible();
  const swapAction = page.getByRole("button", {
    name: "Connect / Swap",
    exact: true,
  });
  await expect(swapAction).toBeVisible();
  const swapActionBox = await swapAction.boundingBox();
  expect(swapActionBox?.height).toBeGreaterThanOrEqual(60);
  expect(swapActionBox?.height).toBeLessThanOrEqual(72);
});

test("minimum reward warning appears only after a sub-$5 Jupiter quote", async ({
  page,
}) => {
  await page.unroute("**/api/swap/order?**");
  await page.route("**/api/swap/order?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        swapOrderResponse({
          inAmount: "20000000",
          outAmount: "2980000",
          otherAmountThreshold: "2960000",
          inUsdValue: 3,
          outUsdValue: 2.98,
          inUsdValueDecimal: "3.00",
          outUsdValueDecimal: "2.98",
        }),
      ),
    }),
  );

  await page.goto("/swap");
  const warning = page.getByText(/This quote is below \$5\.00/i);
  await expect(warning).toHaveCount(0);

  await page.getByLabel("Amount to pay").fill("0.02");
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "2.98",
  );
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(
    "it will not count toward this Prize Pool or earn WLT points",
  );

  await page.getByLabel("Amount to pay").fill("");
  await expect(warning).toHaveCount(0);
});

test("quotes refresh automatically five times before requiring a click", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");

  let quoteRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/swap/order?")) quoteRequests += 1;
  });
  await page.clock.install({ time: new Date("2026-08-28T12:00:00.000Z") });
  await page.goto("/swap");
  await page.getByLabel("Amount to pay").fill("1");
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "150",
  );
  await expect.poll(() => quoteRequests).toBe(1);

  const refreshButton = page.locator(".quote-status").getByRole("button");
  await expect(refreshButton).toContainText("Auto 0/5");

  for (let completed = 1; completed <= 5; completed += 1) {
    await page.clock.runFor(20_500);
    await expect.poll(() => quoteRequests).toBe(completed + 1);
    await expect(refreshButton).toContainText(`Auto ${String(completed)}/5`);
  }

  await page.clock.runFor(20_500);
  await expect(refreshButton).toHaveText("Refresh quote");
  expect(quoteRequests).toBe(6);

  await refreshButton.click();
  await page.clock.runFor(500);
  await expect.poll(() => quoteRequests).toBe(7);
  await expect(refreshButton).toContainText("Auto 5/5");
});

test("a valid route opens wallet approval directly without an app review", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.setViewportSize({ width: 1440, height: 540 });
  await page.route("**/api/wallet/balance?**", (route) =>
    route.fulfill({
      json: {
        data: {
          owner: reviewWalletAddress,
          inputMint: "So11111111111111111111111111111111111111112",
          inputAmount: "5000000000",
          solAmount: "5000000000",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-08-27T12:00:00.000Z",
          requestId: "test-review-balance",
        },
      },
    }),
  );
  await installReviewWallet(page);

  await page.goto("/swap");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
    .click();
  const amountInput = page.getByLabel("Amount to pay");
  await page
    .getByRole("button", { name: "Use 25% of available SOL balance" })
    .click();
  await expect(amountInput).toHaveValue("1.25");
  await page
    .getByRole("button", { name: "Use 50% of available SOL balance" })
    .click();
  await expect(amountInput).toHaveValue("2.5");
  await page
    .getByRole("button", { name: "Use 100% of available SOL balance" })
    .click();
  await expect(amountInput).toHaveValue("4.997");
  await amountInput.fill("1");
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "150",
  );
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __walletorSignRequests?: number })
            .__walletorSignRequests ?? 0,
      ),
    )
    .toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Review before signing" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Review wallet cannot sign transactions"),
  ).toBeVisible();
});

test("editing a new trade clears the previous swap confirmation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.route("**/api/wallet/balance?**", (route) =>
    route.fulfill({
      json: {
        data: {
          owner: reviewWalletAddress,
          inputMint: testSwapOrder.inputMint,
          inputAmount: "5000000000",
          solAmount: "5000000000",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-09-07T12:00:00.000Z",
          requestId: "test-confirmation-balance",
        },
      },
    }),
  );
  await page.route("**/api/swap/execute", async (route) => {
    const swappingButton = page.getByRole("button", {
      name: "Swapping",
      exact: true,
    });
    await expect(swappingButton).toBeVisible();
    await expect(swappingButton).toBeDisabled();
    await route.fulfill({
      json: {
        data: {
          status: "Success",
          signature: "confirmed-signature",
          code: 0,
          error: null,
          inputAmountResult: "1000000000",
          outputAmountResult: "150000000",
          totalInputAmount: "1000000000",
          totalOutputAmount: "150000000",
          walletorAccounting: {
            duplicate: false,
            swapId: "previous-low-value-swap",
            roundId: "solana:mainnet:prize-pool:2026-09-07",
            rewardEligible: false,
            eligibilityReason: "BELOW_MINIMUM_SWAP_VALUE",
            prizePoolContributionMicroUsd: "0",
            prizePoolContributionCents: "0",
            platformRevenueCents: "0",
            wltPointsCredited: "0",
            resultingLifetimeWltPoints: "0",
            resultingPrizePoolMicroUsd: "0",
            resultingPrizePoolCents: "0",
          },
        },
        meta: {
          source: "jupiter",
          fetchedAt: "2026-09-07T12:00:00.000Z",
          requestId: "test-confirmation-execute",
        },
      },
    });
  });
  await installReviewWallet(page, { allowSigning: true });

  await page.goto("/swap");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
    .click();

  const amountInput = page.getByLabel("Amount to pay");
  await amountInput.fill("1");
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "150",
  );
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(
    page.getByText(/Swap confirmed.*below \$5\.00 minimum/),
  ).toBeVisible();

  await amountInput.fill("0.125");
  await expect(page.locator(".swap-success")).toHaveCount(0);
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "150",
  );
});

test("the full SOL shortcut keeps a fee-safe reserve", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.route("**/api/wallet/balance?**", (route) =>
    route.fulfill({
      json: {
        data: {
          owner: reviewWalletAddress,
          inputMint: "So11111111111111111111111111111111111111112",
          inputAmount: "4994533",
          solAmount: "4994533",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-09-03T12:00:00.000Z",
          requestId: "test-small-sol-balance",
        },
      },
    }),
  );
  await installReviewWallet(page);

  await page.goto("/swap");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
    .click();

  const amountInput = page.getByLabel("Amount to pay");
  await page
    .getByRole("button", { name: "Use 25% of available SOL balance" })
    .click();
  await expect(amountInput).toHaveValue("0.001248633");
  await page
    .getByRole("button", { name: "Use 50% of available SOL balance" })
    .click();
  await expect(amountInput).toHaveValue("0.002497266");
  await page
    .getByRole("button", { name: "Use 100% of available SOL balance" })
    .click();
  await expect(amountInput).toHaveValue("0.001994533");
  await expect(page.locator(".balance-warning")).toHaveCount(0);

  await amountInput.fill("0");
  await expect(
    page.getByText("Enter a valid amount to get a quote"),
  ).toBeVisible();
  await expect(page.getByText("Finding the best Jupiter route…")).toHaveCount(
    0,
  );
});

test("wallet balances refresh after external activity without a page reload", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  let balanceAtomic = "1000000000";
  let balanceRequests = 0;
  await page.route("**/api/wallet/balance?**", (route) => {
    balanceRequests += 1;
    return route.fulfill({
      json: {
        data: {
          owner: reviewWalletAddress,
          inputMint: "So11111111111111111111111111111111111111112",
          inputAmount: balanceAtomic,
          solAmount: balanceAtomic,
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-09-08T00:00:00.000Z",
          requestId: `test-live-balance-${String(balanceRequests)}`,
        },
      },
    });
  });
  await installReviewWallet(page);

  await page.goto("/");
  await page
    .getByRole("banner")
    .getByRole("button", { name: /connect wallet/i })
    .click();
  await page
    .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
    .click();
  await expect(page.getByText("Balance: 1 SOL")).toBeVisible();

  balanceAtomic = "197100000";
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });

  await expect(page.getByText("Balance: 0.1971 SOL")).toBeVisible();
  expect(balanceRequests).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/\/$/);
});

test("an executable-route error is not mislabeled as an insufficient balance", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.route("**/api/wallet/balance?**", (route) =>
    route.fulfill({
      json: {
        data: {
          owner: reviewWalletAddress,
          inputMint: "So11111111111111111111111111111111111111112",
          inputAmount: "4994533",
          solAmount: "4994533",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-09-03T12:00:00.000Z",
          requestId: "test-small-sol-route-error",
        },
      },
    }),
  );
  await installReviewWallet(page);

  await page.goto("/swap");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
    .click();
  await page
    .getByRole("button", { name: "Use 100% of available SOL balance" })
    .click();
  await expect(page.getByLabel("Amount to pay")).toHaveValue("0.001994533");
  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "150",
  );

  await page.unroute("**/api/swap/order?**");
  await page.route("**/api/swap/order?**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "JUPITER_SWAP_REJECTED",
          message: "Jupiter could not prepare this swap.",
          retryable: false,
        },
        meta: { requestId: "test-route-error" },
      }),
    }),
  );

  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(
    page.getByText("Jupiter could not prepare this swap."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Swap", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Insufficient", exact: true }),
  ).toHaveCount(0);
});

test("a low SOL balance does not block an executable USDC swap", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.unroute("**/api/swap/order?**");
  await page.route("**/api/swap/order?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        swapOrderResponse({
          inputMint: testSwapOrder.outputMint,
          outputMint: testSwapOrder.inputMint,
          inAmount: "9599738",
          outAmount: "9053595",
          otherAmountThreshold: "9000000",
          inUsdValue: 9.6,
          outUsdValue: 9.55,
          inUsdValueDecimal: "9.60",
          outUsdValueDecimal: "9.55",
          router: "BisonFi",
          feeMint: testSwapOrder.inputMint,
          platformFee: {
            amount: null,
            feeBps: 50,
            feeMint: testSwapOrder.inputMint,
          },
        }),
      ),
    }),
  );
  await page.route("**/api/wallet/balance?**", (route) => {
    const inputMint = new URL(route.request().url()).searchParams.get(
      "inputMint",
    );
    return route.fulfill({
      json: {
        data: {
          owner: reviewWalletAddress,
          inputMint,
          inputAmount:
            inputMint === testSwapOrder.outputMint ? "10000000" : "3000000",
          solAmount: "300000",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-09-03T12:00:00.000Z",
          requestId: "test-low-sol-balance",
        },
      },
    });
  });
  await installReviewWallet(page);

  await page.goto("/swap");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
    .click();
  await page.getByRole("button", { name: "Reverse token pair" }).click();
  await page.getByLabel("Amount to pay").fill("9.599738");

  await expect(page.getByLabel("Estimated amount received")).toContainText(
    "0.009053595",
  );
  await expect(page.locator(".balance-warning")).toContainText(
    "You can continue",
  );
  await expect(page.getByText(/Minimum \$5\.00 swap to qualify/i)).toHaveCount(
    0,
  );
  await expect(page.getByText(/This quote is below \$5\.00/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Swap", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Insufficient", exact: true }),
  ).toHaveCount(0);
});

test("swap settings keeps its protection text readable and supports keyboard toggling", async ({
  page,
}, testInfo) => {
  await page.goto("/swap");
  const toggle = page.getByRole("button", { name: "Swap settings" });
  const panel = page.locator(".swap-settings-panel");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("Automatic execution protection")).toBeVisible();
  await expect(panel.locator("p")).toHaveText(
    "Jupiter RTSE optimizes slippage and priority fees for current network conditions. Walletor shows the final minimum received before you sign.",
  );

  const textSizes = await panel.evaluate((element) => {
    const renderedFontSize = (selector: string) => {
      const text = element.querySelector<HTMLElement>(selector);
      if (!text) throw new Error(`Missing settings text: ${selector}`);
      const scale = text.getBoundingClientRect().width / text.offsetWidth;
      return Number.parseFloat(getComputedStyle(text).fontSize) * scale;
    };
    return {
      heading: renderedFontSize("strong"),
      description: renderedFontSize("p"),
    };
  });
  expect(textSizes.heading).toBeCloseTo(18, 0);
  expect(textSizes.description).toBeCloseTo(16, 0);

  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 800 });
  }
  await expect(panel).toBeVisible();
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCount(0);
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
});

test("prize-pool glow breathes gently without moving the balance and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/swap");
  const orb = page.locator(".revenue-orbit");
  await expect(orb).toBeVisible();
  const before = await orb.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;
  const animation = await orb.evaluate((element) => {
    const glow = getComputedStyle(element, "::after");
    return {
      name: glow.animationName,
      duration: glow.animationDuration,
      iterations: glow.animationIterationCount,
      opacity: Number.parseFloat(glow.opacity),
      pointerEvents: glow.pointerEvents,
    };
  });
  expect(animation.name).toBe("walletor-orbit-breathe");
  expect(animation.duration).toBe("6s");
  expect(animation.iterations).toBe("infinite");
  expect(animation.pointerEvents).toBe("none");
  await expect
    .poll(async () => {
      const opacity = await orb.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element, "::after").opacity),
      );
      return Math.abs(opacity - animation.opacity);
    })
    .toBeGreaterThan(0.03);
  const after = await orb.boundingBox();
  expect(after).not.toBeNull();
  if (!after) return;
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  // Fonts and live data can finish settling the parent layout by a subpixel or
  // two while the animation is sampled. The orb itself must not scale or roam.
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(
    await orb.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
  expect(
    await orb
      .locator(".revenue-orbit__ring")
      .evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      orb.evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
    )
    .toBe("none");
  expect(
    await orb.evaluate(
      (element) => getComputedStyle(element, "::after").content,
    ),
  ).toBe("none");
  await expect(orb.getByRole("heading", { name: "Prize pool" })).toBeVisible();
});

for (const connected of [true, false]) {
  test(`small-price token search shows ${connected ? "wallet value" : "unit price"}`, async ({
    page,
  }) => {
    const priceUsd = 412.73 / 129_249_139.12;
    const meta = {
      source: "jupiter",
      fetchedAt: "2026-09-10T10:00:00.000Z",
      requestId: "holding-search",
    };
    await page.route("**/api/tokens/search?**", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              address: usdtMint,
              symbol: "PARA",
              name: "Paracetamol",
              decimals: 6,
              logoUrl: null,
              isVerified: false,
              priceUsd,
              organicScore: null,
              organicScoreLabel: null,
              marketCapUsd: null,
              liquidityUsd: null,
              holders: null,
              mintAuthorityDisabled: null,
              freezeAuthorityDisabled: null,
              topHoldersPercent: null,
            },
          ],
          meta,
        },
      }),
    );
    await page.route("**/api/wallet/holdings?**", (route) =>
      route.fulfill({
        json: {
          data: {
            owner: reviewWalletAddress,
            holdings: [
              {
                mint: usdtMint,
                symbol: "PARA",
                name: "Paracetamol",
                logoUrl: null,
                decimals: 6,
                amount: "129249139120000",
                priceUsd: null,
              },
            ],
          },
          meta: { ...meta, source: "solana-helius" },
        },
      }),
    );
    if (connected) await installReviewWallet(page);
    await page.goto("/swap");
    if (connected) {
      await page
        .getByRole("button", { name: "Connect Wallet", exact: true })
        .click();
      await page
        .getByRole("button", { name: /Walletor Review Wallet.*Detected/ })
        .click();
    }
    await page
      .getByRole("button", { name: "Choose token, currently SOL" })
      .click();
    const picker = page.getByRole("dialog", { name: "Choose a Solana token" });
    if (connected)
      await expect(
        picker.getByText("Value unavailable", { exact: true }),
      ).toBeVisible();
    await picker
      .getByPlaceholder("Search tokens or paste a mint")
      .fill(usdtMint);
    const result = picker
      .locator(".token-results > button")
      .filter({ hasText: "Paracetamol" });
    if (connected) {
      await expect(result.getByText("$412.73", { exact: true })).toBeVisible();
      await expect(
        result.getByText("129.2491M PARA", { exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        result.getByText("$0.00000319 / token", { exact: true }),
      ).toBeVisible();
    }
    await expect(result.getByText("$0.00", { exact: true })).toHaveCount(0);
  });
}

test("swap token search pairs the selected token against SOL by default", async ({
  page,
}, testInfo) => {
  await page.goto("/swap");
  if (testInfo.project.name === "mobile-chromium") {
    await page
      .getByRole("button", { name: "Choose token, currently SOL" })
      .click();
  } else {
    await page.getByRole("button", { name: /Search tokens/ }).click();
  }
  const tokenDialog = page.getByRole("dialog", {
    name: "Choose a Solana token",
  });
  await expect(tokenDialog).toBeVisible();
  await expect(
    tokenDialog.getByRole("button", { name: "Select SOL" }),
  ).toBeVisible();
  await expect(
    tokenDialog.getByRole("button", { name: "Select USDC" }),
  ).toBeVisible();
  await expect(
    tokenDialog.getByRole("button", { name: "Select USDT" }),
  ).toBeVisible();
  const quickSol = tokenDialog.getByRole("button", { name: "Select SOL" });
  await expect(quickSol).toHaveCSS(
    "height",
    testInfo.project.name === "mobile-chromium" ? "36px" : "40px",
  );
  await expect(quickSol.locator(".token-icon")).toHaveCSS(
    "width",
    testInfo.project.name === "mobile-chromium" ? "24px" : "26px",
  );
  const dialogLayout = await tokenDialog.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    return {
      centerOffset: Math.abs(
        bounds.left + bounds.width / 2 - window.innerWidth / 2,
      ),
      insideViewport:
        bounds.left >= 0 &&
        bounds.right <= window.innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= window.innerHeight,
      width: bounds.width,
    };
  });
  expect(dialogLayout.centerOffset).toBeLessThan(2);
  expect(dialogLayout.insideViewport).toBe(true);
  expect(dialogLayout.width).toBeLessThanOrEqual(620);
  await page.getByPlaceholder("Search tokens or paste a mint").fill(usdtMint);
  await expect(page.getByText("Tether USD")).toBeVisible();
  await expect(page.getByText(/Anyone can create a token/i)).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await expect(tokenDialog.locator(".token-category-tabs")).toBeHidden();
    const compactMobileLayout = await tokenDialog.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      const result = dialog.querySelector(".token-results > button");
      return {
        nearlyFullWidth: bounds.width >= window.innerWidth - 24,
        nearlyFullHeight: bounds.height >= window.innerHeight - 24,
        resultInsideDialog:
          result instanceof HTMLElement &&
          result.getBoundingClientRect().bottom <= bounds.bottom,
      };
    });
    expect(compactMobileLayout).toEqual({
      nearlyFullWidth: true,
      nearlyFullHeight: true,
      resultInsideDialog: true,
    });
  }
  await tokenDialog.locator(".token-results > button").click();
  await expect(
    page
      .locator(".amount-panel--pay")
      .getByRole("button", { name: "Choose token, currently SOL" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".amount-panel--receive")
      .getByRole("button", { name: "Choose token, currently USDT" }),
  ).toBeVisible();
});

test("token search labels verified tokens without treating high activity as verification", async ({
  page,
}) => {
  await page.goto("/swap");
  await page
    .getByRole("button", { name: "Choose token, currently SOL" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose a Solana token" });
  const rows = picker.locator(".token-results > button");
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) {
    await expect(row.locator(".token-result-safety small")).toHaveText(
      "VERIFIED",
    );
    await expect(row.locator('[title="Verified by Jupiter"]')).toBeVisible();
  }
  await expect(picker.getByText("High organic", { exact: true })).toHaveCount(
    0,
  );

  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            address: usdtMint,
            symbol: "TEST",
            name: "Unverified test token",
            logoUrl: null,
            decimals: 6,
            isVerified: false,
            organicScore: 99,
            organicScoreLabel: "high",
            priceUsd: null,
            marketCapUsd: null,
            liquidityUsd: null,
            holders: null,
            mintAuthorityDisabled: null,
            freezeAuthorityDisabled: null,
            topHoldersPercent: null,
          },
        ],
        meta: {
          source: "jupiter",
          fetchedAt: "2026-08-26T12:00:00.000Z",
          requestId: "verification-label-test",
        },
      },
    }),
  );
  await picker.getByPlaceholder("Search tokens or paste a mint").fill("TEST");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator(".token-result-safety small")).toHaveText(
    "Unverified",
  );
  await expect(rows.locator('[title="Verified by Jupiter"]')).toHaveCount(0);
  await expect(rows.getByText("VERIFIED", { exact: true })).toHaveCount(0);
});

test("token warnings stay collapsed until the user opens them", async ({
  page,
}) => {
  await page.unroute("**/api/tokens/search?**");
  await page.route("**/api/tokens/search?**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            address: usdtMint,
            symbol: "RISK",
            name: "Risk review token",
            logoUrl: null,
            decimals: 6,
            isVerified: false,
            organicScore: 3,
            organicScoreLabel: "low",
            priceUsd: null,
            marketCapUsd: null,
            liquidityUsd: null,
            holders: null,
            mintAuthorityDisabled: false,
            freezeAuthorityDisabled: false,
            topHoldersPercent: null,
          },
        ],
        meta: {
          source: "jupiter",
          fetchedAt: "2026-09-03T12:00:00.000Z",
          requestId: "warning-disclosure-test",
        },
      },
    }),
  );

  await page.goto("/swap");
  await page
    .locator(".amount-panel--receive")
    .getByRole("button", { name: "Choose token, currently USDC" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose a Solana token" });
  await picker.getByPlaceholder("Search tokens or paste a mint").fill("RISK");
  const riskResult = picker.locator(".token-results > button");
  await expect(riskResult).toContainText("RISK");
  await riskResult.click();

  const disclosure = page.locator(".token-warning-disclosure");
  const trigger = disclosure.locator("summary");
  const popover = disclosure.locator(".token-warning-popover");
  await expect(trigger).toHaveAccessibleName("Show 4 warnings for RISK");
  await expect(trigger).toContainText("4 Warnings");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(popover).toBeHidden();
  await expect(popover.getByText("Not Verified", { exact: true })).toBeHidden();
  expect(
    await disclosure.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBeLessThanOrEqual(36);

  await trigger.click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(popover).toBeVisible();
  await expect(
    popover.getByText("Not Verified", { exact: true }),
  ).toBeVisible();
  await expect(popover.getByText("Low Organic Activity")).toBeVisible();
  await expect(popover.getByText("Mint Authority Active")).toBeVisible();
  await expect(popover.getByText("Freeze Authority Active")).toBeVisible();
  expect(
    await popover.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        insideViewport:
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= window.innerHeight,
      };
    }),
  ).toEqual({ insideViewport: true });

  await page.keyboard.press("Escape");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("token pickers close on outside clicks or taps and return focus to their opener", async ({
  page,
}, testInfo) => {
  await page.goto("/swap");
  const solOpener = page.getByRole("button", {
    name: "Choose token, currently SOL",
  });
  const usdcOpener = page.getByRole("button", {
    name: "Choose token, currently USDC",
  });
  const openers = [solOpener, usdcOpener];
  if (testInfo.project.name === "chromium") {
    openers.push(page.getByRole("button", { name: /Search tokens/ }));
  }
  const dialog = page.getByRole("dialog", { name: "Choose a Solana token" });
  const backdrop = page.locator(".token-modal-backdrop");

  for (const opener of openers) {
    await opener.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Verified", exact: true }).click();
    await dialog.getByPlaceholder("Search tokens or paste a mint").click();
    await expect(dialog).toBeVisible();
    // The viewport corner is backdrop, including on narrow mobile layouts.
    if (testInfo.project.name === "mobile-chromium") {
      await backdrop.tap({ position: { x: 2, y: 2 } });
    } else {
      await backdrop.click({ position: { x: 2, y: 2 } });
    }
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL(/\/swap$/);
    await expect(solOpener).toBeVisible();
    await expect(usdcOpener).toBeVisible();
  }
});

test("token picker keeps inside drags open and still closes with Escape or its close button", async ({
  page,
}, testInfo) => {
  await page.goto("/swap");
  const opener = page.getByRole("button", {
    name: "Choose token, currently SOL",
  });
  const dialog = page.getByRole("dialog", { name: "Choose a Solana token" });
  await opener.click();
  await expect(dialog).toBeVisible();

  if (testInfo.project.name === "chromium") {
    const note = await dialog.locator(".token-risk-note").boundingBox();
    if (!note) throw new Error("Token risk note must be visible.");
    await page.mouse.move(note.x + 10, note.y + 10);
    await page.mouse.down();
    await page.mouse.move(2, 2, { steps: 5 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole("button", { name: "Close token selector" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("history counts only confirmed Walletor swaps stored on this device", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "walletor.confirmed-swaps.v2",
      JSON.stringify([
        {
          signature:
            "5vP3dHkNQ3S5uTnY8MqNc4n6fL7xR2kJ9aB1cD4eF6gH7iJ8kL9mN2pQ3rS4tU5v",
          confirmedAt: "2026-07-22T12:00:00.000Z",
          wallet: "So11111111111111111111111111111111111111112",
          inputToken: {
            symbol: "SOL",
            mint: "So11111111111111111111111111111111111111112",
          },
          outputToken: {
            symbol: "USDC",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          },
          inputAmount: "1",
          outputAmount: "150",
          inputUsdValue: 150,
        },
      ]),
    );
  });
  await page.goto("/swap?view=history");
  await expect(page.getByText("1 SOL → 150 USDC")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Confirmed swaps" }),
  ).toBeVisible();
});

test("Walletor Rewards explains the exact WLT Points rule", async ({
  page,
}) => {
  await page.goto("/rewards");
  await expect(
    page.getByRole("heading", { name: "Walletor Rewards" }),
  ).toBeVisible();
  await expect(page.getByText("+2 WLT per qualified swap")).toBeVisible();
  await expect(page.getByText("3 swaps", { exact: true })).toBeVisible();
  await expect(page.getByText("5 swaps", { exact: true })).toBeVisible();
  await expect(page.getByText("10 swaps", { exact: true })).toBeVisible();
  await expect(page.getByText("$100.00 volume", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("$250.00 volume", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("$1,000.00 volume", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /start swapping/i }),
  ).toBeVisible();
  await expect(
    page.getByText("Connect wallet to view your engine"),
  ).toHaveCount(0);
});

test("removed discovery pages stay out of navigation and return 404", async ({
  page,
}) => {
  await page.goto("/swap");
  await expect(page.getByRole("link", { name: "Trending" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New Tokens" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Token Tools" })).toHaveCount(0);

  await page.goto("/trending");
  await expect(page.getByText("Signal not found")).toBeVisible();

  await page.goto("/new-tokens");
  await expect(page.getByText("Signal not found")).toBeVisible();

  await page.goto("/token-tools");
  await expect(page.getByText("Signal not found")).toBeVisible();
});

test("direct token navigation survives SPA fallback", async ({ page }) => {
  await page.goto(`/tokens/${mint}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "SOL" })).toBeVisible();
  await expect(
    page.getByTitle("SOL market chart on Dexscreener"),
  ).toBeVisible();
});
