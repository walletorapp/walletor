import { expect, test } from "@playwright/test";

test("Rewards progress aligns with the reward ladder and renders its 3D beacon", async ({
  page,
}) => {
  await page.goto("/rewards");

  const progressPanel = page.locator(
    ".concept-engine--page .concept-engine-level",
  );
  const rewardLadder = page.locator(
    ".concept-engine--page .concept-engine-ladder",
  );
  const beacon = page.locator(
    ".concept-engine--page .concept-engine-progress__beacon",
  );

  await expect(progressPanel).toBeVisible();
  await expect(rewardLadder).toBeVisible();
  await expect(beacon).toBeVisible();

  const [progressBounds, ladderBounds] = await Promise.all([
    progressPanel.boundingBox(),
    rewardLadder.boundingBox(),
  ]);

  expect(progressBounds).not.toBeNull();
  expect(ladderBounds).not.toBeNull();
  if (progressBounds && ladderBounds) {
    expect(Math.abs(progressBounds.x - ladderBounds.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(progressBounds.width - ladderBounds.width),
    ).toBeLessThanOrEqual(1);
  }

  const beaconStyle = await beacon.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: Number.parseFloat(style.height),
      transform: style.transform,
      width: Number.parseFloat(style.width),
    };
  });
  expect(beaconStyle.width).toBeGreaterThanOrEqual(20);
  expect(beaconStyle.height).toBeGreaterThanOrEqual(20);
  expect(beaconStyle.transform).not.toBe("none");
});
