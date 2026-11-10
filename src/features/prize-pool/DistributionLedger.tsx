import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  Landmark,
  LoaderCircle,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useState } from "react";

import type {
  PrizePoolState,
  PublicDistributionRecipient,
  PublicRound,
} from "../../../shared/accounting-contracts";
import {
  fetchPublicDistributionCalendar,
  fetchPublicDistributionRound,
} from "../../lib/api";
import { formatBasisPoints, referralFeeBreakdown } from "../../lib/fees";
import { formatParticipantCount, formatUsdCents } from "./presentation";

interface DistributionLedgerProps {
  rounds: PublicRound[];
  transparency: PrizePoolState["transparency"];
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function formatUtcDate(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}.${String(date.getUTCFullYear())}`;
}

function formatUtcTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")} UTC`;
}

function utcDateKey(value: string): string {
  return value.slice(0, 10);
}

function utcMonthKey(value: string): string {
  return value.slice(0, 7);
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("Invalid UTC calendar month.");
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

function formatMonth(month: string): string {
  const { year, monthIndex } = monthParts(month);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

function formatDateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid UTC calendar date.");
  }
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}

function formatMultiplier(bps: number): string {
  const whole = Math.floor(bps / 10_000);
  const fraction = String(bps % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return `${String(whole)}${fraction ? `.${fraction}` : ""}×`;
}

function recipientStatus(recipient: PublicDistributionRecipient): string {
  switch (recipient.status) {
    case "PAID":
      return "Paid on-chain";
    case "FAILED":
      return "Payout failed";
    case "MANUAL_REVIEW":
      return "Manual review";
    case "PROCESSING":
      return "Processing";
    case "PENDING_PAYOUT":
      return "Pending payout";
    case "CLAIM_UNAVAILABLE_BETA":
      return "Allocation recorded";
  }
}

function DistributionRound({
  round,
  defaultOpen,
}: {
  round: PublicRound;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const distribution = useInfiniteQuery({
    queryKey: ["prize-pool", "distribution", round.roundId],
    queryFn: ({ pageParam, signal }) =>
      fetchPublicDistributionRound(round.roundId, pageParam, 50, signal),
    initialPageParam: 0,
    getNextPageParam: (page) => page.pagination.nextOffset ?? undefined,
    enabled: open,
    staleTime: 30_000,
  });
  const recipients =
    distribution.data?.pages.flatMap((page) => page.recipients) ?? [];

  return (
    <article className={`distribution-round${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="distribution-round__toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="distribution-round__date">
          <small>Distribution date</small>
          <strong>{formatUtcDate(round.endTime)}</strong>
          <em>{formatUtcTime(round.endTime)}</em>
        </span>
        <span>
          <small>Prize Pool</small>
          <strong>{formatUsdCents(round.totalPoolCents)}</strong>
        </span>
        <span>
          <small>Recipients</small>
          <strong>{formatParticipantCount(round.eligibleWalletCount)}</strong>
        </span>
        <span
          className={`distribution-status distribution-status--${round.status.toLowerCase()}`}
        >
          {round.status}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>

      {open ? (
        <div className="distribution-round__details">
          <dl className="distribution-round__proof">
            <div>
              <dt>Eligible swaps</dt>
              <dd>{formatParticipantCount(round.totalEligibleSwaps)}</dd>
            </div>
            <div>
              <dt>Remainder carried forward</dt>
              <dd>{formatUsdCents(round.remainderCents)}</dd>
            </div>
            <div>
              <dt>Allocation checksum</dt>
              <dd>
                {round.allocationChecksum ? (
                  <code title={round.allocationChecksum}>
                    {round.allocationChecksum.slice(0, 12)}…
                    {round.allocationChecksum.slice(-8)}
                  </code>
                ) : (
                  "Pending"
                )}
              </dd>
            </div>
          </dl>

          {distribution.isLoading ? (
            <div className="distribution-round__state" aria-live="polite">
              <LoaderCircle className="spin" aria-hidden="true" />
              Loading ledger evidence…
            </div>
          ) : distribution.isError ? (
            <div className="distribution-round__state" role="alert">
              <ShieldCheck aria-hidden="true" />
              Recipient evidence is temporarily unavailable. No cached payout
              records are shown.
            </div>
          ) : recipients.length ? (
            <>
              <div className="distribution-table" role="table">
                <div role="row">
                  <span role="columnheader">Recipient wallet</span>
                  <span role="columnheader">Activity</span>
                  <span role="columnheader">Allocation</span>
                  <span role="columnheader">Payout evidence</span>
                </div>
                {recipients.map((recipient) => (
                  <div role="row" key={recipient.allocationId}>
                    <span role="cell">
                      <a
                        href={`https://solscan.io/account/${encodeURIComponent(recipient.walletAddress)}`}
                        target="_blank"
                        rel="noreferrer"
                        title={recipient.walletAddress}
                      >
                        {shortAddress(recipient.walletAddress)}
                        <ExternalLink aria-hidden="true" />
                      </a>
                    </span>
                    <span role="cell">
                      <strong>
                        {formatParticipantCount(recipient.eligibleSwapCount)}
                      </strong>
                      <small>
                        swaps · {formatMultiplier(recipient.multiplierBps)}
                      </small>
                    </span>
                    <strong role="cell">
                      {formatUsdCents(recipient.rewardCents)}
                    </strong>
                    <span role="cell">
                      {recipient.payoutTransactionHash ? (
                        <a
                          className="distribution-transaction"
                          href={`https://solscan.io/tx/${encodeURIComponent(recipient.payoutTransactionHash)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction <ExternalLink aria-hidden="true" />
                        </a>
                      ) : (
                        <span
                          className={`distribution-recipient-status distribution-recipient-status--${recipient.status.toLowerCase()}`}
                        >
                          {recipientStatus(recipient)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              {distribution.hasNextPage ? (
                <button
                  type="button"
                  className="distribution-load-more"
                  disabled={distribution.isFetchingNextPage}
                  onClick={() => {
                    void distribution.fetchNextPage();
                  }}
                >
                  {distribution.isFetchingNextPage
                    ? "Loading recipients…"
                    : "Load more recipients"}
                </button>
              ) : null}
            </>
          ) : (
            <div className="distribution-round__state">
              <UsersRound aria-hidden="true" />
              This finalized round has no recipient allocations.
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function DistributionCalendar({
  month,
  availableMonths,
  rounds,
  selectedDate,
  loading,
  unavailable,
  onMonthChange,
  onDateChange,
}: {
  month: string;
  availableMonths: string[];
  rounds: PublicRound[];
  selectedDate: string | null;
  loading: boolean;
  unavailable: boolean;
  onMonthChange: (month: string) => void;
  onDateChange: (date: string | null) => void;
}) {
  const { year, monthIndex: calendarMonthIndex } = monthParts(month);
  const firstWeekday =
    (new Date(Date.UTC(year, calendarMonthIndex, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(
    Date.UTC(year, calendarMonthIndex + 1, 0),
  ).getUTCDate();
  const roundsByDate = new Map<string, number>();
  rounds.forEach((round) => {
    const key = utcDateKey(round.endTime);
    roundsByDate.set(key, (roundsByDate.get(key) ?? 0) + 1);
  });
  const monthIndex = availableMonths.indexOf(month);
  const olderMonth =
    monthIndex >= 0 ? (availableMonths.at(monthIndex + 1) ?? null) : null;
  const newerMonth = monthIndex > 0 ? availableMonths[monthIndex - 1] : null;
  const finalizedDateCount = roundsByDate.size;

  return (
    <section
      className="distribution-calendar"
      aria-labelledby="distribution-calendar-title"
    >
      <header className="distribution-calendar__header">
        <span>
          <CalendarDays aria-hidden="true" />
          <span>
            <small>Public payout history</small>
            <h3 id="distribution-calendar-title">Distribution calendar</h3>
          </span>
        </span>
        <p>
          Choose a highlighted date to view its winners, allocations and Solscan
          evidence.
        </p>
      </header>

      <div className="distribution-calendar__toolbar">
        <button
          type="button"
          disabled={olderMonth === null}
          aria-label="Show older distribution month"
          onClick={() => {
            if (olderMonth) onMonthChange(olderMonth);
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span aria-live="polite">
          <strong>{formatMonth(month)}</strong>
          <small>
            {loading
              ? "Loading finalized dates…"
              : `${String(finalizedDateCount)} finalized ${
                  finalizedDateCount === 1 ? "date" : "dates"
                }`}
          </small>
        </span>
        <button
          type="button"
          disabled={newerMonth === null}
          aria-label="Show newer distribution month"
          onClick={() => {
            if (newerMonth) onMonthChange(newerMonth);
          }}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      <div className="distribution-calendar__weekdays" aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="distribution-calendar__grid">
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span key={`blank-${String(index)}`} aria-hidden="true" />
        ))}
        {Array.from({ length: dayCount }, (_, index) => index + 1).map(
          (day) => {
            const date = `${month}-${String(day).padStart(2, "0")}`;
            const roundCount = roundsByDate.get(date) ?? 0;
            const active = selectedDate === date;
            return (
              <button
                type="button"
                key={date}
                className={active ? "is-selected" : undefined}
                disabled={roundCount === 0}
                aria-pressed={active}
                aria-label={
                  roundCount
                    ? `View ${String(roundCount)} finalized ${
                        roundCount === 1 ? "distribution" : "distributions"
                      } for ${formatDateKey(date)}`
                    : `No finalized distribution on ${formatDateKey(date)}`
                }
                onClick={() => {
                  onDateChange(active ? null : date);
                }}
              >
                <span>{String(day).padStart(2, "0")}</span>
                {roundCount ? <small>Distribution</small> : null}
              </button>
            );
          },
        )}
      </div>

      {unavailable ? (
        <p className="distribution-calendar__notice" role="alert">
          Full calendar history is temporarily unavailable. Recent verified
          records remain visible below.
        </p>
      ) : null}
      <footer>
        <span>
          <i aria-hidden="true" /> Dates with finalized distributions
        </span>
        {selectedDate ? (
          <button
            type="button"
            onClick={() => {
              onDateChange(null);
            }}
          >
            Show all dates in {formatMonth(month)}
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function PublicAccountLink({
  address,
  children,
}: {
  address: string | null;
  children: string;
}) {
  if (!address) return <strong>Not configured</strong>;
  return (
    <a
      href={`https://solscan.io/account/${encodeURIComponent(address)}`}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {children} <ExternalLink aria-hidden="true" />
    </a>
  );
}

export function DistributionLedger({
  rounds,
  transparency,
}: DistributionLedgerProps) {
  const fees = referralFeeBreakdown(
    transparency.referralFeeBps,
    transparency.walletorPartnerShareBps,
  );
  const initialMonth =
    rounds
      .map((round) => utcMonthKey(round.endTime))
      .sort((left, right) => right.localeCompare(left))
      .at(0) ?? new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const calendar = useQuery({
    queryKey: ["prize-pool", "distribution-calendar", month],
    queryFn: ({ signal }) => fetchPublicDistributionCalendar(month, signal),
    staleTime: 30_000,
  });
  const recentMonths = Array.from(
    new Set(rounds.map((round) => utcMonthKey(round.endTime))),
  ).sort((left, right) => right.localeCompare(left));
  const monthRounds =
    calendar.data?.rounds ??
    rounds.filter((round) => utcMonthKey(round.endTime) === month);
  const availableMonths = calendar.data?.availableMonths.length
    ? calendar.data.availableMonths
    : recentMonths;
  const visibleRounds = selectedDate
    ? monthRounds.filter((round) => utcDateKey(round.endTime) === selectedDate)
    : [];
  const defaultOpenRoundId =
    visibleRounds.find((round) => round.eligibleWalletCount > 0)?.roundId ??
    visibleRounds.at(0)?.roundId;

  return (
    <section
      className="distribution-ledger"
      aria-labelledby="distribution-ledger-title"
    >
      <header className="distribution-ledger__header">
        <div>
          <span className="prize-pool-kicker">
            <FileCheck2 aria-hidden="true" /> Public evidence
          </span>
          <h2 id="distribution-ledger-title">Distribution ledger</h2>
          <p>
            Every finalized allocation is public and calculated from the same
            published rules. No team member chooses recipients. Wallets link to
            Solscan, and payout links appear only after a real transaction
            signature is recorded.
          </p>
        </div>
        <span className="distribution-ledger__status">
          <i aria-hidden="true" /> Append-only records
        </span>
      </header>

      <div className="distribution-proof-grid">
        <article>
          <Landmark aria-hidden="true" />
          <span>
            <small>Treasury wallet</small>
            <PublicAccountLink address={transparency.treasuryAddress}>
              View on Solscan
            </PublicAccountLink>
          </span>
        </article>
        <article>
          <ReceiptText aria-hidden="true" />
          <span>
            <small>Walletor fee allocation</small>
            <strong>
              {fees?.walletor ?? "Not configured"} ·{" "}
              {formatBasisPoints(
                transparency.prizePoolShareBps +
                  (transparency.feeReserveBps ?? 0),
              )}{" "}
              for active users & influencers
            </strong>
            <small>
              {formatBasisPoints(transparency.prizePoolShareBps)} to Prize Pool
              {transparency.feeReserveBps
                ? ` · ${formatBasisPoints(transparency.feeReserveBps)} reserved for manual influencer payments`
                : ""}
            </small>
          </span>
        </article>
        <article>
          <FileCheck2 aria-hidden="true" />
          <span>
            <small>Total referral fee</small>
            <strong>
              {formatBasisPoints(transparency.referralFeeBps)} total ·{" "}
              {fees?.jupiter ?? "Unavailable"} Jupiter
            </strong>
          </span>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <span>
            <small>Recipient allocation</small>
            <strong>Automatic · no human selection</strong>
          </span>
        </article>
      </div>

      <DistributionCalendar
        month={month}
        availableMonths={availableMonths}
        rounds={monthRounds}
        selectedDate={selectedDate}
        loading={calendar.isLoading}
        unavailable={calendar.isError}
        onMonthChange={(nextMonth) => {
          setMonth(nextMonth);
          setSelectedDate(null);
        }}
        onDateChange={(date) => {
          setSelectedDate(date);
        }}
      />

      {selectedDate ? (
        <div className="distribution-rounds" aria-live="polite">
          {visibleRounds.length ? (
            visibleRounds.map((round) => (
              <DistributionRound
                key={round.roundId}
                round={round}
                defaultOpen={round.roundId === defaultOpenRoundId}
              />
            ))
          ) : calendar.isLoading ? (
            <div className="distribution-ledger__empty">
              <LoaderCircle className="spin" aria-hidden="true" />
              <div>
                <strong>Loading selected distribution</strong>
                <p>Retrieving public evidence for this UTC date.</p>
              </div>
            </div>
          ) : (
            <div className="distribution-ledger__empty">
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>
                  No finalized distribution on {formatDateKey(selectedDate)}
                </strong>
                <p>
                  Solscan payout links appear only after real on-chain
                  transfers.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
