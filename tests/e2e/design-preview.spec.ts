import { expect, test } from "@playwright/test";

test("isolated Walletor design preview is static and responsive", async ({
  page,
}) => {
  const requestedApiPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) requestedApiPaths.push(url.pathname);
  });

  await page.goto("/design-preview");

  await expect(
    page.getByRole("heading", { name: "Swap and rewards dashboard" }),
  ).toBeVisible();
  await expect(page.getByText("Static · no transactions")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Swap preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Win from the pool" }),
  ).toBeVisible();
  await expect(page.getByText("$0.11", { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Phantom · Ho3t/ }),
  ).toBeVisible();

  const liquidOrb = page.getByTestId("liquid-orb-motion");
  const firstOrbTransform = await liquidOrb.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await page.waitForTimeout(220);
  const nextOrbTransform = await liquidOrb.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(nextOrbTransform).not.toBe(firstOrbTransform);

  const amount = page.getByRole("textbox", { name: "Mock sell amount" });
  await amount.fill("0.25");
  await expect(
    page.getByRole("button", { name: "Swap preview" }),
  ).toBeVisible();
  expect(requestedApiPaths).toEqual([]);

  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(
    overflow.viewportWidth + 1,
  );
});
