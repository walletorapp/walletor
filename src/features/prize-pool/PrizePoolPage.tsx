import { ShieldCheck } from "lucide-react";

import { HowItWorksButton } from "../../components/HowItWorksButton";
import { formatParticipantCount, formatUsdCents } from "./presentation";
import { DistributionLedger } from "./DistributionLedger";
import { LivePoolAmount } from "./LivePoolAmount";
import { DailyPrizePromotion } from "./DailyPrizePromotion";
import { usePrizePoolState } from "./usePrizePoolState";

export function PrizePoolPage() {
  const pool = usePrizePoolState();

  if (pool.isError) {
    return (
      <section className="unavailable-page">
        <ShieldCheck size={28} />
        <p className="eyebrow eyebrow--accent">Ledger protected</p>
        <h1>Prize Pool</h1>
        <HowItWorksButton className="how-it-works-trigger--pool" />
        <p>Temporarily unavailable. No fallback financial values are shown.</p>
      </section>
    );
  }

  if (!pool.data) {
    return (
      <section className="unavailable-page" aria-busy="true">
        <ShieldCheck size={28} />
        <p className="eyebrow eyebrow--accent">Walletor ledger</p>
        <h1>Prize Pool</h1>
        <HowItWorksButton className="how-it-works-trigger--pool" />
        <p>Loading…</p>
      </section>
    );
  }

  const state = pool.data;
  return (
    <div className="prize-pool-page">
      <header className="prize-pool-page__hero">
        <div>
          <span className="prize-pool-kicker">
            <ShieldCheck aria-hidden="true" /> Verifiable public accounting
          </span>
          <h1>Prize Pool</h1>
          <p>
            Track every confirmed contribution, finalized allocation and
            on-chain payout from one public record. Eligible wallets receive
            formula-based allocations automatically—no team member hand-picks
            winners.
          </p>
        </div>
        <HowItWorksButton className="how-it-works-trigger--pool" />
      </header>

      <section className="daily-prize-offer" aria-label="Daily Prize Pool">
        <h2>Prize Pool</h2>
        <DailyPrizePromotion state={state} />
      </section>
      <p id="pool-funding" className="prize-pool-page__disclosure">
        The displayed prize includes a $100 daily sponsor pledge plus the
        recorded pool. Any unfunded portion of that pledge is not held in the
        pool or available to claim. Verified daily seed funding is counted only
        once. The ledger below shows recorded funds; your Claim page shows your
        actual claimable award.
      </p>
      <section
        className="prize-pool-audit"
        aria-label="Recorded pool accounting"
      >
        <div className="prize-pool-audit__total">
          <small>Recorded funds · estimated USD</small>
          <strong>
            <LivePoolAmount microUsd={state.currentPrizePoolMicroUsd} />
          </strong>
          <span
            className={`prize-pool-live prize-pool-live--${state.accountingStatus.toLowerCase()}`}
          >
            <i aria-hidden="true" /> {state.accountingStatus}
          </span>
        </div>
        <dl>
          <div>
            <dt>Total collected</dt>
            <dd>
              <LivePoolAmount microUsd={state.totalCollectedMicroUsd} />
            </dd>
          </div>
          <div>
            <dt>Total paid out</dt>
            <dd>{formatUsdCents(state.totalDistributedCents)}</dd>
          </div>
          <div>
            <dt>Eligible wallets</dt>
            <dd>{formatParticipantCount(state.currentParticipants)}</dd>
          </div>
          <div>
            <dt>Current round</dt>
            <dd>{state.activeRound.status}</dd>
          </div>
          <div>
            <dt>Organic contributions</dt>
            <dd>
              <LivePoolAmount microUsd={state.organicContributionsMicroUsd} />
            </dd>
          </div>
          <div>
            <dt>Treasury seeded</dt>
            <dd>{formatUsdCents(state.treasurySeedContributionsCents)}</dd>
          </div>
          <div>
            <dt>Failed payouts</dt>
            <dd>{formatParticipantCount(state.failedPayoutCount)}</dd>
          </div>
          <div>
            <dt>Remainder carried</dt>
            <dd>{formatUsdCents(state.remainderCarriedForwardCents)}</dd>
          </div>
        </dl>
      </section>

      <DistributionLedger
        rounds={state.completedRounds}
        transparency={state.transparency}
      />

      <p className="prize-pool-page__disclosure">
        <strong>No human-selected winners.</strong>{" "}
        {state.distributionExplanation} {state.valuationExplanation} Claim and
        payout execution remains security-locked during beta.
      </p>
    </div>
  );
}
