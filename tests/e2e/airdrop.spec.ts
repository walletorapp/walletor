import { expect, test } from "@playwright/test";

test("Airdrop page makes one verified daily swap the primary quest", async ({
  page,
}) => {
  await page.goto("/airdrop");

  await expect(
    page.getByRole("heading", { name: /One swap\. Every day\./ }),
  ).toBeVisible();
  await expect(page.getByText("1 swap", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect(page.getByText("Round goal")).toBeVisible();
  await expect(page.getByText("Earn points", { exact: true })).toBeVisible();

  const airdropNavigation =
    test.info().project.name === "mobile-chromium"
      ? page.getByRole("navigation", { name: "Walletor mobile navigation" })
      : page.getByRole("complementary", { name: "Walletor navigation" });
  const airdropEntry = airdropNavigation.getByText("Airdrop", { exact: true });
  await expect(airdropEntry).toBeVisible();
  await expect(airdropEntry.locator("..")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page
    .getByRole("region", { name: /One swap\. Every day\./ })
    .getByRole("button", { name: /Connect wallet/ })
    .click();
  await expect(page.locator(".wallet-adapter-modal")).toBeVisible();
});
