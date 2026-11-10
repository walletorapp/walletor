import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  Coins,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  LeaderboardResponseSchema,
  WinnersResponseSchema,
  type Winner,
} from "../../../shared/leaderboard-contracts";
import { ConceptPageShell } from "../design-preview-v2/ConceptPageShell";
import { formatUsdMicroUsd } from "../prize-pool/presentation";
import "./leaderboard.css";

async function fetchRecords(
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, { signal });
  if (!response.ok)
    throw new Error("Records are temporarily unavailable. Please try again.");
  return response.json();
}
const short = (wallet: string) => `${wallet.slice(0, 5)}…${wallet.slice(-5)}`;
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(date)) + " UTC";
const numberLabel = (value: string) => BigInt(value).toLocaleString("en-US");

function WalletLabel({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="board-wallet">
      <a
        href={`https://solscan.io/account/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        title={address}
      >
        {short(address)}
      </a>
      <button
        type="button"
        aria-label={`Copy wallet ${address}`}
        onClick={() => {
          void navigator.clipboard.writeText(address).then(
            () => {
              setCopied(true);
              setError(false);
            },
            () => {
              setError(true);
            },
          );
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {error && <small role="status">Copy unavailable</small>}
    </span>
  );
}
function EvidenceLink({
  signature,
  children,
}: {
  signature: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`https://solscan.io/tx/${signature}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
function WinnerCard({ winner, yours }: { winner: Winner; yours: boolean }) {
  const status = {
    CLAIMED: "Claimed",
    CLAIMABLE: "Ready to claim",
    EXPIRED: "Expired",
    PENDING: "Activation pending",
  }[winner.status];
  const message = `I won ${formatUsdMicroUsd(winner.netAmountAtomic)} USDC on Walletor! https://walletor.com/leaderboard`;
  return (
    <article className={`board-winner ${yours ? "is-yours" : ""}`}>
      <div className="board-winner-main">
        <span className="board-medal">
          <Trophy size={20} />
        </span>
        <div>
          <WalletLabel address={winner.walletAddress} />
          <small>
            {yours ? "Your wallet · " : ""}Winner #{winner.rank}
          </small>
        </div>
        <div className="board-prize">
          <strong>{formatUsdMicroUsd(winner.netAmountAtomic)}</strong>
          <small>USDC after claim fee</small>
        </div>
        <span
          className={`board-status board-status--${winner.status.toLowerCase()}`}
        >
          {status}
        </span>
      </div>
      <div className="board-winner-meta">
        <span>{dateLabel(winner.date)}</span>
        <span>Round pool: {formatUsdMicroUsd(winner.poolAmountAtomic)}</span>
        {winner.claimSignature && (
          <EvidenceLink signature={winner.claimSignature}>
            View claim
          </EvidenceLink>
        )}
        {yours && winner.status === "CLAIMABLE" && (
          <Link to="/claim-rewards">
            Claim your prize <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      <details className="board-evidence">
        <summary>
          <ShieldCheck size={15} /> Verify draw{" "}
          <span>{winner.randomnessProvider}</span>
        </summary>
        <div>
          <p>Funded distribution · {winner.randomnessProvider} randomness</p>
          <nav aria-label={`Evidence for ${winner.roundId}`}>
            <EvidenceLink signature={winner.requestSignature}>
              Randomness request
            </EvidenceLink>
            <EvidenceLink signature={winner.revealSignature}>
              Randomness result
            </EvidenceLink>
            <EvidenceLink signature={winner.fundingSignature}>
              USDC funding
            </EvidenceLink>
            <a
              href={`https://solscan.io/account/${winner.randomnessAccount}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Randomness account ↗
            </a>
            <a
              href={`/api/prize-pool/draws/${encodeURIComponent(winner.roundId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Locked snapshot ↗
            </a>
            <a
              href="https://docs.walletor.com/prize-pool/how-we-pick-winners/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Selection rules ↗
            </a>
          </nav>
          <p>Claim deadline: {dateLabel(winner.deadline)}</p>
          <p>
            Round <code>{winner.roundId}</code>
          </p>
          <p>
            Claim Merkle root <code>{winner.merkleRoot}</code>
          </p>
        </div>
      </details>
      {yours && (
        <div className="board-share">
          <span>Share your win</span>
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            X ↗
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp ↗
          </a>
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent("https://walletor.com/leaderboard")}&text=${encodeURIComponent(`I won ${formatUsdMicroUsd(winner.netAmountAtomic)} USDC on Walletor!`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram ↗
          </a>
        </div>
      )}
    </article>
  );
}

function Pagination({
  offset,
  nextOffset,
  total,
  onChange,
}: {
  offset: number;
  nextOffset: number | null;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (!total) return null;
  return (
    <nav className="board-pagination" aria-label="Results pages">
      <button
        disabled={offset === 0}
        onClick={() => {
          onChange(Math.max(0, offset - 25));
        }}
      >
        Previous
      </button>
      <span>
        {offset + 1}–{Math.min(offset + 25, total)} of {total}
      </span>
      <button
        disabled={nextOffset === null}
        onClick={() => {
          if (nextOffset !== null) onChange(nextOffset);
        }}
      >
        Next
      </button>
    </nav>
  );
}

export function LeaderboardPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const [tab, setTab] = useState<"winners" | "rankings">("winners");
  const [period, setPeriod] = useState<"all" | "round">("all");
  const [offset, setOffset] = useState(0);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState("");
  const params = new URLSearchParams({
    period,
    offset: String(offset),
    search,
    ...(wallet ? { wallet } : {}),
  });
  const winners = useQuery({
    queryKey: [
      "public-winners",
      tab === "winners" ? offset : 0,
      tab === "winners" ? search : "",
    ],
    queryFn: async ({ signal }) =>
      WinnersResponseSchema.parse(
        await fetchRecords(
          `/api/leaderboard/winners?${new URLSearchParams({ offset: String(tab === "winners" ? offset : 0), search: tab === "winners" ? search : "" })}`,
          signal,
        ),
      ),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const rankings = useQuery({
    queryKey: ["public-rankings", period, offset, search, wallet],
    queryFn: async ({ signal }) =>
      LeaderboardResponseSchema.parse(
        await fetchRecords(`/api/leaderboard/rankings?${params}`, signal),
      ),
    enabled: tab === "rankings",
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const active = tab === "winners" ? winners : rankings;
  const stats = winners.data?.totals;
  const position = rankings.data?.yourPosition;
  return (
    <ConceptPageShell mainClassName="leaderboard-main">
      <section className="board-hero">
        <span className="board-eyebrow">
          <ShieldCheck size={16} /> REAL ACTIVITY. PUBLIC RESULTS.
        </span>
        <h1>
          Leaderboard <span>& Winners</span>
        </h1>
        <p>
          The wallets earning rewards. The prizes going back to the community.
        </p>
        <Link to="/claim-rewards" className="board-claim-link">
          Check your rewards <ArrowUpRight size={17} />
        </Link>
      </section>
      <div className="board-stats">
        <article>
          <Coins />
          <span>USDC claimed</span>
          <strong>
            {stats ? formatUsdMicroUsd(stats.claimedAtomic) : "—"}
          </strong>
          <small>
            {stats
              ? `${formatUsdMicroUsd(stats.awardedAtomic)} awarded after claim fees`
              : "Loading verified records"}
          </small>
        </article>
        <article>
          <Users />
          <span>Winning wallets</span>
          <strong>{stats ? stats.winningWallets.toLocaleString() : "—"}</strong>
          <small>Unique wallets awarded a prize</small>
        </article>
        <article>
          <Trophy />
          <span>Funded draws</span>
          <strong>{stats ? stats.fundedDraws.toLocaleString() : "—"}</strong>
          <small>Verified USDC distributions</small>
        </article>
      </div>
      <section className="board-results">
        <div className="board-toolbar">
          <div role="group" aria-label="View results" className="board-tabs">
            <button
              aria-pressed={tab === "winners"}
              onClick={() => {
                setTab("winners");
                setOffset(0);
              }}
            >
              Winners
            </button>
            <button
              aria-pressed={tab === "rankings"}
              onClick={() => {
                setTab("rankings");
                setOffset(0);
              }}
            >
              Leaderboard
            </button>
          </div>
          <form
            className="board-search"
            onSubmit={(event) => {
              event.preventDefault();
              const value = input.trim();
              if (!/^[1-9A-HJ-NP-Za-km-z]{0,44}$/.test(value)) {
                setSearchError("Enter a wallet address or part of one.");
                return;
              }
              setSearchError("");
              setSearch(value);
              setOffset(0);
            }}
          >
            <label className="sr-only" htmlFor="board-search">
              Search wallet
            </label>
            <input
              id="board-search"
              placeholder="Search a wallet…"
              maxLength={44}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
              }}
            />
            <button aria-label="Search wallets">
              <Search size={18} />
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setInput("");
                  setSearchError("");
                  setOffset(0);
                }}
              >
                Clear
              </button>
            )}
          </form>
        </div>
        {searchError && <p role="alert">{searchError}</p>}
        {tab === "winners" ? (
          <div className="board-section-heading">
            <h2>Winners history</h2>
            <p>
              Funded rounds, newest first. Claim records can take a moment to
              sync.
            </p>
          </div>
        ) : (
          <>
            <div className="board-section-heading">
              <h2>WLT points leaderboard</h2>
              <p>
                Ranked by verified WLT points. Rankings do not guarantee prizes.
                Equal points share a rank.
              </p>
            </div>
            <div
              className="board-filters"
              role="group"
              aria-label="Ranking period"
            >
              <button
                aria-pressed={period === "all"}
                onClick={() => {
                  setPeriod("all");
                  setOffset(0);
                }}
              >
                All time
              </button>
              <button
                aria-pressed={period === "round"}
                onClick={() => {
                  setPeriod("round");
                  setOffset(0);
                }}
              >
                This round
              </button>
            </div>
            {wallet && (
              <div className="board-position">
                <span>Your position</span>
                <strong>
                  {rankings.isPending
                    ? "Loading…"
                    : rankings.isError
                      ? "Temporarily unavailable"
                      : position
                        ? `#${String(position.rank)} · ${numberLabel(position.points)} WLT points`
                        : "No points recorded for this period yet"}
                </strong>
                <WalletLabel address={wallet} />
              </div>
            )}
            {!wallet && (
              <p className="board-note">
                Connect your wallet using the wallet button to see your
                position.
              </p>
            )}
          </>
        )}
        {active.isError ? (
          <div className="board-empty" role="alert">
            <h3>Couldn’t load these records</h3>
            <p>Your rewards haven’t changed. Please try again.</p>
            <button
              onClick={() => {
                void active.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : active.isPending ? (
          <div className="board-empty" role="status">
            Loading verified records…
          </div>
        ) : (
          <>
            {tab === "winners" &&
              winners.data &&
              (winners.data.entries.length ? (
                <div className="board-winners">
                  {winners.data.entries.map((entry) => (
                    <WinnerCard
                      key={entry.id}
                      winner={entry}
                      yours={entry.walletAddress === wallet}
                    />
                  ))}
                </div>
              ) : (
                <div className="board-empty">
                  <Trophy />
                  <h3>
                    {search
                      ? "No matching winners"
                      : "The next winners belong here"}
                  </h3>
                  <p>
                    {search
                      ? "Try another wallet address."
                      : "Verified funded prizes will appear here once a draw is ready."}
                  </p>
                </div>
              ))}
            {tab === "rankings" &&
              rankings.data &&
              (rankings.data.entries.length ? (
                <div className="board-table-wrap">
                  <table>
                    <caption className="sr-only">
                      Wallet rankings by WLT points
                    </caption>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Wallet</th>
                        <th>Qualified swaps</th>
                        <th>WLT points</th>
                        <th>USDC won · all time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankings.data.entries.map((entry) => (
                        <tr
                          key={entry.walletAddress}
                          className={
                            entry.walletAddress === wallet ? "is-yours" : ""
                          }
                        >
                          <td>
                            <span
                              className={
                                entry.rank <= 3 ? "board-top-rank" : ""
                              }
                            >
                              #{entry.rank}
                            </span>
                          </td>
                          <td>
                            <WalletLabel address={entry.walletAddress} />
                            {entry.walletAddress === wallet && (
                              <small> You</small>
                            )}
                          </td>
                          <td>{entry.eligibleSwaps.toLocaleString()}</td>
                          <td className="board-points">
                            {numberLabel(entry.points)}
                          </td>
                          <td>{formatUsdMicroUsd(entry.totalWonAtomic)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="board-empty">
                  <h3>
                    {search
                      ? "No matching wallets"
                      : "Be part of the first rankings"}
                  </h3>
                  <p>Eligible activity earns WLT points and a place here.</p>
                  <Link to="/">Start swapping ↗</Link>
                </div>
              ))}
            <Pagination {...active.data.pagination} onChange={setOffset} />
          </>
        )}
        <p className="board-note">
          WLT points are reward points, not transferable tokens. Prize values
          are net USDC awards; claimed totals include recorded confirmed claims.
          History follows Walletor’s public-launch records.
        </p>
        {active.data && (
          <p className="board-updated">
            Updated {dateLabel(active.data.serverTime)}
          </p>
        )}
      </section>
    </ConceptPageShell>
  );
}

export function RecentWinners() {
  const query = useQuery({
    queryKey: ["public-winners", 0, ""],
    queryFn: async ({ signal }) =>
      WinnersResponseSchema.parse(
        await fetchRecords("/api/leaderboard/winners", signal),
      ),
    staleTime: 15_000,
  });
  return (
    <section className="board-recent">
      <div>
        <span className="board-eyebrow">COMMUNITY REWARDS</span>
        <h2>Recent winners</h2>
      </div>
      {query.isPending ? (
        <p>Loading winners…</p>
      ) : query.isError ? (
        <p>Winner records are temporarily unavailable.</p>
      ) : query.data.entries.length ? (
        <ul>
          {query.data.entries.slice(0, 3).map((entry) => (
            <li key={entry.id}>
              <WalletLabel address={entry.walletAddress} />
              <strong>{formatUsdMicroUsd(entry.netAmountAtomic)} USDC</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>Funded winners will appear here after the next verified draw.</p>
      )}
      <Link to="/leaderboard">
        View leaderboard & winners <ArrowUpRight size={17} />
      </Link>
    </section>
  );
}
