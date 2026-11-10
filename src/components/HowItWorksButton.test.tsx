import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HowItWorksButton } from "./HowItWorksButton";

const feeState = vi.hoisted(() => ({
  isError: false,
  poolBps: 10000,
  reserveBps: 0,
}));
vi.mock("../features/prize-pool/usePrizePoolState", () => ({
  usePrizePoolState: () => ({
    isError: feeState.isError,
    data: {
      transparency: {
        referralFeeBps: 50,
        walletorPartnerShareBps: 8000,
        prizePoolShareBps: feeState.poolBps,
        feeReserveBps: feeState.reserveBps,
        rewardEligibility: {
          everyConfirmedFeeBearingSwapCounts: false,
          minimumEligibleSwapUsd: "5.00",
          repeatedTradeParametersAllowed: true,
          transactionSignatureCreditedOnce: true,
          weightingFormula: "CONFIRMED_SWAPS_X_TIER_X_LOG2_VOLUME_SCORE",
          tiers: [],
        },
      },
    },
  }),
}));

describe("HowItWorksButton", () => {
  beforeEach(() => {
    feeState.isError = false;
    feeState.poolBps = 10000;
    feeState.reserveBps = 0;
  });

  it("opens an accessible explanation of the verified Walletor flow", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <HowItWorksButton />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "How it works" }));

    expect(
      screen.getByRole("dialog", { name: "How Walletor works" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    for (const title of [
      "Swap tokens",
      "Fees fund the prizes",
      "Winners every 24 hours",
      "Claim your USDC",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(
      screen.getByText(/100% of Walletor’s confirmed fees/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not available in the USA/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Claim Rewards/i }),
    ).toHaveAttribute("href", "/claim-rewards");

    await user.click(
      screen.getByRole("button", { name: "Close How it works" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "How Walletor works" }),
    ).not.toBeInTheDocument();
  });

  it("combines the pool and manual influencer reserve without claiming all fees enter the pool", async () => {
    feeState.poolBps = 8900;
    feeState.reserveBps = 1100;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <HowItWorksButton />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "How it works" }));
    expect(
      screen.getByText(/100% of Walletor’s confirmed fees/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/held in reserve for manual payment/),
    ).toBeInTheDocument();
  });

  it("does not advertise a cached fee when its source is unavailable", async () => {
    feeState.isError = true;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <HowItWorksButton />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "How it works" }));
    expect(
      screen.getByText(/Walletor fees fund the Prize Pool/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });
});
