import { expect, test } from "@playwright/test";

test("quest visits tag swap quotes, disclose sharing and allow leaving", async ({
  page,
}) => {
  await page.route("**/api/swap/order?**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "TEST_UNAVAILABLE",
          message: "Test quote unavailable",
          retryable: true,
        },
      },
    }),
  );
  await page.goto("/?quest=89");
  const notice = page.getByRole("complementary", {
    name: "MagicBlock daily quest",
  });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(
    "wallet address and verified completion will be shared",
  );
  const quote = page.waitForRequest((request) =>
    request.url().includes("/api/swap/order?"),
  );
  await page.getByLabel("Amount to pay").fill("0.1");
  expect(new URL((await quote).url()).searchParams.get("questline")).toBe("89");
  await notice.getByRole("button", { name: "Leave quest" }).click();
  await expect(notice).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]quest=89/);
  const normal = page.waitForRequest((request) =>
    request.url().includes("/api/swap/order?"),
  );
  await page.getByLabel("Amount to pay").fill("0.2");
  expect(new URL((await normal).url()).searchParams.has("questline")).toBe(
    false,
  );
});

test("ordinary visits do not enroll in Questline", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Swap tokens with Jupiter" }),
  ).toBeAttached();
  await expect(
    page.getByRole("complementary", { name: "MagicBlock daily quest" }),
  ).toBeHidden();
});
