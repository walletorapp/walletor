import type { CSSProperties } from "react";
import { DailyPrizePromotion } from "./DailyPrizePromotion";
import { usePrizePoolState } from "./usePrizePoolState";

export function ClaimPoolVisual() {
  const pool = usePrizePoolState();
  return (
    <div className="claim-pool-visual" role="region" aria-label="Prize Pool">
      <div className="claim-pool-visual__orbits" aria-hidden="true">
        {[0, 72, 144, 216, 288].map((angle) => (
          <span
            className="claim-pool-visual__bill-orbit"
            key={angle}
            style={
              {
                "--bill-start": `${String((angle / 360) * 100)}%`,
              } as CSSProperties
            }
          >
            <img
              src="/assets/walletor-cash-bill-v3.png"
              alt=""
              draggable={false}
            />
          </span>
        ))}
      </div>
      <div className="claim-pool-visual__value">
        <span className="claim-pool-visual__label">
          <i /> Prize Pool
        </span>
        <DailyPrizePromotion state={pool.data} isError={pool.isError} />
      </div>
    </div>
  );
}
