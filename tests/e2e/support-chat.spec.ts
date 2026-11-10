import { expect, test } from "@playwright/test";

test("help opens without the native dialog API and can be reopened", async ({
  page,
  isMobile,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: () => {
        throw new Error("Native dialogs unavailable");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await page.goto("/");
  if (isMobile)
    await page.locator(".support-page-end").scrollIntoViewIfNeeded();
  const launcher = page.getByRole("button", { name: "Open Walletor AI help" });
  if (isMobile) {
    const bounds = await launcher.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await launcher.tap();
  } else await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Walletor AI Help" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close AI help" }),
  ).toBeFocused();
  await expect(page.locator("#root")).toHaveJSProperty("inert", true);
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByLabel("Your question")).toBeFocused();
  await dialog.getByLabel("Your question").fill("How do rewards work?");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#root")).toHaveJSProperty("inert", false);
  await expect(launcher).toBeFocused();
  if (isMobile) await launcher.tap();
  else await launcher.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Your question")).toHaveValue(
    "How do rewards work?",
  );
  await dialog.getByRole("button", { name: "Close AI help" }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("AI help shows the safety introduction, answers and email handoff", async ({
  page,
}) => {
  await page.route("**/api/support/chat", (route) =>
    route.fulfill({
      json: {
        answer:
          "Eligible swaps earn 2 WLT points. WLT points are not transferable tokens.",
      },
    }),
  );
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1280) <= 767) {
    await page.locator(".support-page-end").scrollIntoViewIfNeeded();
  }
  await page.getByRole("button", { name: "Open Walletor AI help" }).click();
  const dialog = page.getByRole("dialog", { name: "Walletor AI Help" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/Walletor support will never ask you to send money/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Email support" }),
  ).toHaveAttribute(
    "href",
    "mailto:support@walletor.com?subject=Walletor%20support",
  );
  await dialog
    .getByRole("button", { name: "How do I earn WLT points?" })
    .click();
  await expect(
    dialog.getByText(
      "Eligible swaps earn 2 WLT points. WLT points are not transferable tokens.",
    ),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await dialog.getByRole("button", { name: "Close AI help" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open Walletor AI help" }),
  ).toBeFocused();
});

test("AI outage keeps support available and preserves the question", async ({
  page,
}) => {
  await page.route("**/api/support/chat", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/claim-rewards");
  if ((page.viewportSize()?.width ?? 1280) <= 767) {
    await page.locator(".support-page-end").scrollIntoViewIfNeeded();
  }
  await page.getByRole("button", { name: "Open Walletor AI help" }).click();
  const dialog = page.getByRole("dialog", { name: "Walletor AI Help" });
  await dialog.getByLabel("Your question").fill("How do claims work?");
  await dialog.getByRole("button", { name: "Send question" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Please try again or email support",
  );
  await expect(dialog.getByLabel("Your question")).toHaveValue(
    "How do claims work?",
  );
  await expect(
    dialog.getByRole("link", { name: "Email support" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("mobile help only appears at the page end and hides again above it", async ({
  page,
}) => {
  await page.goto("/leaderboard");
  const launcher = page.getByRole("button", { name: "Open Walletor AI help" });
  const mobile = (page.viewportSize()?.width ?? 1280) <= 767;
  if (mobile) await expect(launcher).toBeHidden();
  else await expect(launcher).toBeVisible();
  await page.locator(".concept-social-footer").scrollIntoViewIfNeeded();
  if (mobile) await page.locator(".support-page-end").scrollIntoViewIfNeeded();
  await expect(launcher).toBeVisible();
  await page
    .getByRole("heading", { name: "Leaderboard & Winners" })
    .scrollIntoViewIfNeeded();
  if (mobile) await expect(launcher).toBeHidden();
  else await expect(launcher).toBeVisible();
});
