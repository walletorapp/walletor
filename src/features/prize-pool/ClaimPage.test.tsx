import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClaimRewardsState,
  WalletEngineState,
} from "../../../shared/accounting-contracts";
import {
  SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  type UsdcClaimEntitlement,
  type UsdcClaimState,
} from "../../../shared/usdc-claim-contracts";
import { ClaimPage } from "./ClaimPage";

vi.mock("./usePrizePoolState", () => ({
  usePrizePoolState: () => ({
    data: {
      currentPrizePoolMicroUsd: "10000",
      activeRound: { roundId: "round" },
    },
    isError: false,
  }),
}));

const mocks = vi.hoisted(() => {
  const claims: {
    data: ClaimRewardsState | undefined;
    dataUpdatedAt: number;
    isLoading: boolean;
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
  } = {
    data: undefined,
    dataUpdatedAt: Date.parse("2026-08-16T12:00:00.000Z"),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  const engine: {
    data: WalletEngineState | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
  } = {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  const solanaClaims: {
    data: UsdcClaimState | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
  } = {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  return {
    wallet: {
      connected: true,
      address: "So11111111111111111111111111111111111111112",
      sendTransaction: vi.fn(),
    },
    claims,
    engine,
    solanaClaims,
    claimsHook: vi.fn(),
    engineHook: vi.fn(),
    solanaClaimsHook: vi.fn(),
    buildSolanaClaim: vi.fn(),
    submitSolanaClaim: vi.fn(),
  };
});

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection: {} }),
  useWallet: () => ({
    connected: mocks.wallet.connected,
    publicKey: { toBase58: () => mocks.wallet.address },
    sendTransaction: mocks.wallet.sendTransaction,
  }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  WalletMultiButton: () => <button type="button">Connect wallet</button>,
  useWalletModal: () => ({ setVisible: vi.fn() }),
}));
vi.mock("./useClaimRewardsState", () => ({
  useClaimRewardsState: (address: string | null) => {
    mocks.claimsHook(address);
    return mocks.claims;
  },
}));
vi.mock("../rewards/useWalletEngineState", () => ({
  useWalletEngineState: (address: string | null) => {
    mocks.engineHook(address);
    return mocks.engine;
  },
}));
vi.mock("./useSolanaClaimState", () => ({
  useSolanaClaimState: (address: string | null) => {
    mocks.solanaClaimsHook(address);
    return mocks.solanaClaims;
  },
}));
vi.mock("../../lib/solana-claims", () => ({
  buildSolanaClaim: mocks.buildSolanaClaim,
  submitSolanaClaim: mocks.submitSolanaClaim,
}));

const round = {
  roundId: "solana:mainnet:prize-pool:2026-08-16",
  status: "OPEN" as const,
  startTime: "2026-08-16T00:00:00.000Z",
  endTime: "2026-08-17T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ClaimPage />
    </MemoryRouter>,
  );
}

function claimData(): ClaimRewardsState {
  if (!mocks.claims.data) throw new Error("Claim fixture was not initialized");
  return mocks.claims.data;
}

function engineData(): WalletEngineState {
  if (!mocks.engine.data) throw new Error("WLT fixture was not initialized");
  return mocks.engine.data;
}

function mockPreparedTransaction(blockhash: string): VersionedTransaction {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(mocks.wallet.address),
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message(),
  );
  vi.spyOn(VersionedTransaction, "deserialize").mockReturnValue(transaction);
  return transaction;
}

