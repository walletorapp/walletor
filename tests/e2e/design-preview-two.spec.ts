import { expect, test } from "@playwright/test";
import type { WalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import type { WalletAccount, WindowAppReadyEvent } from "@wallet-standard/base";

test("second Walletor design uses the live Walletor engine and stays responsive", async ({
  page,
}) => {
  const requestedApiPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) requestedApiPaths.push(url.pathname);
  });

  await page.goto("/");

  const menuItems = page.locator(
    test.info().project.name === "mobile-chromium"
      ? ".concept-mobile-dock a"
      : ".concept-rail-nav .concept-rail-item",
  );
  await expect(menuItems).toHaveCount(
    test.info().project.name === "mobile-chromium" ? 5 : 10,
  );
  expect(await menuItems.allTextContents()).toEqual(
    test.info().project.name === "mobile-chromium"
      ? ["Swap", "Trenches", "Claims", "Rewards", "Airdrop"]
      : [
          "Swap",
          "Trenches",
          "Claims",
          "Stocks",
          "Rewards",
          "Airdrop",
          "History",
          "Referral",
          "Leaderboard",
          "Docs",
        ],
  );

  if (test.info().project.name === "mobile-chromium") {
    const mobileBrand = page.locator(".concept-mobile-brand");
    await expect(mobileBrand).toBeVisible();
    await expect(mobileBrand).toContainText("Walletor");
    const brandLayout = await mobileBrand.evaluate((element) => {
      const brand = element.getBoundingClientRect();
      const logo = element.querySelector("img")?.getBoundingClientRect();
      return {
        centerOffset: Math.abs(
          brand.left +
            brand.width / 2 -
            document.documentElement.clientWidth / 2,
        ),
        logoWidth: logo?.width ?? 0,
      };
    });
    expect(brandLayout.centerOffset).toBeLessThanOrEqual(1);
    expect(brandLayout.logoWidth).toBeGreaterThanOrEqual(64);
  }

  const openNavigation = async () => {
    const menuButton = page.getByRole("button", {
      name: "Open navigation menu",
    });
    if (await menuButton.isVisible()) await menuButton.click();
  };

  const openSection = async (
    name: "Swap" | "Rewards" | "Claims" | "History",
  ) => {
    const mobileLink = page
      .getByRole("navigation", { name: "Walletor mobile navigation" })
      .getByRole("link", { name, exact: true });

    if (await mobileLink.isVisible()) {
      await mobileLink.click();
      return;
    }

    await openNavigation();
    await page.getByRole("button", { name, exact: true }).click();
  };

  if (test.info().project.name === "mobile-chromium") {
    const dock = page.getByRole("navigation", {
      name: "Walletor mobile navigation",
    });
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("link")).toHaveCount(5);
    await expect(dock.getByRole("link", { name: "Swap" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const menuButton = page.getByRole("button", {
      name: "Open navigation menu",
    });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    const sideNavigation = page.getByRole("complementary", {
      name: "Walletor navigation",
    });
    await expect(sideNavigation).toBeVisible();
    await sideNavigation
      .getByRole("button", { name: "Close navigation menu" })
      .click();
    await expect(sideNavigation).toBeHidden();

    const dockLayout = await dock.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        bottomOffset: Math.abs(window.innerHeight - bounds.bottom),
        width: bounds.width,
      };
    });
    expect(dockLayout.bottomOffset).toBeLessThanOrEqual(1);
    expect(dockLayout.width).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
  } else {
    await expect(
      page.getByText("Airdrops Every Day", { exact: true }),
    ).toBeVisible();
    const liveEngineSignal = page.locator(".concept-rail-foot .concept-signal");
    await expect(liveEngineSignal).toBeVisible();
    const liveEngineStyle = await liveEngineSignal.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        backgroundColor: style.backgroundColor,
      };
    });
    expect(liveEngineStyle.animationName).toContain(
      "concept-live-engine-pulse",
    );
    expect(liveEngineStyle.backgroundColor).toBe("rgb(34, 197, 94)");
  }

  const liveSwapHeading = page.locator(".concept-live-swap-heading");
  if (test.info().project.name === "mobile-chromium") {
    await expect(liveSwapHeading).toBeHidden();
  } else {
    await expect(
      page.getByRole("heading", { name: "Swap", exact: true }),
    ).toBeVisible();
    const desktopColumnWidths = await page.evaluate(() => ({
      swap: document.querySelector(".concept-trade")?.getBoundingClientRect()
        .width,
      prizePool: document
        .querySelector(".concept-reactor")
        ?.getBoundingClientRect().width,
    }));
    expect(desktopColumnWidths.swap).toBeLessThanOrEqual(522);
    expect(desktopColumnWidths.prizePool).toBeGreaterThanOrEqual(398);

    const disconnectedGrid = await page.evaluate(() => {
      const grid = document.querySelector(".concept-grid");
      const trade = document.querySelector(".concept-trade");
      const reactor = document.querySelector(".concept-reactor");
      if (!grid || !trade || !reactor) return null;
      const gridBounds = grid.getBoundingClientRect();
      const tradeBounds = trade.getBoundingClientRect();
      const reactorBounds = reactor.getBoundingClientRect();
      return {
        columnCount: getComputedStyle(grid)
          .gridTemplateColumns.trim()
          .split(/\s+/).length,
        contentCenterOffset: Math.abs(
          (tradeBounds.left + reactorBounds.right) / 2 -
            (gridBounds.left + gridBounds.width / 2),
        ),
      };
    });
    expect(disconnectedGrid?.columnCount).toBe(2);
    expect(disconnectedGrid?.contentCenterOffset).toBeLessThanOrEqual(1);

    const amountPanelColors = await page.evaluate(() => {
      const color = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).color : "";
      };
      const amountInput = document.querySelector(
        ".amount-panel--pay .amount-panel__value input",
      );
      return {
        label: color(".amount-panel--pay .amount-panel__label > span"),
        balance: color(".amount-panel--pay .amount-panel__tools > span"),
        percentage: color(".amount-panel--pay .amount-panel__tools button"),
        placeholder: amountInput
          ? getComputedStyle(amountInput, "::placeholder").color
          : "",
        fiatValue: color(".amount-panel--pay .amount-panel__value small"),
        received: color(".amount-panel--receive .amount-panel__value output"),
      };
    });
    expect(new Set(Object.values(amountPanelColors))).toEqual(
      new Set(["rgb(248, 251, 255)"]),
    );
  }
  const detailedPoolHeading = page.getByRole("heading", {
    name: "You could win USDC.",
  });
  if (test.info().project.name === "mobile-chromium") {
    const mobilePoolSnapshot = page.getByRole("region", {
      name: "Prize Pool and time remaining",
    });
    await expect(mobilePoolSnapshot).toBeVisible();
    await expect(mobilePoolSnapshot.getByText("Prize pool")).toBeVisible();
    await expect(mobilePoolSnapshot.getByText("Time left")).toBeVisible();

    const mobilePoolOrder = await page.evaluate(() => {
      const snapshot = document.querySelector(".concept-mobile-pool-snapshot");
      const swap = document.querySelector("#concept-swap");
      const detailedPool = document.querySelector("#concept-pool");
      return {
        snapshotTop: snapshot?.getBoundingClientRect().top ?? 0,
        swapTop: swap?.getBoundingClientRect().top ?? 0,
        detailedPoolTop: detailedPool?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(mobilePoolOrder.snapshotTop).toBeLessThan(mobilePoolOrder.swapTop);
    expect(mobilePoolOrder.swapTop).toBeLessThan(
      mobilePoolOrder.detailedPoolTop,
    );
  }
  await expect(detailedPoolHeading).toBeVisible();
  const roundProgress = page.getByRole("progressbar", {
    name: "Daily Prize Pool round progress",
  });
  await expect(roundProgress).toBeVisible();
  await expect(page.getByText("Until next distribution")).toBeVisible();
  await expect(roundProgress.locator(".concept-progress-fill")).toHaveCount(1);
  const progressPresentation = await page
    .locator(".concept-progress")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const track = element.querySelector(".concept-progress-track");
      return {
        backgroundImage: style.backgroundImage,
        borderWidth: style.borderTopWidth,
        trackHeight: track?.getBoundingClientRect().height ?? 0,
      };
    });
  expect(progressPresentation).toEqual({
    backgroundImage: "none",
    borderWidth: "0px",
    trackHeight: 4,
  });
  await expect(page.locator(".concept-reward-steps")).toHaveCount(0);
  const desktopPoolFomo = page.getByRole("region", {
    name: "Current Prize Pool round and time remaining",
  });
  if (test.info().project.name === "mobile-chromium") {
    await expect(desktopPoolFomo).toBeHidden();
  } else {
    await expect(desktopPoolFomo).toBeVisible();
    await expect(desktopPoolFomo.getByText("Live prize pool")).toBeVisible();
    await expect(desktopPoolFomo.getByText("Round closes in")).toBeVisible();
    await expect(
      desktopPoolFomo.getByText(
        "One eligible swap activates your entry for this 24-hour round.",
      ),
    ).toBeVisible();
    await expect(
      desktopPoolFomo.getByText("Qualify before the countdown reaches zero."),
    ).toBeVisible();
  }
  const socialNavigation = page.getByRole("navigation", {
    name: "Walletor social links",
  });
  await expect(socialNavigation).toBeVisible();
  await expect(socialNavigation.getByRole("link")).toHaveCount(3);
  for (const socialName of ["X", "Telegram", "Discord"]) {
    const socialLink = socialNavigation.getByRole("link", {
      name: `Walletor on ${socialName}`,
    });
    await expect(socialLink).toBeVisible();
    await expect(socialLink.locator("svg")).toHaveCount(1);
  }
  await expect(
    page.getByRole("heading", { name: "Walletor Rewards", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("WLT points this round")).toBeVisible();
  await expect(page.getByText("Eligible volume")).toBeVisible();
  await expect(
    page
      .getByLabel("WLT points earned this round")
      .getByLabel("Lifetime WLT points earned"),
  ).toBeVisible();
  await expect(page.getByText("+2 WLT per qualified swap")).toBeVisible();
  if (test.info().project.name !== "mobile-chromium") {
    const firstSwapCta = page
      .locator(".concept-engine--page .concept-engine-milestones > div")
      .first();
    await expect(firstSwapCta).toHaveClass(/is-cta/);
    expect(
      await firstSwapCta.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toContain("concept-first-swap-pulse");
    for (const removedLabel of [
      "Your entry",
      "Instant reward",
      "Start your streak",
    ]) {
      await expect(page.getByText(removedLabel, { exact: true })).toHaveCount(
        0,
      );
    }

    const cashNote = page.getByTestId("concept-two-cash-motion");
    const firstTransform = await cashNote.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await page.waitForTimeout(220);
    const secondTransform = await cashNote.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    expect(secondTransform).not.toBe(firstTransform);
  }

  await expect(
    page.getByRole("button", { name: "Connect / Swap" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Market" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Limit" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Recurring" })).toHaveCount(0);
  for (const percentage of ["25", "50", "100"]) {
    const balanceShortcut = page.getByRole("button", {
      name: `Use ${percentage}% of available SOL balance`,
    });
    await expect(balanceShortcut).toBeVisible();
    await expect(balanceShortcut).toBeDisabled();
  }
  await page.getByRole("button", { name: "Search tokens" }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose a Solana token" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(requestedApiPaths).toContain("/api/prize-pool");

  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(
    overflow.viewportWidth + 1,
  );

  await page
    .locator(".concept-claim")
    .getByText("Claim Prize Pool Airdrop")
    .click();
  const walletDialog = page.getByRole("dialog");
  await expect(walletDialog).toBeVisible();
  await expect(
    walletDialog.getByRole("heading", {
      name: "Connect a wallet on Solana to continue",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(walletDialog).toBeHidden();

  await openSection("Claims");
  await expect(page).toHaveURL(/\/claim-rewards$/);
  await expect(
    page.getByRole("heading", { name: "Your rewards, verified.", level: 1 }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "WLT points earned" }),
  ).toBeVisible();
  const claimSwapCta = page.getByRole("link", {
    name: /Start swapping now/,
  });
  await expect(claimSwapCta).toHaveCount(0);
  const currentClaimItem =
    test.info().project.name === "mobile-chromium"
      ? page
          .getByRole("navigation", { name: "Walletor mobile navigation" })
          .getByRole("link", { name: "Claims", exact: true })
      : page.getByRole("button", { name: "Claims", exact: true });
  await expect(currentClaimItem).toHaveAttribute("aria-current", "page");

  await openSection("Rewards");
  await expect(page).toHaveURL(/\/rewards$/);
  await expect(
    page.getByRole("heading", { name: "Walletor Rewards", level: 1 }),
  ).toBeVisible();
  const levelProgressCopy = page.locator(
    ".concept-engine--page .concept-engine-level-copy",
  );
  const levelTitle = levelProgressCopy.locator("span");
  const [levelCopyBox, levelTitleBox] = await Promise.all([
    levelProgressCopy.boundingBox(),
    levelTitle.boundingBox(),
  ]);
  expect(levelCopyBox).not.toBeNull();
  expect(levelTitleBox).not.toBeNull();
  if (levelCopyBox && levelTitleBox) {
    const levelCopyCenter = levelCopyBox.x + levelCopyBox.width / 2;
    const levelTitleCenter = levelTitleBox.x + levelTitleBox.width / 2;
    expect(Math.abs(levelCopyCenter - levelTitleCenter)).toBeLessThanOrEqual(1);
  }
  expect(
    await levelTitle.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(20);
  await expect(page.getByText(/^Round rewards/)).toBeVisible();
  const rewardsLadderCopy = page.locator(
    ".concept-rewards-page .concept-engine-milestones strong",
  );
  await expect(rewardsLadderCopy).toHaveCount(4);
  for (const text of await rewardsLadderCopy.all()) {
    expect(
      await text.evaluate((element) => getComputedStyle(element).color),
    ).toBe("rgb(255, 255, 255)");
  }
  const rewardsLadder = page.locator(
    ".concept-rewards-page .concept-engine-ladder",
  );
  const rewardsPanel = page.locator(
    ".concept-rewards-page .concept-engine--page",
  );
  const [rewardsLadderBox, rewardsPanelBox] = await Promise.all([
    rewardsLadder.boundingBox(),
    rewardsPanel.boundingBox(),
  ]);
  expect(rewardsLadderBox).not.toBeNull();
  expect(rewardsPanelBox).not.toBeNull();
  if (rewardsLadderBox && rewardsPanelBox) {
    const widthRatio = rewardsLadderBox.width / rewardsPanelBox.width;
    if (test.info().project.name === "mobile-chromium") {
      expect(widthRatio).toBeGreaterThan(0.95);
    } else {
      expect(widthRatio).toBeGreaterThan(0.68);
      expect(widthRatio).toBeLessThan(0.72);
    }
  }
  for (const locked of await page
    .locator(".concept-rewards-page .concept-engine-locked")
    .all()) {
    expect(
      await locked.evaluate((element) => getComputedStyle(element).color),
    ).toBe("rgb(255, 255, 255)");
  }

  await page.getByRole("link", { name: "Go to Walletor homepage" }).click();
  await expect(page).toHaveURL(/\/$/);
  if (test.info().project.name === "mobile-chromium") {
    await expect(liveSwapHeading).toBeHidden();
  } else {
    await expect(
      page.getByRole("heading", { name: "Swap", exact: true }),
    ).toBeVisible();
  }

  await page.goto("/prize-pool");
  await expect(page).toHaveURL(/\/prize-pool$/);
  await expect(
    page.getByRole("heading", { name: "Prize Pool", level: 1 }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Follow automatic formula-based allocations/),
  ).toBeVisible();
  await expect(
    page.getByText("Distribution date", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/^\d+ finalized dates?$/, { exact: true }),
  ).toBeVisible();

  await openSection("History");
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page.getByRole("heading", { name: "Swap History", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("No confirmed swaps on this device"),
  ).toBeVisible();

  await openSection("Swap");
  await expect(page).toHaveURL(/\/$/);
  if (test.info().project.name === "mobile-chromium") {
    await expect(liveSwapHeading).toBeHidden();
  } else {
    await expect(
      page.getByRole("heading", { name: "Swap", exact: true }),
    ).toBeVisible();
  }
});

test("connected wallet shows holdings and desktop-only verified reward cards", async ({
  page,
}, testInfo) => {
  const walletAddress = "11111111111111111111111111111111";
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  let previousRoundClaimed = false;

  await page.route("**/api/wallet/holdings?**", (route) =>
    route.fulfill({
      json: {
        data: {
          owner: walletAddress,
          holdings: [
            {
              mint: usdcMint,
              symbol: "USDC",
              name: "USD Coin",
              logoUrl:
                "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
              decimals: 6,
              amount: "2500000",
              priceUsd: 1,
            },
          ],
        },
        meta: {
          source: "solana-helius",
          fetchedAt: "2026-08-31T18:55:00.000Z",
          requestId: "test-holdings",
        },
      },
    }),
  );
  await page.route("**/api/wallet/balance?**", (route) =>
    route.fulfill({
      json: {
        data: {
          owner: walletAddress,
          inputMint: "So11111111111111111111111111111111111111112",
          inputAmount: "0",
          solAmount: "0",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-08-31T18:55:00.000Z",
          requestId: "test-balance",
        },
      },
    }),
  );
  await page.route("**/api/wallets/*/engine", (route) =>
    route.fulfill({
      json: {
        data: {
          accountingStatus: "LIVE",
          walletAddress,
          pointsLabel: "WLT Points",
          futureAllocationLabel: "Future WLT Airdrop Allocation",
          pointsPerEligibleSwap: "2",
          eligibilityPolicy: {
            everyConfirmedFeeBearingSwapCounts: true,
            transactionSignatureCreditedOnce: true,
          },
          activeRound: {
            roundId: "round-cta-test",
            status: "OPEN",
            startTime: "2026-08-31T00:00:00.000Z",
            endTime: "2026-09-01T00:00:00.000Z",
          },
          currentRound: {
            actualSwaps: 3,
            eligibleSwaps: 3,
            eligibleVolumeCents: "3000",
            active: true,
            multiplierBps: 11_000,
            achievedTier: 3,
            nextTier: 5,
            swapsUntilNextTier: 2,
          },
          currentDay: {
            actualSwaps: 3,
            eligibleSwaps: 3,
            eligibleVolumeCents: "3000",
            active: true,
            multiplierBps: 11_000,
            achievedTier: 3,
            nextTier: 5,
            swapsUntilNextTier: 2,
          },
          lifetimeWltPoints: "6",
          pendingWltPoints: "6",
          convertedWltPoints: "0",
          serverTime: "2026-08-31T18:55:00.000Z",
        },
        meta: {
          source: "walletor-ledger",
          fetchedAt: "2026-08-31T18:55:00.000Z",
          requestId: "test-engine-cta",
        },
      },
    }),
  );
  await page.route("**/api/wallets/*/solana-claims", (route) =>
    route.fulfill({
      json: {
        data: {
          availability: "MAINNET_LIVE",
          network: "MAINNET",
          walletAddress,
          programId: "REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi",
          settlementAsset: {
            mintAddress: usdcMint,
            symbol: "USDC",
            decimals: 6,
          },
          claimFeeBps: 250,
          entitlements: [
            {
              entitlementId: `round-claim-test:${walletAddress}`,
              roundId: "round-claim-test",
              winnerAddress: walletAddress,
              provider: "SOLANA_FOUNDATION_REWARDS",
              distributionAddress:
                "5ZgHPb447UcXavVTorgYBr8egi3sw7dXKpX4Frec9rYS",
              distributionVaultAddress:
                "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
              claimAccountAddress:
                "D5ZxUNUZvn5vJn4ivFRNTzMTwYbgCYYEE1Arzesde5ra",
              mintAddress: usdcMint,
              mintSymbol: "USDC",
              mintDecimals: 6,
              rank: 1,
              grossAmountAtomic: "100000000",
              claimFeeAmountAtomic: "2500000",
              netAmountAtomic: "97500000",
              claimedAmountAtomic: previousRoundClaimed ? "97500000" : "0",
              remainingAmountAtomic: previousRoundClaimed ? "0" : "97500000",
              claimFeeBps: 250,
              claimDeadline: "2026-09-30T00:00:00.000Z",
              status: previousRoundClaimed ? "CLAIMED" : "CLAIMABLE",
              transactionSignature: null,
            },
          ],
          serverTime: "2026-08-31T18:55:00.000Z",
        },
        meta: {
          source: "solana",
          fetchedAt: "2026-08-31T18:55:00.000Z",
          requestId: "test-solana-claim-cta",
        },
      },
    }),
  );
  await page.addInitScript((address) => {
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
      name: "Walletor Holdings Wallet",
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
          signTransaction: () =>
            Promise.reject(new Error("Test wallet cannot sign transactions")),
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => {
      (event as WindowAppReadyEvent).detail.register(testWallet);
    });
  }, walletAddress);

  await page.goto("/");
  await page
    .locator(".concept-wallet-shell")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Holdings Wallet.*Detected/ })
    .click();

  await expect(
    page.locator(".concept-claim").getByText("Claim Prize Pool Airdrop"),
  ).toBeVisible();

  previousRoundClaimed = true;
  await page.reload();
  await expect(page.locator(".concept-claim")).toHaveText(
    "Claim Prize Pool Airdrop",
  );
  await expect(page.locator(".concept-claim .lucide-check")).toHaveCount(0);

  const verifiedRewards = page.getByRole("complementary", {
    name: "Verified Walletor rewards activity",
  });
  if (testInfo.project.name === "mobile-chromium") {
    await expect(verifiedRewards).toBeHidden();
    return;
  }
  await expect(verifiedRewards).toBeVisible();
  const connectedGridColumnCount = await page
    .locator(".concept-grid")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
          .length,
    );
  expect(connectedGridColumnCount).toBe(3);
  const verifiedCards = verifiedRewards.locator(".concept-game-card");
  await expect(verifiedCards).toHaveCount(3);
  await expect(verifiedRewards.getByText("Verified")).toHaveCount(3);
  for (const verifiedCard of await verifiedCards.all()) {
    const style = await verifiedCard.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const status = element.querySelector(".concept-game-card-status");
      return {
        borderColor: getComputedStyle(element).borderColor,
        height: bounds.height,
        statusColor: status ? getComputedStyle(status).color : "",
      };
    });
    expect(style.borderColor).toBe("rgba(74, 222, 128, 0.46)");
    expect(style.height).toBeGreaterThanOrEqual(138);
    expect(style.statusColor).toBe("rgb(134, 239, 172)");
  }

  const nextRewardMilestone = page
    .locator(".concept-engine--page .concept-engine-milestones > div")
    .filter({ hasText: "5 swaps" });
  await expect(nextRewardMilestone).toHaveClass(/is-cta/);
  await expect(
    nextRewardMilestone.getByRole("button", { name: /Keep swapping/ }),
  ).toBeVisible();
  const nextRewardStyle = await nextRewardMilestone.evaluate((element) => {
    const button = element.querySelector("button");
    return {
      animationName: getComputedStyle(element).animationName,
      buttonBackground: button
        ? getComputedStyle(button).backgroundColor
        : "missing",
    };
  });
  expect(nextRewardStyle.animationName).toContain("concept-first-swap-pulse");
  expect(nextRewardStyle.buttonBackground).toBe("rgba(22, 163, 74, 0.3)");

  await page
    .getByRole("button", { name: "Choose token, currently SOL" })
    .click();

  const selector = page.getByRole("dialog", {
    name: "Choose a Solana token",
  });
  await expect(selector.getByRole("tab", { name: "Holdings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(selector.getByText("2.5 USDC", { exact: true })).toBeVisible();
  await expect(selector.getByText("$2.50", { exact: true })).toBeVisible();
  await selector.getByText("2.5 USDC", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Choose token, currently USDC" }),
  ).toBeVisible();
});
