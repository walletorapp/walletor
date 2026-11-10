import { ArrowRight, Info, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { usePrizePoolState } from "../features/prize-pool/usePrizePoolState";
import { formatBasisPoints } from "../lib/fees";

interface HowItWorksButtonProps {
  className?: string;
}

function FeeExplanation() {
  const pool = usePrizePoolState();
  const terms = pool.isError ? null : pool.data?.transparency;
  return terms ? (
    <>
      {formatBasisPoints(terms.prizePoolShareBps + (terms.feeReserveBps ?? 0))}{" "}
      of Walletor’s confirmed fees is allocated back to active users and
      influencers through prizes and influencer rewards.
      {terms.feeReserveBps
        ? " Influencer rewards are held in reserve for manual payment."
        : ""}
    </>
  ) : (
    <>
      Walletor fees fund the Prize Pool for active users. See your quote for
      fees.
    </>
  );
}

const steps = (onNavigate: () => void) =>
  [
    {
      number: "1",
      title: "Swap tokens",
      description:
        "Make an eligible swap of $5 or more to earn WLT points and enter the Prize Pool.",
      highlighted: false,
    },
    {
      number: "2",
      title: "Fees fund the prizes",
      description: <FeeExplanation />,
      highlighted: false,
    },
    {
      number: "3",
      title: "Winners every 24 hours",
      description: (
        <>
          Walletor uses{" "}
          <a
            className="how-it-works-steps__external"
            href="https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart"
            target="_blank"
            rel="noopener noreferrer"
          >
            MagicBlock randomness
          </a>{" "}
          to select lucky winners under the published rules.
        </>
      ),
      highlighted: true,
    },
    {
      number: "4",
      title: "Claim your USDC",
      description: (
        <>
          If you win, connect your wallet on the{" "}
          <Link
            className="how-it-works-steps__external"
            to="/claim-rewards"
            onClick={onNavigate}
          >
            Claim page
          </Link>{" "}
          once your prize is ready. Review fees before signing.
        </>
      ),
      highlighted: false,
    },
  ] as const;

export function HowItWorksButton({ className }: HowItWorksButtonProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const poolPath = "/prize-pool";
  const claimPath = "/claim-rewards";

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
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
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`how-it-works-trigger${className ? ` ${className}` : ""}`}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="how-it-works-trigger__icon" aria-hidden="true">
          <Info />
        </span>
        <span>How it works</span>
      </button>

      {open &&
        createPortal(
          <div
            className="how-it-works-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <section
              ref={modalRef}
              className="how-it-works-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <header>
                <div>
                  <span className="how-it-works-modal__eyebrow">
                    <ShieldCheck aria-hidden="true" /> Clear, verifiable rules
                  </span>
                  <h2 id={titleId}>How Walletor works</h2>
                  <p id={descriptionId}>
                    Swap. Earn points. Get a chance to win.
                  </p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  className="how-it-works-modal__close"
                  aria-label="Close How it works"
                  onClick={close}
                >
                  <X aria-hidden="true" />
                </button>
              </header>

              <div className="how-it-works-modal__body">
                <div className="how-it-works-modal__notice">
                  <Info aria-hidden="true" />
                  <p>Not available in the USA. Rewards are not guaranteed.</p>
                </div>

                <ol className="how-it-works-steps">
                  {steps(() => {
                    setOpen(false);
                  }).map((step) => (
                    <li
                      className={
                        step.highlighted
                          ? "how-it-works-steps__switchboard"
                          : undefined
                      }
                      key={step.number}
                    >
                      <span>{step.number}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <footer>
                <Link to={poolPath} onClick={close}>
                  View pool accounting <ArrowRight aria-hidden="true" />
                </Link>
                <Link to={claimPath} onClick={close}>
                  Claim Rewards <ArrowRight aria-hidden="true" />
                </Link>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
