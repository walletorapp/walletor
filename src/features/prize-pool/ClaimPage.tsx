import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletConnectionButton } from "../swap/WalletConnectionButton";
import { VersionedTransaction } from "@solana/web3.js";
import {
  ArrowRight,
  ArrowUpRight,
  CircleCheckBig,
  ChevronDown,
  Clock3,
  Coins,
  LockKeyhole,
  MessageCircle,
  ReceiptText,
  Send,
  Share2,
  Trophy,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import type { ClaimAllocation } from "../../../shared/accounting-contracts";
import { buildSolanaClaim, submitSolanaClaim } from "../../lib/solana-claims";
import { useWalletEngineState } from "../rewards/useWalletEngineState";
import { formatUsdCents } from "./presentation";
import { useClaimRewardsState } from "./useClaimRewardsState";
import { useSolanaClaimState } from "./useSolanaClaimState";
import { ClaimPoolVisual } from "./ClaimPoolVisual";
import "./ClaimPage.css";

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function formatUsdcAtomic(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return fraction.length > 0
    ? `${whole.toString()}.${fraction}`
    : whole.toString();
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}.${String(date.getUTCFullYear())}`;
}

function formattedClaimDeadline(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function allocationStatus(allocation: ClaimAllocation): string {
  switch (allocation.status) {
    case "PAID":
      return "Paid";
    case "FAILED":
      return "Needs review";
    case "MANUAL_REVIEW":
      return "Under review";
    case "PROCESSING":
      return "Processing";
    case "PENDING_PAYOUT":
      return "Pending payout";
    case "CLAIM_UNAVAILABLE_BETA":
      return "Legacy estimate · not a win";
  }
}

interface ClaimReceipt {
  walletAddress: string;
  wltPoints: string | null;
  amountUsdc: string;
  entitlementId: string;
  status: "CONFIRMED" | "SUBMITTED";
  transactionSignature: string;
}

function claimShareMessage(receipt: ClaimReceipt): string {
  return `I just claimed ${receipt.amountUsdc} USDC on Walletor${receipt.wltPoints === null ? "!" : ` and have earned ${receipt.wltPoints} WLT points!`}`;
}

function ClaimShareDialog({
  onClose,
  receipt,
}: {
  onClose: () => void;
  receipt: ClaimReceipt;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const shareMessage = claimShareMessage(receipt);
  const walletorUrl = "https://walletor.com";
  const encodedMessage = encodeURIComponent(shareMessage);
  const encodedUrl = encodeURIComponent(walletorUrl);
  const solscanUrl = `https://solscan.io/tx/${encodeURIComponent(receipt.transactionSignature)}`;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const controls =
          dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href]");
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="claim-share-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="claim-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-share-title"
        aria-describedby="claim-share-description"
      >
        <button
          ref={closeButtonRef}
          className="claim-share-dialog__close"
          type="button"
          onClick={onClose}
          aria-label="Close claim confirmation"
        >
          <X aria-hidden="true" />
        </button>

        <span className="claim-share-dialog__success" aria-hidden="true">
          <CircleCheckBig />
        </span>
        <p className="claim-share-dialog__eyebrow">
          {receipt.status === "CONFIRMED"
            ? "Claim confirmed"
            : "Claim submitted"}
        </p>
        <h2 id="claim-share-title">
          {receipt.status === "CONFIRMED"
            ? "Your earnings are in"
            : "Your claim is on the way"}
        </h2>
        <strong className="claim-share-dialog__amount">
          ${receipt.amountUsdc} USDC
        </strong>
        {receipt.status === "CONFIRMED" ? (
          <div className="claim-share-dialog__points">
            <span>Total WLT earned</span>
            <strong>
              {receipt.wltPoints ?? "Unavailable"}
              {receipt.wltPoints !== null ? " WLT points" : ""}
            </strong>
            <small>
              WLT points are off-chain rewards, not withdrawable tokens.
            </small>
          </div>
        ) : null}
        <p id="claim-share-description">
          {receipt.status === "SUBMITTED"
            ? "Solana received the transaction. Check Solscan for its final status before sharing."
            : "Your USDC winnings were sent directly to your connected wallet."}
        </p>

        {receipt.status === "CONFIRMED" ? (
          <>
            <div className="claim-share-dialog__heading">
              <Share2 aria-hidden="true" />
              <span>Share it with your friends</span>
            </div>
            <div className="claim-share-dialog__networks">
              <a
                className="claim-share-network claim-share-network--twitter"
                href={`https://twitter.com/intent/tweet?text=${encodedMessage}&url=${encodedUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share on Twitter"
              >
                <span aria-hidden="true">X</span>
                Twitter
              </a>
              <a
                className="claim-share-network claim-share-network--telegram"
                href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share on Telegram"
              >
                <Send aria-hidden="true" />
                Telegram
              </a>
              <a
                className="claim-share-network claim-share-network--whatsapp"
                href={`https://wa.me/?text=${encodeURIComponent(`${shareMessage}\n\n${walletorUrl}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share on WhatsApp"
              >
                <MessageCircle aria-hidden="true" />
                WhatsApp
              </a>
            </div>
          </>
        ) : null}

        <a
          className="claim-share-dialog__solscan"
          href={solscanUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {receipt.status === "CONFIRMED"
            ? "View confirmed transaction on Solscan"
            : "View transaction on Solscan"}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </section>
    </div>,
    document.body,
  );
}