function usdcEntitlement(): UsdcClaimEntitlement {
  return {
    entitlementId:
      "solana:mainnet:prize-pool:2026-08-15:So11111111111111111111111111111111111111112",
    roundId: "solana:mainnet:prize-pool:2026-08-15",
    winnerAddress: mocks.wallet.address,
    rank: 1,
    provider: "SOLANA_FOUNDATION_REWARDS",
    distributionAddress: "5ZgHPb447UcXavVTorgYBr8egi3sw7dXKpX4Frec9rYS",
    distributionVaultAddress: "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh",
    claimAccountAddress: "D5ZxUNUZvn5vJn4ivFRNTzMTwYbgCYYEE1Arzesde5ra",
    mintAddress: SOLANA_MAINNET_USDC_MINT,
    mintSymbol: "USDC",
    mintDecimals: 6,
    grossAmountAtomic: "100000000",
    claimFeeAmountAtomic: "2500000",
    netAmountAtomic: "97500000",
    claimedAmountAtomic: "0",
    remainingAmountAtomic: "97500000",
    claimFeeBps: 250,
    claimDeadline: "2026-09-16T00:00:00.000Z",
    status: "CLAIMABLE",
    transactionSignature: null,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  vi.clearAllMocks();
  mocks.wallet.sendTransaction.mockReset();
  mocks.buildSolanaClaim.mockReset();
  mocks.submitSolanaClaim.mockReset();
  mocks.wallet.connected = true;
  mocks.wallet.address = "So11111111111111111111111111111111111111112";
  mocks.claims.isError = false;
  mocks.claims.isLoading = false;
  mocks.engine.isError = false;
  mocks.engine.isLoading = false;
  mocks.solanaClaims.isError = false;
  mocks.solanaClaims.isLoading = false;
  mocks.solanaClaims.data = {
    availability: "DISABLED",
    network: "MAINNET",
    walletAddress: mocks.wallet.address,
    programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
    settlementAsset: {
      mintAddress: SOLANA_MAINNET_USDC_MINT,
      symbol: "USDC",
      decimals: 6,
    },
    claimFeeBps: 250,
    entitlements: [],
    serverTime: "2026-08-16T12:00:00.000Z",
  };
  mocks.claims.data = {
    walletAddress: mocks.wallet.address,
    claimSystemStatus: "UNAVAILABLE_BETA",
    activeRound: round,
    claimableRewardsCents: "0",
    pendingRewardsCents: "1250",
    lifetimePaidCents: "500",
    allocations: [
      {
        allocationId: "allocation-1",
        roundId: "solana:mainnet:prize-pool:2026-08-15",
        roundEndTime: "2026-08-16T00:00:00.000Z",
        rewardCents: "1250",
        status: "CLAIM_UNAVAILABLE_BETA",
        payoutTransactionHash: null,
        createdAt: "2026-08-16T00:00:01.000Z",
      },
    ],
    feePolicy: {
      networkFeePayer: "CLAIMANT",
      networkFeeAsset: "SOL",
      estimatedNetworkFeeLamports: null,
      withdrawalFeeBps: 250,
      explanation:
        "The claiming wallet pays the Solana network fee shown before signing.",
    },
    serverTime: "2026-08-16T12:00:00.000Z",
  };
  mocks.engine.data = {
    walletAddress: mocks.wallet.address,
    accountingStatus: "LIVE",
    pointsLabel: "WLT Points",
    futureAllocationLabel: "Future WLT Airdrop Allocation",
    pointsPerEligibleSwap: "2",
    eligibilityPolicy: {
      everyConfirmedFeeBearingSwapCounts: false,
      minimumEligibleSwapUsd: "5.00",
      transactionSignatureCreditedOnce: true,
    },
    activeRound: round,
    currentRound: {
      actualSwaps: 5,
      eligibleSwaps: 5,
      eligibleVolumeCents: "25000",
      active: true,
      multiplierBps: 12500,
      achievedTier: 5,
      nextTier: 10,
      swapsUntilNextTier: 5,
    },
    currentDay: {
      actualSwaps: 5,
      eligibleSwaps: 5,
      eligibleVolumeCents: "25000",
      active: true,
      multiplierBps: 12500,
      achievedTier: 5,
      nextTier: 10,
      swapsUntilNextTier: 5,
    },
    lifetimeWltPoints: "25",
    pendingWltPoints: "25",
    convertedWltPoints: "0",
    serverTime: "2026-08-16T12:00:00.000Z",
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ClaimPage", () => {
  it("centers the requested reward totals in rounds, winnings, then WLT order", () => {
    renderPage();
    const totals = screen.getByRole("region", { name: "Wallet reward totals" });
    const totalRounds = screen.getByRole("region", { name: "Total rounds" });
    const totalWon = screen.getByRole("region", { name: "Total won" });
    const points = screen.getByRole("region", { name: "WLT points earned" });

    expect(within(totalRounds).getByText("1")).toBeVisible();
    expect(within(totalWon).getByText("$0.00")).toBeVisible();
    expect(within(points).getByText("25")).toBeVisible();
    expect(Array.from(totals.children)).toEqual([
      totalRounds,
      totalWon,
      points,
    ]);
  });

  it("keeps unfinalized withdrawals disabled after the round ends", () => {
    mocks.claims.data = { ...claimData(), serverTime: round.endTime };
    renderPage();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Result not finalized" }),
    ).toBeDisabled();
  });

  it("does not present a legacy ledger estimate as a winning", () => {
    renderPage();
    expect(
      screen.getByRole("heading", {
        name: "Your rewards, verified.",
        level: 1,
      }),
    ).toBeInTheDocument();
    const winnings = within(screen.getByRole("region", { name: "Total won" }));
    const claimStatus = within(
      screen.getByRole("region", { name: "Claim status" }),
    );
    expect(winnings.getByText("$0.00")).toBeInTheDocument();
    expect(winnings.getByText("Verified winnings · USDC")).toBeInTheDocument();
    expect(
      claimStatus.getByText("No verified winning yet"),
    ).toBeInTheDocument();
    expect(
      claimStatus.getByText(/legacy ledger estimate exists/),
    ).toHaveTextContent(
      "$12.50 legacy ledger estimate exists, but it is not a finalized winner claim.",
    );
    expect(
      screen.getByRole("button", { name: "Result not finalized" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Legacy ledger estimates are not claimable winnings/),
    ).toBeInTheDocument();
    const points = within(
      screen.getByRole("region", { name: "WLT points earned" }),
    );
    const pointActivity = within(
      screen.getByRole("region", { name: "WLT activity" }),
    );
    expect(points.getByText("25")).toBeInTheDocument();
    expect(
      pointActivity.getByText(
        "2 WLT points per Jupiter-confirmed Walletor swap valued at $5.00 or more.",
      ),
    ).toBeInTheDocument();
    expect(
      pointActivity.getByText(
        "WLT points are off-chain rewards, not withdrawable tokens.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps historical points when the earning rate changes from five to two", () => {
    mocks.engine.data = { ...engineData(), pointsPerEligibleSwap: "5" };
    const { rerender } = renderPage();
    const points = within(
      screen.getByRole("region", { name: "WLT points earned" }),
    );
    const pointActivity = within(
      screen.getByRole("region", { name: "WLT activity" }),
    );
    expect(points.getByText("25")).toBeInTheDocument();

    mocks.engine.data = { ...engineData(), pointsPerEligibleSwap: "2" };
    rerender(
      <MemoryRouter>
        <ClaimPage />
      </MemoryRouter>,
    );
    expect(points.getByText("25")).toBeInTheDocument();
    expect(
      pointActivity.getByText(
        "2 WLT points per Jupiter-confirmed Walletor swap valued at $5.00 or more.",
      ),
    ).toBeInTheDocument();
  });

  it("offers swapping when there are no winnings, without hiding earned points", () => {
    mocks.claims.data = {
      ...claimData(),
      pendingRewardsCents: "0",
      claimableRewardsCents: "0",
      allocations: [],
    };
    renderPage();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("No winnings to withdraw yet")).toBeInTheDocument();
    expect(
      screen.getByText("Start swapping for a chance to win next time."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start swapping" }),
    ).toHaveAttribute("href", "/swap");
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Withdraw Winnings" }),
    ).not.toBeInTheDocument();
  });

  it("requires a connected wallet instead of showing cached balances", () => {
    mocks.wallet.connected = false;
    renderPage();
    expect(
      screen.getByRole("button", { name: "Connect wallet" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("$12.50")).not.toBeInTheDocument();
    expect(screen.queryByText("25")).not.toBeInTheDocument();
    expect(mocks.claimsHook).toHaveBeenCalledWith(null);
    expect(mocks.engineHook).toHaveBeenCalledWith(null);
  });

  it("shows loading states, never zero balances or a no-win message while fetching", () => {
    mocks.claims.data = undefined;
    mocks.engine.data = undefined;
    mocks.claims.isLoading = true;
    mocks.engine.isLoading = true;
    renderPage();
    expect(
      screen.getByText("Checking your reward history…"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading your WLT points…")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No winnings to withdraw yet"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Checking winnings…" }),
    ).toBeDisabled();
  });

  it("hides stale winnings on a ledger error while independently showing WLT", async () => {
    mocks.claims.isError = true;
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t load your historical reward records",
    );
    expect(screen.queryByText("$12.50")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No winnings to withdraw yet"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry reward history" }),
    );
    expect(mocks.claims.refetch).toHaveBeenCalledOnce();
  });

  it("shows an independent retry when the WLT ledger is unavailable", async () => {
    mocks.engine.isError = true;
    renderPage();
    expect(screen.queryByText("25")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t load your WLT points",
    );
    expect(screen.getByText("No verified winning yet")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry WLT points" }),
    );
    expect(mocks.engine.refetch).toHaveBeenCalledOnce();
  });

  it("keeps history collapsed and reveals dated allocations on demand", async () => {
    renderPage();
    expect(screen.getByText("16.08.2026")).not.toBeVisible();
    await userEvent.click(screen.getByText("Reward history"));
    expect(screen.getByText("16.08.2026")).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("Legacy estimate · not a win")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View all Prize Pool distributions" }),
    ).toHaveAttribute("href", "/revenue-pool");
  });

  it("links only recorded paid payouts to Solscan", async () => {
    const signature = "1".repeat(64);
    const allocation = claimData().allocations[0];
    if (!allocation) throw new Error("Allocation fixture was not initialized");
    mocks.claims.data = {
      ...claimData(),
      allocations: [
        {
          ...allocation,
          status: "PAID",
          payoutTransactionHash: signature,
        },
      ],
    };
    renderPage();
    await userEvent.click(screen.getByText("Reward history"));
    expect(
      screen.getByRole("link", {
        name: /View payout for 16.08.2026 on Solscan/,
      }),
    ).toHaveAttribute("href", `https://solscan.io/tx/${signature}`);
  });

  it("never promotes legacy claim totals into the verified winnings balance", () => {
    mocks.claims.data = {
      ...claimData(),
      claimableRewardsCents: "1",
      pendingRewardsCents: "2",
    };
    renderPage();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/legacy ledger estimate exists/)).toHaveTextContent(
      "$0.03 legacy ledger estimate exists, but it is not a finalized winner claim.",
    );
    expect(
      screen.getByRole("button", { name: "Result not finalized" }),
    ).toBeDisabled();
  });

  it("shows a clearly labelled live mainnet USDC claim", () => {
    const entitlement = usdcEntitlement();
    mocks.claims.isError = true;
    mocks.solanaClaims.data = {
      availability: "MAINNET_LIVE",
      network: "MAINNET",
      walletAddress: mocks.wallet.address,
      programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
      settlementAsset: {
        mintAddress: SOLANA_MAINNET_USDC_MINT,
        symbol: "USDC",
        decimals: 6,
      },
      claimFeeBps: 250,
      entitlements: [entitlement],
      serverTime: "2026-08-16T12:00:00.000Z",
    };
    renderPage();
    expect(screen.getByText("Mainnet · USDC")).toBeInTheDocument();
    expect(screen.getByText("97.5 USDC")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Claim 97.5 USDC" }),
    ).toBeEnabled();
    expect(screen.getByText(/after Walletor's 2.50% claim fee/)).toBeVisible();
  });

  it("keeps a claimed prize visible as a verified winning", () => {
    const entitlement = usdcEntitlement();
    mocks.solanaClaims.data = {
      availability: "MAINNET_LIVE",
      network: "MAINNET",
      walletAddress: mocks.wallet.address,
      programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
      settlementAsset: {
        mintAddress: SOLANA_MAINNET_USDC_MINT,
        symbol: "USDC",
        decimals: 6,
      },
      claimFeeBps: 250,
      entitlements: [
        {
          ...entitlement,
          claimedAmountAtomic: entitlement.netAmountAtomic,
          remainingAmountAtomic: "0",
          status: "CLAIMED",
        },
      ],
      serverTime: "2026-08-16T12:00:00.000Z",
    };
    renderPage();
    expect(screen.getByText("97.5 USDC")).toBeInTheDocument();
    expect(screen.getByText("Won · Claimed in USDC")).toBeInTheDocument();
    expect(screen.getByText("Prize claimed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claimed" })).toBeDisabled();
    expect(
      screen.queryByText("No winnings to withdraw yet"),
    ).not.toBeInTheDocument();
  });

  it.each([false, true])(
    "opens a confirmed share popup after confirmation (temporary failure: %s)",
    async (temporaryFailure) => {
      const entitlement = usdcEntitlement();
      mocks.solanaClaims.data = {
        availability: "MAINNET_LIVE",
        network: "MAINNET",
        walletAddress: mocks.wallet.address,
        programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
        settlementAsset: {
          mintAddress: SOLANA_MAINNET_USDC_MINT,
          symbol: "USDC",
          decimals: 6,
        },
        claimFeeBps: 250,
        entitlements: [entitlement],
        serverTime: "2026-08-16T12:00:00.000Z",
      };
      const blockhash = new PublicKey(
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      ).toBase58();
      mockPreparedTransaction(blockhash);
      const signature = "1".repeat(64);
      mocks.buildSolanaClaim.mockResolvedValue({
        network: "MAINNET",
        transaction: "AQID",
        blockhash,
        lastValidBlockHeight: "1234",
        entitlement,
      });
      mocks.wallet.sendTransaction.mockResolvedValue(signature);
      mocks.submitSolanaClaim.mockResolvedValue({
        network: "MAINNET",
        transactionSignature: signature,
        status: "CONFIRMED",
      });
      if (temporaryFailure)
        mocks.submitSolanaClaim.mockRejectedValueOnce(
          new Error("RPC temporarily unavailable"),
        );

      renderPage();
      await userEvent.click(
        screen.getByRole("button", { name: "Claim 97.5 USDC" }),
      );

      const dialog = await screen.findByRole(
        "dialog",
        {
          name: "Your earnings are in",
        },
        { timeout: 4000 },
      );
      expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText("RPC temporarily unavailable"),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByText("$97.5 USDC")).toBeVisible();
      expect(within(dialog).getByText(/sent directly/)).toBeVisible();
      expect(within(dialog).getByText("25 WLT points")).toBeVisible();
      const expectedMessage =
        "I just claimed 97.5 USDC on Walletor and have earned 25 WLT points!";
      const twitter = within(dialog).getByRole("link", {
        name: "Share on Twitter",
      });
      const telegram = within(dialog).getByRole("link", {
        name: "Share on Telegram",
      });
      const whatsapp = within(dialog).getByRole("link", {
        name: "Share on WhatsApp",
      });
      expect(
        new URL(twitter.getAttribute("href") ?? "").searchParams.get("text"),
      ).toBe(expectedMessage);
      expect(
        new URL(telegram.getAttribute("href") ?? "").searchParams.get("text"),
      ).toBe(expectedMessage);
      expect(
        new URL(whatsapp.getAttribute("href") ?? "").searchParams.get("text"),
      ).toBe(`${expectedMessage}\n\nhttps://walletor.com`);
      expect(
        within(dialog).getByRole("link", {
          name: "View confirmed transaction on Solscan",
        }),
      ).toHaveAttribute("href", `https://solscan.io/tx/${signature}`);

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("shows submitted claims without presenting them as confirmed", async () => {
    const entitlement = usdcEntitlement();
    mocks.solanaClaims.data = {
      availability: "MAINNET_LIVE",
      network: "MAINNET",
      walletAddress: mocks.wallet.address,
      programId: SOLANA_FOUNDATION_REWARDS_PROGRAM_ID,
      settlementAsset: {
        mintAddress: SOLANA_MAINNET_USDC_MINT,
        symbol: "USDC",
        decimals: 6,
      },
      claimFeeBps: 250,
      entitlements: [entitlement],
      serverTime: "2026-08-16T12:00:00.000Z",
    };
    const blockhash = new PublicKey(
      Uint8Array.from({ length: 32 }, (_, index) => 32 - index),
    ).toBase58();
    mockPreparedTransaction(blockhash);
    const signature = "2".repeat(64);
    mocks.buildSolanaClaim.mockResolvedValue({
      network: "MAINNET",
      transaction: "AQID",
      blockhash,
      lastValidBlockHeight: "1234",
      entitlement,
    });
    mocks.wallet.sendTransaction.mockResolvedValue(signature);
    mocks.submitSolanaClaim.mockResolvedValue({
      network: "MAINNET",
      transactionSignature: signature,
      status: "SUBMITTED",
    });

    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Claim 97.5 USDC" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Your claim is on the way",
    });
    expect(within(dialog).getByText("Claim submitted")).toBeVisible();
    expect(
      within(dialog).queryByRole("link", { name: "Share on Twitter" }),
    ).not.toBeInTheDocument();
  });

  it("formats WLT points exactly without floating point rounding or adding pending points twice", () => {
    mocks.engine.data = {
      ...engineData(),
      lifetimeWltPoints: "9007199254740993",
      pendingWltPoints: "10",
    };
    renderPage();
    expect(screen.getByText("9,007,199,254,740,993")).toBeInTheDocument();
  });

  it.each(["PAUSED", "DISABLED", "SYNCING"] as const)(
    "keeps recorded points visible with honest %s status",
    (accountingStatus) => {
      mocks.engine.data = { ...engineData(), accountingStatus };
      renderPage();
      expect(screen.getByText("25")).toBeInTheDocument();
      expect(
        screen.queryByText("2 WLT points per confirmed, eligible swap."),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          accountingStatus === "SYNCING"
            ? "Your points are syncing with verified swap activity."
            : "Points updates are currently paused. Your earned total is shown above.",
        ),
      ).toBeInTheDocument();
    },
  );

  it("does not leak a prior wallet's balances while a new wallet loads", () => {
    const { rerender } = renderPage();
    mocks.wallet.address = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    rerender(
      <MemoryRouter>
        <ClaimPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("$12.50")).not.toBeInTheDocument();
    expect(screen.queryByText("25")).not.toBeInTheDocument();
    expect(screen.queryByText("Reward history")).not.toBeInTheDocument();
  });

  it("updates the visible lifetime balance when verified engine data refreshes", () => {
    const { rerender } = renderPage();
    mocks.engine.data = { ...engineData(), lifetimeWltPoints: "30" };
    rerender(
      <MemoryRouter>
        <ClaimPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.queryByText("25")).not.toBeInTheDocument();
  });
});
