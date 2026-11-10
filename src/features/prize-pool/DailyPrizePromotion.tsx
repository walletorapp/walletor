import { Link } from "react-router-dom";
import type { PrizePoolState } from "../../../shared/accounting-contracts";
import { LivePoolAmount } from "./LivePoolAmount";
import { prizePromotion } from "./prize-promotion";
import "./daily-prize-promotion.css";

interface Props {
  state?: PrizePoolState;
  isError?: boolean;
}

export function PrizePoolAmount({ state, isError }: Props) {
  if (isError) return <>Unavailable</>;
  if (!state) return <>Loading…</>;
  return (
    <LivePoolAmount
      microUsd={
        prizePromotion(
          state.currentPrizePoolMicroUsd,
          state.currentRoundSeedCents,
        ).totalMicroUsd
      }
      roundId={state.activeRound.roundId}
      display="cents"
    />
  );
}

export function PrizePoolFundingNote({ state }: Props) {
  if (!state) return null;
  const { unfundedPledgeMicroUsd } = prizePromotion(
    state.currentPrizePoolMicroUsd,
    state.currentRoundSeedCents,
  );
  if (unfundedPledgeMicroUsd === "0") return null;
  return (
    <small className="daily-prize-promotion__description">
      <Link to="/prize-pool#pool-funding">Details</Link>
    </small>
  );
}

/** Prize display only. Ledger and claim balances remain separate. */
export function DailyPrizePromotion(props: Props) {
  return (
    <>
      <strong>
        <PrizePoolAmount {...props} />
      </strong>
      <PrizePoolFundingNote {...props} />
    </>
  );
}
