import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { WalletEngineState } from "../../../shared/accounting-contracts";
import { WalletorEnginePanel } from "./WalletorEnginePanel";

const mocks = vi.hoisted(() => {
  const address = "So11111111111111111111111111111111111111112";
  const data: WalletEngineState = {
    accountingStatus: "LIVE",
    walletAddress: address,
    pointsLabel: "WLT Points",
    futureAllocationLabel: "Future WLT Airdrop Allocation",
    pointsPerEligibleSwap: "2",
    eligibilityPolicy: {
      everyConfirmedFeeBearingSwapCounts: false,
      minimumEligibleSwapUsd: "5.00",
      transactionSignatureCreditedOnce: true,
    },
    activeRound: {
      roundId: "solana:mainnet:prize-pool:2026-09-03",
      status: "OPEN",
      startTime: "2026-09-03T00:00:00.000Z",
      endTime: "2026-09-04T00:00:00.000Z",
    },
    currentRound: {
      actualSwaps: 6,
      eligibleSwaps: 6,
      eligibleVolumeCents: "6000",
      active: true,
      multiplierBps: 12_500,
      achievedTier: 5,
      nextTier: 10,
      swapsUntilNextTier: 4,
    },
    currentDay: {
      actualSwaps: 6,
      eligibleSwaps: 6,
      eligibleVolumeCents: "6000",
      active: true,
      multiplierBps: 12_500,
      achievedTier: 5,
      nextTier: 10,
      swapsUntilNextTier: 4,
    },
    lifetimeWltPoints: "30000",
    pendingWltPoints: "30000",
    convertedWltPoints: "0",
    serverTime: "2026-09-03T12:00:00.000Z",
  };

  return { address, data };
});

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: true,
    publicKey: { toBase58: () => mocks.address },
  }),
}));

vi.mock("../rewards/useWalletEngineState", () => ({
  useWalletEngineState: () => ({
    data: mocks.data,
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("./PoolFomoStrip", () => ({
  PoolFomoStrip: () => <div>Prize pool summary</div>,
}));

describe("WalletorEnginePanel", () => {
  it("shows separate round and lifetime WLT point totals", () => {
    render(
      <MemoryRouter>
        <WalletorEnginePanel variant="page" />
      </MemoryRouter>,
    );

    const today = screen.getByLabelText("WLT points earned this round");
    expect(within(today).getByText("WLT points this round")).toBeVisible();
    expect(today).toHaveTextContent("12 WLT");

    const eligibleVolume = screen.getByLabelText(
      "Eligible trading volume this round",
    );
    expect(eligibleVolume).toHaveTextContent("$60.00");

    const lifetime = screen.getByLabelText("Lifetime WLT points earned");
    expect(within(lifetime).getByText("Lifetime WLT points")).toBeVisible();
    expect(lifetime).toHaveTextContent("30,000 WLT");
    expect(today).toContainElement(lifetime);
    expect(screen.getByText("Tier 3")).toBeVisible();
    expect(screen.queryByText("Tier 5")).not.toBeInTheDocument();
    const dailyRewards = screen.getByText("Round rewards");
    const prizePoolSummary = screen.getByText("Prize pool summary");
    expect(prizePoolSummary).toBeVisible();
    expect(
      dailyRewards.compareDocumentPosition(prizePoolSummary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
