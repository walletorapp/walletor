import {
  CheckCircle2,
  Coins,
  ExternalLink,
  Send,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import type { VerifiedSwapCreditResult } from "../../../shared/accounting-contracts";

interface RewardCelebrationModalProps {
  receipt: VerifiedSwapCreditResult;
  signature: string;
  onClose: () => void;
}

export function RewardCelebrationModal({
  receipt,
  signature,
  onClose,
}: RewardCelebrationModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="reward-celebration-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={modalRef}
        className="reward-celebration"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button
          ref={closeRef}
          className="reward-celebration__close"
          type="button"
          aria-label="Close reward confirmation"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>

        <div className="reward-celebration__visual" aria-hidden="true">
          <span className="reward-celebration__spark reward-celebration__spark--one" />
          <span className="reward-celebration__spark reward-celebration__spark--two" />
          <span className="reward-celebration__spark reward-celebration__spark--three" />
          <span className="reward-celebration__logo">
            <img src="/assets/walletor-logo-animated.gif" alt="" />
          </span>
        </div>

        <span className="reward-celebration__eyebrow">
          <CheckCircle2 aria-hidden="true" /> VERIFIED ON SOLANA
        </span>
        <h2 id={titleId}>CONGRATS!</h2>
        <p id={descriptionId}>
          You gained {receipt.wltPointsCredited} WLT Airdrop Points, and your
          swap now counts toward the current Prize Pool round.
        </p>

        <div className="reward-celebration__rewards">
          <div>
            <Sparkles aria-hidden="true" />
            <strong>+{receipt.wltPointsCredited} WLT</strong>
            <span>Airdrop Points earned</span>
          </div>
          <div>
            <Trophy aria-hidden="true" />
            <strong>Counted</strong>
            <span>Current Prize Pool activity</span>
          </div>
          <div className="reward-celebration__lifetime">
            <Coins aria-hidden="true" />
            <strong>
              {receipt.resultingLifetimeWltPoints
                ? `${BigInt(receipt.resultingLifetimeWltPoints).toLocaleString("en-US")} WLT`
                : "Lifetime total syncing"}
            </strong>
            <span>Lifetime WLT points earned</span>
          </div>
        </div>

        <p className="reward-celebration__note">
          WLT Points are off-chain rewards for a future allocation. Prize Pool
          activity and points were credited only after backend verification.
        </p>

        <div className="reward-celebration__actions">
          <Link to="/rewards" onClick={onClose}>
            View rewards
          </Link>
          <button type="button" onClick={onClose}>
            Keep swapping
          </button>
        </div>
        <a
          className="reward-celebration__solscan"
          href={`https://solscan.io/tx/${encodeURIComponent(signature)}`}
          target="_blank"
          rel="noreferrer"
        >
          View confirmed transaction <ExternalLink aria-hidden="true" />
        </a>
        <nav
          className="reward-celebration__socials"
          aria-label="Walletor community"
        >
          <a
            href="https://x.com/walletorai"
            target="_blank"
            rel="noreferrer"
            aria-label="Follow Walletor on X"
          >
            <span aria-hidden="true">𝕏</span>X
          </a>
          <a
            href="https://t.me/walletorswap"
            target="_blank"
            rel="noreferrer"
            aria-label="Join Walletor on Telegram"
          >
            <Send aria-hidden="true" />
            Telegram
          </a>
        </nav>
      </section>
    </div>,
    document.body,
  );
}
