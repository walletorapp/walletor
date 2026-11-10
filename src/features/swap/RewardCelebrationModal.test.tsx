import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { VerifiedSwapCreditResult } from "../../../shared/accounting-contracts";
import { shouldCelebrateReward } from "./reward-celebration";
import { RewardCelebrationModal } from "./RewardCelebrationModal";

const receipt: VerifiedSwapCreditResult = {
  duplicate: false,
  swapId: "swap-welcome",
  roundId: "2026-08-27T00:00:00.000Z",
  rewardEligible: true,
  eligibilityReason: "ELIGIBLE",
  prizePoolContributionMicroUsd: "50000",
  prizePoolContributionCents: "5",
  platformRevenueCents: "0",
  wltPointsCredited: "2",
  resultingLifetimeWltPoints: "14",
  resultingPrizePoolMicroUsd: "50000",
  resultingPrizePoolCents: "5",
};

describe("RewardCelebrationModal", () => {
  it("opens only for a newly verified, eligible WLT credit", () => {
    expect(shouldCelebrateReward(receipt)).toBe(true);
    expect(shouldCelebrateReward({ ...receipt, duplicate: true })).toBe(false);
    expect(
      shouldCelebrateReward({
        ...receipt,
        rewardEligible: false,
        wltPointsCredited: "0",
      }),
    ).toBe(false);
    expect(shouldCelebrateReward(null)).toBe(false);
  });

  it("celebrates only verified rewards with clear WLT and Prize Pool status", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <RewardCelebrationModal
          receipt={receipt}
          signature="5HueCGU8rMjxEXxiPuD5BDuRa8xYkFg8KQZ3HdEpcM3auCjQQJQHP7Q9P2Q8BM3m55DQ2yALdZuCqz4Cn9P2Q8BM"
          onClose={onClose}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("dialog", { name: "CONGRATS!" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You gained 2 WLT Airdrop Points, and your swap now counts toward the current Prize Pool round.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("+2 WLT")).toBeInTheDocument();
    expect(screen.getByText("Airdrop Points earned")).toBeInTheDocument();
    expect(screen.getByText("Current Prize Pool activity")).toBeInTheDocument();
    expect(screen.getByText("14 WLT")).toBeInTheDocument();
    expect(screen.getByText("Lifetime WLT points earned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View rewards" })).toHaveAttribute(
      "href",
      "/rewards",
    );
    expect(
      screen.getByRole("link", { name: /View confirmed transaction/ }),
    ).toHaveAttribute("href", expect.stringContaining("solscan.io/tx/"));
    expect(
      screen.getByRole("link", { name: "Follow Walletor on X" }),
    ).toHaveAttribute("href", "https://x.com/walletorai");
    expect(
      screen.getByRole("link", { name: "Join Walletor on Telegram" }),
    ).toHaveAttribute("href", "https://t.me/walletorswap");

    await user.click(screen.getByRole("button", { name: "Keep swapping" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