interface ClaimPageLinks {
  swap: string;
  rewards: string;
  prizePool: string;
}

interface ClaimPageProps {
  links?: ClaimPageLinks;
}

const defaultLinks: ClaimPageLinks = {
  swap: "/swap",
  rewards: "/rewards",
  prizePool: "/revenue-pool",
};

export function ClaimPage({ links = defaultLinks }: ClaimPageProps) {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const walletAddress = connected ? (publicKey?.toBase58() ?? null) : null;
  const claims = useClaimRewardsState(walletAddress);
  const solanaClaims = useSolanaClaimState(walletAddress);
  const refetchSolanaClaims = solanaClaims.refetch;
  const engine = useWalletEngineState(walletAddress);
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSignature, setClaimSignature] = useState<string | null>(null);
  const [claimReceipt, setClaimReceipt] = useState<ClaimReceipt | null>(null);
  const closeClaimReceipt = useCallback(() => {
    setClaimReceipt(null);
  }, []);

  useEffect(() => {
    if (
      claimReceipt?.status !== "SUBMITTED" ||
      walletAddress === null ||
      claimReceipt.walletAddress !== walletAddress
    ) {
      return;
    }
    const controller = new AbortController();
    let timeoutId: number | null = null;
    const confirmSubmittedClaim = async () => {
      let lastConfirmationError: string | null = null;
      for (
        let attempt = 0;
        attempt < 12 && !controller.signal.aborted;
        attempt += 1
      ) {
        await new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, 1_500);
        });
        try {
          const result = await submitSolanaClaim({
            walletAddress,
            entitlementId: claimReceipt.entitlementId,
            transactionSignature: claimReceipt.transactionSignature,
          });
          controller.signal.throwIfAborted();
          if (result.status === "CONFIRMED") {
            setClaimError(null);
            setClaimReceipt((current) =>
              current?.transactionSignature === result.transactionSignature
                ? { ...current, status: "CONFIRMED" }
                : current,
            );
            setClaimSignature(result.transactionSignature);
            await refetchSolanaClaims();
            return;
          }
        } catch (error) {
          lastConfirmationError =
            error instanceof Error
              ? error.message
              : "Walletor could not verify the submitted claim yet.";
        }
      }
      if (!controller.signal.aborted && lastConfirmationError !== null) {
        setClaimError(
          `${lastConfirmationError} The transaction was not resent; verify its signature on Solscan.`,
        );
      }
    };
    void confirmSubmittedClaim();
    return () => {
      controller.abort();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [claimReceipt, refetchSolanaClaims, walletAddress]);

  // Never show a previous wallet's balance or treat an unavailable ledger as zero.
  const state =
    walletAddress !== null &&
    !claims.isError &&
    claims.data?.walletAddress === walletAddress
      ? claims.data
      : undefined;
  const pointsState =
    walletAddress !== null &&
    !engine.isError &&
    engine.data?.walletAddress === walletAddress
      ? engine.data
      : undefined;
  const solanaState =
    walletAddress !== null &&
    !solanaClaims.isError &&
    solanaClaims.data?.walletAddress === walletAddress
      ? solanaClaims.data
      : undefined;
  const recordedAllocationCents = state
    ? BigInt(state.pendingRewardsCents) + BigInt(state.claimableRewardsCents)
    : null;
  const claimableEntitlements =
    solanaState?.entitlements.filter(
      (entitlement) => entitlement.status === "CLAIMABLE",
    ) ?? [];
  const claimableAtomic = claimableEntitlements.reduce(
    (total, entitlement) => total + BigInt(entitlement.remainingAmountAtomic),
    0n,
  );
  const onchainAwardedAtomic =
    solanaState?.entitlements.reduce(
      (total, entitlement) => total + BigInt(entitlement.netAmountAtomic),
      0n,
    ) ?? 0n;
  const nextEntitlement = claimableEntitlements[0] ?? null;
  const nextClaimAmountAtomic = BigInt(
    nextEntitlement?.remainingAmountAtomic ?? "0",
  );
  const hasOnchainWinnings = claimableAtomic > 0n;
  const hasOnchainAward = onchainAwardedAtomic > 0n;
  const hasClaimedWinnings =
    solanaState?.entitlements.some(
      (entitlement) => entitlement.status === "CLAIMED",
    ) ?? false;
  const hasExpiredWinnings =
    solanaState?.entitlements.some(
      (entitlement) => entitlement.status === "EXPIRED",
    ) ?? false;
  const hasRecordedAllocation =
    recordedAllocationCents !== null && recordedAllocationCents > 0n;
  const totalRounds =
    state && solanaState
      ? new Set([
          ...state.allocations.map((allocation) => allocation.roundId),
          ...solanaState.entitlements.map((entitlement) => entitlement.roundId),
        ]).size.toLocaleString("en-US")
      : "—";
  const winnings = hasOnchainAward
    ? `${formatUsdcAtomic(onchainAwardedAtomic)} USDC`
    : state === undefined
      ? "—"
      : "$0.00";
  const wltPoints = pointsState
    ? BigInt(pointsState.lifetimeWltPoints).toLocaleString("en-US")
    : "—";
  const pointsPerEligibleSwap = BigInt(
    pointsState?.pointsPerEligibleSwap ?? "2",
  ).toLocaleString("en-US");
  const submitClaim = async () => {
    if (!walletAddress || !nextEntitlement || submittingClaim) {
      return;
    }
    setSubmittingClaim(true);
    setClaimError(null);
    setClaimSignature(null);
    let sentSignature: string | null = null;
    try {
      const prepared = await buildSolanaClaim({
        walletAddress,
        entitlementId: nextEntitlement.entitlementId,
      });
      const transaction = VersionedTransaction.deserialize(
        bytesFromBase64(prepared.transaction),
      );
      if (
        transaction.message.staticAccountKeys[0]?.toBase58() !==
          walletAddress ||
        transaction.message.header.numRequiredSignatures !== 1
      ) {
        throw new Error(
          "The claim transaction must use your connected wallet as its only signer and network-fee payer. Please refresh and try again.",
        );
      }
      const transactionSignature = await sendTransaction(
        transaction,
        connection,
        { maxRetries: 0, skipPreflight: false },
      );
      setClaimSignature(transactionSignature);
      sentSignature = transactionSignature;
      setClaimReceipt({
        walletAddress,
        wltPoints: pointsState ? wltPoints : null,
        amountUsdc: formatUsdcAtomic(nextClaimAmountAtomic),
        entitlementId: nextEntitlement.entitlementId,
        status: "SUBMITTED",
        transactionSignature,
      });
      const result = await submitSolanaClaim({
        walletAddress,
        entitlementId: nextEntitlement.entitlementId,
        transactionSignature,
      });
      setClaimSignature(result.transactionSignature);
      setClaimReceipt({
        walletAddress,
        wltPoints: pointsState ? wltPoints : null,
        amountUsdc: formatUsdcAtomic(nextClaimAmountAtomic),
        entitlementId: nextEntitlement.entitlementId,
        status: result.status,
        transactionSignature: result.transactionSignature,
      });
      await solanaClaims.refetch();
    } catch (error) {
      setClaimError(
        sentSignature !== null
          ? null
          : error instanceof Error
            ? error.message
            : "The claim could not be submitted.",
      );
    } finally {
      setSubmittingClaim(false);
    }
  };

  return (
    <section className="claim-center" aria-labelledby="claim-title">
      <header className="claim-heading">
        <div className="claim-heading__glow" aria-hidden="true" />
        {walletAddress ? (
          <span className="claim-wallet" title={walletAddress}>
            <WalletCards aria-hidden="true" />
            <span className="sr-only">Connected wallet: </span>
            {walletAddress.slice(0, 5)}…{walletAddress.slice(-5)}
          </span>
        ) : null}
        <div className="claim-heading__intro">
          <ClaimPoolVisual />
          <div
            className="claim-primary-action"
            role="region"
            aria-label="Claim action"
          >
            <div className="claim-card__action">
              {walletAddress === null ? (
                <WalletConnectionButton>Connect wallet</WalletConnectionButton>
              ) : solanaClaims.isError ? (
                <button
                  className="claim-button"
                  type="button"
                  onClick={() => {
                    void solanaClaims.refetch();
                  }}
                >
                  Retry on-chain claim
                </button>
              ) : nextEntitlement ? (
                <button
                  className="claim-button"
                  type="button"
                  disabled={
                    submittingClaim ||
                    (claimReceipt?.walletAddress === walletAddress &&
                      claimReceipt.entitlementId ===
                        nextEntitlement.entitlementId)
                  }
                  onClick={() => void submitClaim()}
                >
                  {submittingClaim ? (
                    <>
                      <Clock3 aria-hidden="true" /> Preparing claim…
                    </>
                  ) : (
                    <>
                      <Coins aria-hidden="true" /> Claim{" "}
                      {formatUsdcAtomic(nextClaimAmountAtomic)} USDC
                    </>
                  )}
                </button>
              ) : hasClaimedWinnings ? (
                <button className="claim-button" type="button" disabled>
                  <CircleCheckBig aria-hidden="true" /> Claimed
                </button>
              ) : hasExpiredWinnings ? (
                <button className="claim-button" type="button" disabled>
                  <LockKeyhole aria-hidden="true" /> Claim expired
                </button>
              ) : claims.isError ? (
                <button
                  className="claim-button"
                  type="button"
                  onClick={() => {
                    void claims.refetch();
                  }}
                >
                  Retry reward history
                </button>
              ) : !state ? (
                <button className="claim-button" type="button" disabled>
                  <Clock3 aria-hidden="true" /> Checking winnings…
                </button>
              ) : hasRecordedAllocation ? (
                <button
                  className="claim-button"
                  type="button"
                  disabled
                  aria-describedby="claim-availability"
                >
                  <LockKeyhole aria-hidden="true" /> Result not finalized
                </button>
              ) : (
                <Link className="claim-button" to={links.swap}>
                  Start swapping <ArrowRight aria-hidden="true" />
                </Link>
              )}
              <p className="claim-note" id="claim-availability">
                {hasOnchainWinnings
                  ? `The displayed amount is after Walletor's 2.50% claim fee. Your wallet pays the Solana network fee and any required USDC account-creation cost in SOL. Review these costs before signing; the Rewards program sends USDC directly to this wallet.${nextEntitlement?.claimDeadline ? ` Claim by ${formattedClaimDeadline(nextEntitlement.claimDeadline)} UTC.` : ""}`
                  : hasClaimedWinnings
                    ? `The Rewards program confirms that ${formatUsdcAtomic(onchainAwardedAtomic)} USDC was claimed by this wallet.`
                    : hasExpiredWinnings
                      ? "The on-chain claim deadline has passed, so this winning can no longer be withdrawn."
                      : hasRecordedAllocation
                        ? "Walletor only presents a prize as won after its funded mainnet USDC entitlement is active on-chain. Legacy ledger estimates are not claimable winnings."
                        : solanaState?.availability === "MAINNET_LIVE"
                          ? "Mainnet withdrawals are live. Only verified winners have a claim available."
                          : "Prize Pool withdrawals are not live yet."}
              </p>
              {claimError ? (
                <p
                  className="claim-submit-message claim-submit-message--error"
                  role="alert"
                >
                  {claimError}
                </p>
              ) : null}
              {claimSignature ? (
                <p className="claim-submit-message" role="status">
                  Claim submitted.{" "}
                  <a
                    href={`https://solscan.io/tx/${encodeURIComponent(claimSignature)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Solscan <ArrowUpRight aria-hidden="true" />
                  </a>
                </p>
              ) : null}
            </div>
          </div>
          <span className="claim-heading__eyebrow">
            <CircleCheckBig aria-hidden="true" /> Walletor reward vault
          </span>
          <h1 id="claim-title">Your rewards, verified.</h1>
          <p>
            Every result in one place, backed by Walletor records and Solana.
          </p>
        </div>

        <div
          className="claim-heading__stats"
          role="region"
          aria-label="Wallet reward totals"
        >
          <section
            className="claim-hero-stat"
            aria-labelledby="claim-rounds-total-title"
          >
            <span className="claim-hero-stat__icon" aria-hidden="true">
              <ReceiptText />
            </span>
            <span id="claim-rounds-total-title">Total rounds</span>
            <strong aria-live="polite">{totalRounds}</strong>
            <small>Recorded reward results</small>
          </section>
          <section
            className="claim-hero-stat claim-hero-stat--featured"
            aria-labelledby="claim-winnings-total-title"
            aria-busy={solanaClaims.isLoading}
          >
            <span className="claim-hero-stat__icon" aria-hidden="true">
              <Trophy />
            </span>
            <span id="claim-winnings-total-title">Total won</span>
            <strong
              className={
                winnings.length > 12
                  ? "claim-hero-stat__value--long"
                  : undefined
              }
              aria-live="polite"
            >
              {winnings}
            </strong>
            <small>
              {hasOnchainWinnings
                ? "Available now · USDC"
                : hasClaimedWinnings
                  ? "Won · Claimed in USDC"
                  : hasExpiredWinnings
                    ? "Won · Claim window expired"
                    : "Verified winnings · USDC"}
            </small>
          </section>
          <section
            className="claim-hero-stat claim-hero-stat--points"
            aria-labelledby="claim-points-total-title"
            aria-busy={engine.isLoading}
          >
            <span className="claim-hero-stat__icon" aria-hidden="true">
              <Coins />
            </span>
            <span id="claim-points-total-title">WLT points earned</span>
            <strong aria-live="polite">{wltPoints}</strong>
            <small>Lifetime verified total</small>
          </section>
        </div>
      </header>

      <div className="claim-cards">
        <section
          className="claim-card claim-card--claim"
          aria-labelledby="claim-winnings-title"
        >
          <header className="claim-card__header">
            <span className="claim-card__icon">
              <Trophy aria-hidden="true" />
            </span>
            <div>
              <span className="claim-card__eyebrow">Prize withdrawal</span>
              <h2 id="claim-winnings-title">Claim status</h2>
            </div>
            <span className="claim-network-badge">Mainnet · USDC</span>
          </header>
          <div className="claim-card__message">
            {walletAddress === null ? (
              <>
                <h3>See what you’ve earned</h3>
                <p>
                  Connect your wallet to check your winnings and WLT points.
                </p>
              </>
            ) : solanaClaims.isError ? (
              <p role="alert">
                We couldn’t verify your on-chain winnings. Please try again.
              </p>
            ) : !solanaState ? (
              <p role="status">Checking your winnings…</p>
            ) : hasOnchainWinnings ? (
              <>
                <h3>Your winnings are ready</h3>
                <p>
                  Your verified Prize Pool winnings are ready to claim in
                  mainnet USDC.
                </p>
              </>
            ) : hasClaimedWinnings ? (
              <>
                <h3>Prize claimed</h3>
                <p>
                  Your verified Prize Pool winnings were claimed in mainnet
                  USDC.
                </p>
              </>
            ) : hasExpiredWinnings ? (
              <>
                <h3>Claim window expired</h3>
                <p>
                  This verified winning was not claimed before its on-chain
                  deadline.
                </p>
              </>
            ) : hasRecordedAllocation ? (
              <>
                <h3>No verified winning yet</h3>
                <p>
                  A {formatUsdCents(recordedAllocationCents.toString())} legacy
                  ledger estimate exists, but it is not a finalized winner
                  claim.
                </p>
              </>
            ) : claims.isError ? (
              <p role="alert">
                We couldn’t load your historical reward records. Please try
                again.
              </p>
            ) : !state ? (
              <p role="status">Checking your reward history…</p>
            ) : (
              <>
                <h3>No winnings to withdraw yet</h3>
                <p>Start swapping for a chance to win next time.</p>
              </>
            )}
          </div>
        </section>

        <section
          className="claim-card claim-card--points"
          aria-labelledby="claim-points-title"
        >
          <header className="claim-card__header">
            <span className="claim-card__icon">
              <Coins aria-hidden="true" />
            </span>
            <div>
              <span className="claim-card__eyebrow">Lifetime progress</span>
              <h2 id="claim-points-title">WLT activity</h2>
            </div>
          </header>
          <div className="claim-card__message">
            {walletAddress === null ? (
              <p>Your earned WLT points will appear here when you connect.</p>
            ) : engine.isError ? (
              <p role="alert">
                We couldn’t load your WLT points. Please try again.
              </p>
            ) : !pointsState ? (
              <p role="status">Loading your WLT points…</p>
            ) : (
              <>
                <h3>+{pointsPerEligibleSwap} WLT per eligible swap</h3>
                <p>
                  {pointsState.accountingStatus === "LIVE"
                    ? `${BigInt(pointsState.pointsPerEligibleSwap).toLocaleString("en-US")} WLT points per Jupiter-confirmed Walletor swap valued at $${pointsState.eligibilityPolicy.minimumEligibleSwapUsd ?? "5.00"} or more.`
                    : pointsState.accountingStatus === "SYNCING"
                      ? "Your points are syncing with verified swap activity."
                      : "Points updates are currently paused. Your earned total is shown above."}
                </p>
              </>
            )}
          </div>
          <div className="claim-card__action">
            {walletAddress !== null && engine.isError ? (
              <button
                className="claim-button claim-button--secondary"
                type="button"
                onClick={() => void engine.refetch()}
              >
                Retry WLT points
              </button>
            ) : (
              <Link
                className="claim-button claim-button--secondary"
                to={links.rewards}
              >
                View rewards progress <ArrowRight aria-hidden="true" />
              </Link>
            )}
            <p className="claim-note">
              WLT points are off-chain rewards, not withdrawable tokens.
            </p>
          </div>
        </section>
      </div>

      {state ? (
        <details className="claim-history" key={walletAddress}>
          <summary>
            <ReceiptText aria-hidden="true" />
            <span>Reward history</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="claim-history__body">
            <p>
              Latest 25 ledger estimates and verified payouts. Dates shown in
              UTC.
            </p>
            {state.allocations.length ? (
              <div
                className="claim-history__scroll"
                role="region"
                aria-label="Reward history table"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">
                    Your Prize Pool ledger estimates and verified payouts
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Round closed</th>
                      <th scope="col">Recorded amount</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.allocations.map((allocation) => (
                      <tr key={allocation.allocationId}>
                        <td>
                          <time dateTime={allocation.roundEndTime}>
                            {formattedDate(allocation.roundEndTime)}
                          </time>
                        </td>
                        <td>{formatUsdCents(allocation.rewardCents)}</td>
                        <td>
                          <span
                            className={`claim-history__status${allocation.status === "PAID" ? " claim-history__status--paid" : ""}`}
                          >
                            {allocationStatus(allocation)}
                          </span>
                          {allocation.status === "PAID" &&
                          allocation.payoutTransactionHash ? (
                            <a
                              href={`https://solscan.io/tx/${encodeURIComponent(allocation.payoutTransactionHash)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`View payout for ${formattedDate(allocation.roundEndTime)} on Solscan`}
                            >
                              Solscan <ArrowUpRight aria-hidden="true" />
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No finalized rewards yet. Check back after the round ends.</p>
            )}
            <Link className="claim-history__link" to={links.prizePool}>
              View all Prize Pool distributions{" "}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </details>
      ) : null}
      {claimReceipt?.walletAddress === walletAddress ? (
        <ClaimShareDialog receipt={claimReceipt} onClose={closeClaimReceipt} />
      ) : null}
    </section>
  );
}
