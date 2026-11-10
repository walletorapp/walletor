import { expect, test } from "@playwright/test";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import type { WalletAccount, WindowAppReadyEvent } from "@wallet-standard/base";

import type {
  ClaimRewardsState,
  WalletEngineState,
} from "../../shared/accounting-contracts";
import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
} from "../../shared/usdc-claim-contracts";

// A simulated wallet: no private key or network broadcast. The send method
// returns a fake signature exclusively for mocked claim endpoint tests.
const walletAddress = "11111111111111111111111111111111";
const serverTime = "2026-08-26T12:00:00.000Z";
const activeRound = {
  roundId: "solana:mainnet:prize-pool:2026-08-26",
  status: "OPEN" as const,
  startTime: "2026-08-26T00:00:00.000Z",
  endTime: "2026-08-27T00:00:00.000Z",
};

test("Claim Rewards shows only verified on-chain winnings and keeps legacy estimates separate", async ({
  page,
}, testInfo) => {
  let claimData: ClaimRewardsState = {
    walletAddress,
    serverTime,
    activeRound,
    claimSystemStatus: "UNAVAILABLE_BETA",
    claimableRewardsCents: "0",
    pendingRewardsCents: "1250",
    lifetimePaidCents: "0",
    allocations: [
      {
        allocationId: "test-allocation",
        roundId: "solana:mainnet:prize-pool:2026-08-25",
        roundEndTime: "2026-08-26T00:00:00.000Z",
        rewardCents: "1250",
        status: "CLAIM_UNAVAILABLE_BETA",
        payoutTransactionHash: null,
        createdAt: "2026-08-26T00:00:01.000Z",
      },
    ],
    feePolicy: {
      networkFeePayer: "CLAIMANT",
      networkFeeAsset: "SOL",
      estimatedNetworkFeeLamports: null,
      withdrawalFeeBps: 250,
      explanation:
        "The claiming wallet pays the Solana network fee shown before signing.",
    },
  };
  const engineData: WalletEngineState = {
    walletAddress,
    serverTime,
    activeRound,
    accountingStatus: "LIVE",
    pointsLabel: "WLT Points",
    futureAllocationLabel: "Future WLT Airdrop Allocation",
    pointsPerEligibleSwap: "2",
    eligibilityPolicy: {
      everyConfirmedFeeBearingSwapCounts: false,
      minimumEligibleSwapUsd: "5.00",
      transactionSignatureCreditedOnce: true,
    },
    currentRound: {
      actualSwaps: 5,
      eligibleSwaps: 5,
      eligibleVolumeCents: "25000",
      active: true,
      multiplierBps: 12500,
      achievedTier: 5,
      nextTier: 10,
      swapsUntilNextTier: 5,
    },
    currentDay: {
      actualSwaps: 5,
      eligibleSwaps: 5,
      eligibleVolumeCents: "25000",
      active: true,
      multiplierBps: 12500,
      achievedTier: 5,
      nextTier: 10,
      swapsUntilNextTier: 5,
    },
    lifetimeWltPoints: "25",
    pendingWltPoints: "25",
    convertedWltPoints: "0",
  };
  const meta = {
    source: "walletor-ledger",
    fetchedAt: serverTime,
    requestId: "test-claims",
  };
  await page.route("**/api/wallets/*/claims", (route) =>
    route.fulfill({ json: { data: claimData, meta } }),
  );
  await page.route("**/api/wallets/*/engine", (route) =>
    route.fulfill({ json: { data: engineData, meta } }),
  );
  await page.route("**/api/wallets/*/solana-claims", (route) =>
    route.fulfill({
      json: {
        data: {
          availability: "DISABLED",
          network: "MAINNET",
          walletAddress,
          programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
          settlementAsset: {
            mintAddress: SOLANA_MAINNET_USDC_MINT,
            symbol: "USDC",
            decimals: 6,
          },
          claimFeeBps: 250,
          entitlements: [],
          serverTime,
        },
        meta: {
          source: "solana",
          fetchedAt: serverTime,
          requestId: "test-solana-claims",
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
        features: ["solana:signTransaction", "solana:signAndSendTransaction"],
      },
    ];
    const testWallet: WalletAdapterCompatibleStandardWallet = {
      version: "1.0.0",
      name: "Walletor Test Wallet",
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
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: () =>
            Promise.resolve([{ signature: new Uint8Array(64).fill(1) }]),
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => {
      (event as WindowAppReadyEvent).detail.register(testWallet);
    });
  }, walletAddress);

  await page.goto("/claim-rewards");
  const winnings = page.getByRole("region", { name: "Total won" });
  const claimStatus = page.getByRole("region", { name: "Claim status" });
  const claimAction = page.getByRole("region", { name: "Claim action" });
  const points = page.getByRole("region", { name: "WLT points earned" });
  const pointActivity = page.getByRole("region", { name: "WLT activity" });
  await claimAction
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Walletor Test Wallet.*Detected/ })
    .click();
  await expect(
    page.getByRole("region", { name: "Total rounds" }).getByText("1"),
  ).toBeVisible();
  await expect(winnings.getByText("$0.00", { exact: true })).toBeVisible();
  await expect(claimStatus.getByText("No verified winning yet")).toBeVisible();
  await expect(
    claimStatus.getByText(/legacy ledger estimate exists/),
  ).toContainText("$12.50 legacy ledger estimate");
  await expect(points.getByText("25", { exact: true })).toBeVisible();
  await expect(
    pointActivity.getByText(
      "2 WLT points per Jupiter-confirmed Walletor swap valued at $5.00 or more.",
    ),
  ).toBeVisible();
  await expect(
    claimAction.getByRole("button", { name: "Result not finalized" }),
  ).toBeDisabled();
  await expect(page.getByRole("table")).toBeHidden();
  await expect(page.locator(".claim-round, .claim-swap-cta")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("claim-rewards.png"),
    fullPage: true,
  });
  await page.getByRole("region", { name: "Live Prize Pool" }).screenshot({
    path: testInfo.outputPath("claim-cash-pool.png"),
  });

  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(page.getByRole("timer")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await claimAction.screenshot({
      path: testInfo.outputPath("claim-action-small-mobile.png"),
    });
  }

  const history = page.locator(".claim-history > summary");
  await history.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("26.08.2026", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  claimData = { ...claimData, pendingRewardsCents: "0", allocations: [] };
  await page.reload();
  await expect(winnings.getByText("$0.00", { exact: true })).toBeVisible();
  await expect(
    claimStatus.getByText("Start swapping for a chance to win next time."),
  ).toBeVisible();
  await expect(points.getByText("25", { exact: true })).toBeVisible();
  await expect(
    claimAction.getByRole("button", { name: "Withdraw Winnings" }),
  ).toHaveCount(0);
  const entitlement = {
    entitlementId: "confirmed-popup-test",
    roundId: activeRound.roundId,
    winnerAddress: walletAddress,
    rank: 1,
    provider: "SOLANA_FOUNDATION_REWARDS",
    distributionAddress: walletAddress,
    distributionVaultAddress: walletAddress,
    claimAccountAddress: walletAddress,
    mintAddress: SOLANA_MAINNET_USDC_MINT,
    mintSymbol: "USDC",
    mintDecimals: 6,
    grossAmountAtomic: "1800000",
    claimFeeAmountAtomic: "45000",
    netAmountAtomic: "1755000",
    claimedAmountAtomic: "0",
    remainingAmountAtomic: "1755000",
    claimFeeBps: 250,
    claimDeadline: "2027-09-16T00:00:00.000Z",
    status: "CLAIMABLE",
    transactionSignature: null,
  };
  await page.route("**/api/wallets/*/solana-claims", (route) =>
    route.fulfill({
      json: {
        data: {
          availability: "MAINNET_LIVE",
          network: "MAINNET",
          walletAddress,
          programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
          settlementAsset: {
            mintAddress: SOLANA_MAINNET_USDC_MINT,
            symbol: "USDC",
            decimals: 6,
          },
          claimFeeBps: 250,
          entitlements: [entitlement],
          serverTime,
        },
        meta: { ...meta, source: "solana" },
      },
    }),
  );
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(walletAddress),
      recentBlockhash: walletAddress,
      instructions: [],
    }).compileToV0Message(),
  );
  await page.route("**/api/solana-claims/build", (route) =>
    route.fulfill({
      json: {
        data: {
          network: "MAINNET",
          transaction: Buffer.from(transaction.serialize()).toString("base64"),
          blockhash: walletAddress,
          lastValidBlockHeight: "1234",
          entitlement,
        },
        meta: { ...meta, source: "solana" },
      },
    }),
  );
  await page.route("**/api/solana-claims/submit", (route) =>
    route.fulfill({
      json: {
        data: {
          network: "MAINNET",
          transactionSignature: "1".repeat(64),
          status: "CONFIRMED",
        },
        meta: { ...meta, source: "solana" },
      },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Claim 1.755 USDC" }).waitFor();
  await page.locator(".claim-heading").screenshot({
    path: testInfo.outputPath("claim-primary-action.png"),
  });
  await page.getByRole("button", { name: "Claim 1.755 USDC" }).click();
  const popup = page.getByRole("dialog", { name: "Your earnings are in" });
  await expect(popup.getByText("$1.755 USDC")).toBeVisible();
  await expect(popup.getByText("25 WLT points")).toBeVisible();
  for (const network of ["Twitter", "WhatsApp", "Telegram"]) {
    await expect(
      popup.getByRole("link", { name: `Share on ${network}` }),
    ).toHaveAttribute("target", "_blank");
  }
  await popup.screenshot({
    path: testInfo.outputPath("claim-success-popup.png"),
  });
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
});
