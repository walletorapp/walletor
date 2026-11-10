import { useEffect, useRef, useState } from "react";

import { formatUsdMicroUsd, formatUsdMicroUsdCents } from "./presentation";

interface LivePoolAmountProps {
  microUsd: string;
  className?: string;
  display?: "exact" | "cents";
  roundId?: string;
}

const ANIMATION_DURATION_MS = 900;
const INTERPOLATION_STEPS = 10_000n;

export function LivePoolAmount({
  microUsd,
  className,
  display = "exact",
  roundId,
}: LivePoolAmountProps) {
  const target = BigInt(microUsd);
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);
  const previous = useRef({ target, roundId });
  const [growing, setGrowing] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const startValue = displayedRef.current;
    const increase =
      target > previous.current.target && roundId === previous.current.roundId;
    previous.current = { target, roundId };
    setGrowing(increase && !reduceMotion);

    if (reduceMotion || !increase || startValue === target) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    let frame = 0;
    let startTime: number | null = null;

    const animate = (now: number) => {
      startTime ??= now;
      const progress = Math.min(1, (now - startTime) / ANIMATION_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      const step = BigInt(Math.round(eased * Number(INTERPOLATION_STEPS)));
      const next =
        startValue + ((target - startValue) * step) / INTERPOLATION_STEPS;
      displayedRef.current = next;
      setDisplayed(next);

      if (progress < 1) {
        frame = window.requestAnimationFrame(animate);
      } else {
        displayedRef.current = target;
        setDisplayed(target);
      }
    };

    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [target, roundId]);

  const finalLabel = formatUsdMicroUsd(microUsd);
  const formatDisplayed =
    display === "cents" ? formatUsdMicroUsdCents : formatUsdMicroUsd;
  const classes = ["live-pool-amount", className].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-label={`${finalLabel} estimated`}>
      <span
        key={`${roundId ?? "pool"}:${microUsd}`}
        className={`live-pool-amount__value${growing ? " live-pool-amount__value--growing" : ""}`}
        aria-hidden="true"
      >
        {formatDisplayed(displayed.toString())}
      </span>
    </span>
  );
}
