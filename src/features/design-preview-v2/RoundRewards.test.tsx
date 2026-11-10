import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { PrizeReactor } from "./PrizeReactor";
import { WalletorEnginePanel } from "./WalletorEnginePanel";
import { WalletorAirdropPage } from "./WalletorAirdropPage";

vi.mock("./ConceptPageShell", () => ({
  ConceptPageShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../referrals/SocialRewardsPanel", () => ({
  SocialRewardsPanel: () => null,
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: true,
    publicKey: { toBase58: () => "wallet" },
  }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  useWalletModal: () => ({ setVisible: vi.fn() }),
}));
vi.mock("../../components/HowItWorksButton", () => ({
  HowItWorksButton: () => null,
}));
vi.mock("./PoolFomoStrip", () => ({ PoolFomoStrip: () => null }));
vi.mock("../prize-pool/usePrizePoolState", () => ({
  usePrizePoolState: () => ({ data: undefined, dataUpdatedAt: 0 }),
}));
vi.mock("../prize-pool/useSolanaClaimState", () => ({
  useSolanaClaimState: () => ({ data: undefined }),
}));
// Reproduces a 24-hour round spanning UTC midnight: the round has one
// credited swap while the old calendar-day response reports no activity.
vi.mock("../rewards/useWalletEngineState", () => ({
  useWalletEngineState: () => ({
    data: {
      activeRound: {
        startTime: "2026-09-28T10:52:35.000Z",
        endTime: "2026-09-29T10:52:35.000Z",
      },
      serverTime: "2026-09-29T09:20:00.000Z",
      pointsPerEligibleSwap: "2",
      lifetimeWltPoints: "68",
      currentRound: {
        eligibleSwaps: 1,
        eligibleVolumeCents: "6250",
        active: true,
        achievedTier: 1,
        nextTier: 3,
        swapsUntilNextTier: 2,
      },
      currentDay: {
        eligibleSwaps: 0,
        eligibleVolumeCents: "0",
        active: false,
        achievedTier: 0,
        nextTier: 1,
        swapsUntilNextTier: 1,
      },
    },
    isLoading: false,
    isError: false,
    dataUpdatedAt: Date.parse("2026-09-29T09:20:00.000Z"),
  }),
}));

describe("rewards in a round spanning midnight", () => {
  it("uses round qualification and the actual deadline on the airdrop page", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:20:00.000Z"));
    try {
      render(
        <MemoryRouter>
          <WalletorAirdropPage />
        </MemoryRouter>,
      );
      expect(screen.getByText("Verified for this round")).toBeInTheDocument();
      expect(screen.getByRole("timer")).toHaveTextContent("01:32:35");
      expect(
        screen.getByText("Your points this round").parentElement,
      ).toHaveTextContent("2");
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows two points for the same confirmed swap as the entry card", () => {
    render(
      <MemoryRouter>
        <PrizeReactor />
      </MemoryRouter>,
    );
    expect(screen.getByText("You earned (+2 WLT)")).toBeInTheDocument();
    expect(screen.queryByText("You earned (+0 WLT)")).not.toBeInTheDocument();
  });

  it("keeps the level, points, and volume in the active round", () => {
    render(
      <MemoryRouter>
        <WalletorEnginePanel />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Level 1 — Starter/)).toBeInTheDocument();
    expect(screen.getByText("$62.50")).toBeInTheDocument();
    const points = screen.getByLabelText("WLT points earned this round");
    expect(points.querySelector("strong")).toHaveTextContent("2 WLT");
    expect(
      within(points).getByLabelText("Lifetime WLT points earned"),
    ).toHaveTextContent("68 WLT");
    expect(screen.queryByText("Resets at 00:00 UTC")).not.toBeInTheDocument();
  });
});
