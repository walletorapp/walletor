import { expect, test } from "@playwright/test";
import type { WalletAccount, WindowAppReadyEvent } from "@wallet-standard/base";
import type { WalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";

test("swap connect opens the wallet picker on the first tap", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  const connect = page.getByRole("button", {
    name: "Connect / Swap",
    exact: true,
  });
  if (isMobile) await connect.tap();
  else await connect.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /Phantom/ }),
  ).toBeVisible();
});

for (const buttonName of ["Connect wallet", "Connect / Swap"]) {
  test(`${buttonName} recovers from a remembered, uninstalled Backpack`, async ({
    page,
    isMobile,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("walletName", JSON.stringify("Backpack"));
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
            connect: () => Promise.resolve({ accounts }),
          },
          "standard:events": { version: "1.0.0", on: () => () => undefined },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: () =>
              Promise.reject(new Error("Test cannot sign")),
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => {
        (event as WindowAppReadyEvent).detail.register(wallet);
      });
    });
    const popups: string[] = [];
    page.on("popup", (popup) => {
      popups.push(popup.url());
    });
    await page.goto("/");
    const connect = page.getByRole("button", { name: buttonName, exact: true });
    await expect(connect).toBeVisible();
    if (isMobile) await connect.tap();
    else await connect.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("walletName")))
      .toBeNull();
    await dialog.getByRole("button", { name: /^Test Wallet/ }).click();
    const connected = page.getByRole("button", { name: /Test Wallet ·/ });
    await expect(connected).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("walletName")))
      .toBe('"Test Wallet"');
    await connected.click();
    await expect(
      page.getByRole("menuitem", { name: "Change wallet", exact: true }),
    ).toBeVisible();
    expect(popups).toEqual([]);
    await expect(page).toHaveURL(/127\.0\.0\.1:4173\/$/);
  });
}

test("Safari lets users explicitly reselect a remembered Phantom wallet", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-webkit",
    "iOS Phantom universal-link handoff",
  );
  await page.addInitScript(() => {
    localStorage.setItem("walletName", JSON.stringify("Phantom"));
  });
  await page.route("https://phantom.app/ul/browse/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "Phantom handoff",
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Connect / Swap", exact: true }).tap();
  const dialog = page.getByRole("dialog");
  const phantom = dialog.getByRole("button", { name: /Phantom/ });
  await expect(phantom).toBeAttached();
  const moreOptions = dialog.getByRole("button", { name: "More options" });
  if (await moreOptions.isVisible()) await moreOptions.tap();
  await phantom.tap();
  await expect(page).toHaveURL(/^https:\/\/phantom\.app\/ul\/browse\//);
});
