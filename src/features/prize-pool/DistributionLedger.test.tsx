import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PrizePoolState,
  PublicDistributionCalendar,
  PublicDistributionRoundDetail,
  PublicRound,
} from "../../../shared/accounting-contracts";
import { DistributionLedger } from "./DistributionLedger";

const walletAddress = "So11111111111111111111111111111111111111112";
const transactionHash = "1".repeat(64);
const round: PublicRound = {
  roundId: "solana:mainnet:prize-pool:2026-08-15",
  status: "COMPLETED",
  startTime: "2026-08-15T00:00:00.000Z",
  endTime: "2026-08-16T00:00:00.000Z",
  lockedAt: "2026-08-16T00:00:00.000Z",
  completedAt: "2026-08-16T00:01:00.000Z",
  totalPoolCents: "1000",
  totalEligibleSwaps: 3,
  totalEligibleVolumeCents: "2500",
  eligibleWalletCount: 1,
  allocationChecksum: "a".repeat(64),
  remainderCents: "0",
  failedPayoutCount: 0,
  payoutTransactionHashes: [transactionHash],
};
const transparency: PrizePoolState["transparency"] = {
  treasuryAddress: walletAddress,
  referralAccount: "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
  referralFeeBps: 50,
  walletorPartnerShareBps: 8000,
  prizePoolShareBps: 10_000,
  payoutExecutionStatus: "LOCKED_BETA",
  rewardEligibility: {
    everyConfirmedFeeBearingSwapCounts: false,
    minimumEligibleSwapUsd: "5.00",
    repeatedTradeParametersAllowed: true,
    transactionSignatureCreditedOnce: true,
    weightingFormula: "CONFIRMED_SWAPS_X_TIER_X_LOG2_VOLUME_SCORE",
    tiers: [
      { confirmedSwaps: 1, multiplierBps: 10_000 },
      { confirmedSwaps: 3, multiplierBps: 11_000 },
      { confirmedSwaps: 5, multiplierBps: 12_500 },
      { confirmedSwaps: 10, multiplierBps: 15_000 },
    ],
  },
};
const detail: PublicDistributionRoundDetail = {
  round,
  recipients: [
    {
      allocationId: "allocation-1",
      walletAddress,
      eligibleSwapCount: 3,
      multiplierBps: 11_000,
      rewardCents: "1000",
      status: "PAID",
      payoutTransactionHash: transactionHash,
      allocatedAt: "2026-08-16T00:01:00.000Z",
    },
  ],
  pagination: {
    offset: 0,
    limit: 50,
    totalRecipients: 1,
    nextOffset: null,
  },
  payoutExecutionStatus: "LOCKED_BETA",
  transparencyNote: "Public append-only evidence.",
  serverTime: "2026-08-16T12:00:00.000Z",
};
const calendar: PublicDistributionCalendar = {
  month: "2026-08",
  availableMonths: ["2026-08"],
  rounds: [round],
  serverTime: "2026-08-16T12:00:00.000Z",
};

function ledgerResponse(input: RequestInfo | URL): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const data = url.includes("/api/prize-pool/distributions?month=")
    ? calendar
    : detail;
  return Promise.resolve(
    Response.json({
      data,
      meta: {
        source: "walletor-ledger",
        fetchedAt: "2026-08-16T12:00:00.000Z",
        requestId: "test-request",
      },
    }),
  );
}

describe("DistributionLedger", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("links public recipient wallets and real payout signatures to Solscan", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(ledgerResponse));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <DistributionLedger rounds={[round]} transparency={transparency} />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByRole("link", { name: /View transaction/i }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", {
        name: "View 1 finalized distribution for 16.08.2026",
      }),
    );
    expect(
      await screen.findByRole("link", { name: /View transaction/i }),
    ).toHaveAttribute("href", `https://solscan.io/tx/${transactionHash}`);
    expect(
      screen.getByRole("link", { name: /So1111…111112/i }),
    ).toHaveAttribute("href", `https://solscan.io/account/${walletAddress}`);
    expect(
      screen.getByText("0.4% · 100% for active users & influencers"),
    ).toBeInTheDocument();
    expect(screen.getByText("0.5% total · 0.1% Jupiter")).toBeInTheDocument();
    expect(screen.getAllByText("$10.00")).toHaveLength(2);
    expect(screen.getByText("16.08.2026")).toBeInTheDocument();
  });

  it("filters the public ledger from a finalized calendar date", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(ledgerResponse));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <DistributionLedger rounds={[round]} transparency={transparency} />
      </QueryClientProvider>,
    );

    const date = await screen.findByRole("button", {
      name: "View 1 finalized distribution for 16.08.2026",
    });
    expect(screen.queryByText("Distribution date")).not.toBeInTheDocument();
    await user.click(date);

    expect(date).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Distribution date")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Show all dates in August 2026/i }),
    ).toBeInTheDocument();
  });
});
