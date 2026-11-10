import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  Users,
  ChefHat,
  Crosshair,
  Ghost,
  Layers,
  PieChart,
  Send,
  ListFilter,
  Pause,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sprout,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LaunchToken } from "../../../shared/launch-contracts";
import { fetchLaunchBoard } from "../../lib/api";
import { formatAge, formatUsd, shortAddress } from "../../lib/format";
import { ConceptPageShell } from "../design-preview-v2/ConceptPageShell";
import { LaunchPrizePoolBar } from "./LaunchPrizePoolBar";
import "./launch-board.css";

const stages = [
  {
    id: "new",
    label: "New",
    description: "Trading on the bonding curve",
    empty: "Waiting for newly observed launches.",
  },
  {
    id: "almost",
    label: "About to graduate",
    description: "Estimated curve progress of 80% or more",
    empty: "No verified candidates are near graduation in this snapshot.",
  },
  {
    id: "migrated",
    label: "Graduate",
    description: "Canonical PumpSwap pool confirmed on Solana",
    empty: "No graduated pools confirmed in the tracked feed yet.",
  },
] as const;
type Stage = (typeof stages)[number]["id"];
interface DisplayOptions {
  price: boolean;
  liquidity: boolean;
  progress: boolean;
}
interface ColumnFilters {
  minMarketCap: string;
  minLiquidity: string;
  maxAgeMinutes: string;
}
const emptyFilters: ColumnFilters = {
  minMarketCap: "",
  minLiquidity: "",
  maxAgeMinutes: "",
};

function matchesSearch(token: LaunchToken, search: string): boolean {
  const terms = search
    .toLowerCase()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  return (
    !terms.length ||
    terms.some((term) =>
      [token.name, token.symbol, token.mint].some((value) =>
        value.toLowerCase().includes(term),
      ),
    )
  );
}
function positiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function compactUsd(value: number | null): string {
  if (value === null || value < 1000) return formatUsd(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactCount(value: number | null | undefined): string {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
}
function percent(value: number | null | undefined): string {
  return value == null
    ? "—"
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}

function TokenSocial({
  href,
  label,
  children,
}: {
  href: string | null | undefined;
  label: string;
  children: ReactNode;
}) {
  if (!href)
    return (
      <span
        className="launch-social is-unavailable"
        title={`${label} unavailable`}
        aria-label={`${label} unavailable`}
      >
        {children}
      </span>
    );
  return (
    <a
      className="launch-social"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
    >
      {children}
    </a>
  );
}

function TokenRiskDetails({ token }: { token: LaunchToken }) {
  const metrics = [
    {
      label: "Top 10 holdings",
      short: "Top 10",
      Icon: PieChart,
      value: token.top10HoldingPercent,
    },
    {
      label: "Developer holdings",
      short: "Dev",
      Icon: ChefHat,
      value: token.developerHoldingPercent,
    },
    {
      label: "Sniper holdings",
      short: "Sniper",
      Icon: Crosshair,
      value: token.sniperHoldingPercent,
    },
    {
      label: "Insider holdings",
      short: "Insider",
      Icon: Ghost,
      value: token.insiderHoldingPercent,
    },
    {
      label: "Bundled holdings",
      short: "Bundle",
      Icon: Layers,
      value: token.bundledHoldingPercent,
    },
  ];
  return (
    <div
      className="launch-risk-details"
      aria-label={`${token.symbol} token details`}
    >
      {metrics.map(({ label, short, Icon, value }) => (
        <span
          key={label}
          className={value == null ? "is-unavailable" : ""}
          title={`${label}: ${value == null ? "unavailable in current data" : percent(value)}`}
          aria-label={`${label}: ${percent(value)}`}
        >
          <Icon size={12} aria-hidden="true" />
          <small>{short}</small>
          <b>{percent(value)}</b>
        </span>
      ))}
      <span
        className={token.dexScreenerPaid == null ? "is-unavailable" : ""}
        title="Dex Screener paid listing status"
        aria-label={`Dex Screener paid: ${token.dexScreenerPaid == null ? "unavailable" : token.dexScreenerPaid ? "yes" : "no"}`}
      >
        <small>DS</small>
        <b>
          {token.dexScreenerPaid == null
            ? "—"
            : token.dexScreenerPaid
              ? "Paid"
              : "No"}
        </b>
      </span>
    </div>
  );
}

export function LaunchBoardPage() {
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<Stage>("new");
  const [display, setDisplay] = useState<DisplayOptions>({
    price: true,
    liquidity: true,
    progress: true,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const query = useQuery({
    queryKey: ["launch-board"],
    queryFn: ({ signal }) => fetchLaunchBoard(signal),
    refetchInterval: paused ? false : 10000,
    refetchIntervalInBackground: false,
    staleTime: 10000,
  });
  const data = query.data;
  const tokens = data?.tokens ?? [];
  const stale = data && now - Date.parse(data.checkedAt) > 60000;
  const connected = data?.feedConnected && !paused && !stale && !query.isError;
  return (
    <ConceptPageShell className="launch-board-page">
      <section className="launch-heading">
        <div className="launch-title">
          <Sprout size={20} aria-hidden="true" />
          <h1>Trenches</h1>
          <span className="launch-network">
            <img src="/assets/solana-logo.svg" alt="" /> Solana
          </span>
        </div>
        <LaunchPrizePoolBar now={now} />
        <div className="launch-controls">
          <span className={`launch-status ${connected ? "is-connected" : ""}`}>
            <i />
            {paused
              ? "Paused"
              : query.isError
                ? "Connection interrupted"
                : stale
                  ? "Data delayed"
                  : data?.feedConnected
                    ? "Feed connected"
                    : "Connecting feed"}
          </span>
          <button
            type="button"
            onClick={() => {
              setPaused((value) => !value);
            }}
            aria-label={paused ? "Resume live updates" : "Pause live updates"}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            aria-label="Refresh launches"
          >
            <RefreshCw size={15} />
          </button>
          <details className="launch-display">
            <summary>
              <SlidersHorizontal size={15} /> Display <ChevronDown size={13} />
            </summary>
            <fieldset>
              <legend>Token details</legend>
              {(
                [
                  { key: "price", label: "Price" },
                  { key: "liquidity", label: "Liquidity" },
                  { key: "progress", label: "Curve progress" },
                ] as const
              ).map((option) => (
                <label key={option.key}>
                  <input
                    type="checkbox"
                    checked={display[option.key]}
                    onChange={(event) => {
                      setDisplay((value) => ({
                        ...value,
                        [option.key]: event.target.checked,
                      }));
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          </details>
        </div>
      </section>
      <div className="launch-toolbar">
        <p className="launch-context">
          Pump.fun <span>·</span> Updates every 10s <span>·</span> Wallet-signed
          swaps
        </p>
      </div>
      {query.isError && (
        <div role="alert" className="launch-notice">
          Launch data is temporarily unavailable.
          {data ? " Showing the last snapshot." : " Try refreshing shortly."}
        </div>
      )}
      {data && !data.chainAvailable && (
        <p role="status" className="launch-notice">
          Onchain stage checks are delayed. Unconfirmed tokens appear below.
        </p>
      )}
      <div
        className="launch-mobile-tabs"
        role="group"
        aria-label="Launch stage"
      >
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            aria-pressed={active === stage.id}
            onClick={() => {
              setActive(stage.id);
            }}
          >
            {stage.label}
            <span>
              {tokens.filter((token) => token.stage === stage.id).length}
            </span>
          </button>
        ))}
      </div>
      <div className="launch-columns">
        {stages.map((stage) => (
          <LaunchColumn
            key={stage.id}
            stage={stage}
            tokens={tokens.filter((token) => token.stage === stage.id)}
            active={active === stage.id}
            now={now}
            display={display}
            pending={query.isPending}
            error={query.isError}
            discoveryUnavailable={
              stage.id === "almost" && data?.discoveryAvailable === false
            }
          />
        ))}
      </div>
      {data && (
        <div className="launch-footnote">
          <span>
            Checked{" "}
            {new Date(data.checkedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      )}
    </ConceptPageShell>
  );
}

function LaunchColumn({
  stage,
  tokens,
  active,
  now,
  display,
  pending,
  error,
  discoveryUnavailable,
}: {
  stage: (typeof stages)[number];
  tokens: LaunchToken[];
  active: boolean;
  now: number;
  display: DisplayOptions;
  pending: boolean;
  error: boolean;
  discoveryUnavailable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>(emptyFilters);
  const minCap = positiveNumber(filters.minMarketCap);
  const minLiquidity = positiveNumber(filters.minLiquidity);
  const maxAge = positiveNumber(filters.maxAgeMinutes);
  const filterCount = [minCap, minLiquidity, maxAge].filter(Boolean).length;
  const filtered = tokens.filter(
    (token) =>
      matchesSearch(token, search) &&
      (!minCap ||
        (token.marketCapUsd !== null && token.marketCapUsd >= minCap)) &&
      (!minLiquidity ||
        (token.liquidityUsd !== null && token.liquidityUsd >= minLiquidity)) &&
      (!maxAge || now - Date.parse(token.observedAt) <= maxAge * 60000),
  );
  return (
    <section
      className={`launch-column launch-column--${stage.id} ${active ? "is-mobile-active" : ""}`}
      aria-label={stage.label}
    >
      <header>
        <h2 title={stage.description}>
          <span className="launch-stage-dot" />
          {stage.label}
          <b>{filtered.length}</b>
        </h2>
        <label className="launch-column-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            aria-label={`Search ${stage.label} tokens`}
            placeholder="Keyword1, Keyword2"
          />
        </label>
        <details
          className={`launch-filter ${filterCount ? "has-filters" : ""}`}
        >
          <summary
            aria-label={`Filter ${stage.label} tokens`}
            title={`Filter ${stage.label} tokens`}
          >
            <ListFilter size={16} />
            {filterCount > 0 && <i />}
          </summary>
          <div className="launch-filter-panel">
            <strong>{stage.label} filters</strong>
            {(
              [
                {
                  key: "minMarketCap",
                  label: "Minimum market cap",
                  suffix: "USD",
                },
                {
                  key: "minLiquidity",
                  label: "Minimum liquidity",
                  suffix: "USD",
                },
                {
                  key: "maxAgeMinutes",
                  label: "Maximum age",
                  suffix: "minutes",
                },
              ] as const
            ).map((option) => (
              <label key={option.key}>
                {option.label} <small>{option.suffix}</small>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  aria-label={`${option.label} for ${stage.label}`}
                  value={filters[option.key]}
                  placeholder="Any"
                  onChange={(event) => {
                    setFilters((value) => ({
                      ...value,
                      [option.key]: event.target.value,
                    }));
                  }}
                />
              </label>
            ))}
            <p>
              Unknown values are excluded when a minimum is set. Age is measured
              from first observed.
            </p>
            <button
              type="button"
              aria-label={`Reset ${stage.label} filters`}
              onClick={() => {
                setFilters(emptyFilters);
              }}
            >
              Reset filters
            </button>
          </div>
        </details>
      </header>
      <div className="launch-cards">
        {pending ? (
          <p className="launch-empty" role="status">
            Connecting to the launch feed…
          </p>
        ) : filtered.length ? (
          filtered.map((token) => (
            <LaunchCard key={token.mint} token={token} display={display} />
          ))
        ) : (
          <div className="launch-empty">
            <Sprout size={22} aria-hidden="true" />
            <p>
              {search || filterCount
                ? "No matches in this stage."
                : error
                  ? "Launch feed unavailable. Use Refresh to retry."
                  : discoveryUnavailable
                    ? "Near-graduation discovery is temporarily unavailable."
                    : stage.empty}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function LaunchSwapAction({ mint, symbol }: { mint: string; symbol: string }) {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const connected = wallet.connected && wallet.publicKey !== null;
  return (
    <Link
      className="launch-swap"
      to={`/?outputMint=${encodeURIComponent(mint)}`}
      aria-label={
        connected ? `Swap ${symbol}` : `Connect wallet to swap ${symbol}`
      }
      aria-haspopup={connected ? undefined : "dialog"}
      onClick={(event) => {
        if (
          connected ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        // Keep the requested mint in the destination URL while the shared
        // wallet picker connects. Clear only a disconnected/stale selection.
        wallet.select(null);
        setVisible(true);
      }}
    >
      {connected ? "Swap" : "Connect wallet"}{" "}
      <ArrowUpRight size={12} aria-hidden="true" />
    </Link>
  );
}

function LaunchCard({
  token,
  display,
}: {
  token: LaunchToken;
  display: DisplayOptions;
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const details = `/tokens/${encodeURIComponent(token.mint)}`;
  async function copyMint() {
    try {
      await navigator.clipboard.writeText(token.mint);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <article className={`launch-card launch-card--${token.stage}`}>
      <div className="launch-card-body">
        <div className="launch-token-art">
          <Link
            to={details}
            className="launch-avatar"
            aria-label={`Open ${token.symbol} trading page`}
          >
            {token.logoUrl && token.logoUrl !== failedImageUrl ? (
              <img
                src={token.logoUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => {
                  setFailedImageUrl(token.logoUrl);
                }}
              />
            ) : (
              <span>{token.symbol.slice(0, 2).toUpperCase()}</span>
            )}
            <img
              className="launch-chain-icon"
              src="/assets/solana-logo.svg"
              alt="Solana"
            />
          </Link>
          <button
            type="button"
            className="launch-mint"
            aria-label={`Copy ${token.symbol} mint address`}
            onClick={() => void copyMint()}
            title={token.mint}
          >
            {shortAddress(token.mint)}
            {copyState === "copied" ? <Check size={10} /> : <Copy size={10} />}
          </button>
          <span
            className="launch-holder-count"
            title="Holder count"
            aria-label={`${token.symbol} holders: ${compactCount(token.holders)}`}
          >
            <Users size={9} aria-hidden="true" />
            {compactCount(token.holders)}
          </span>
        </div>
        <div className="launch-token-name">
          <div className="launch-token-title">
            <Link to={details}>{token.symbol}</Link>
            <span title={token.name}>{token.name}</span>
          </div>
          <div className="launch-token-meta">
            <span
              className="launch-age"
              title={`First observed ${token.observedAt}`}
            >
              {formatAge(token.observedAt)}
            </span>
            <span className="launch-source">
              {token.stage === "migrated" ? "PumpSwap" : "Pump.fun"}
            </span>
            <span
              className="launch-tax"
              title="Verified trading tax; unavailable values are unknown"
            >
              Tax {percent(token.taxPercent)}
            </span>
            <TokenSocial
              href={token.websiteUrl}
              label={`${token.symbol} website`}
            >
              <Globe size={12} />
            </TokenSocial>
            <TokenSocial
              href={token.twitterUrl}
              label={`${token.symbol} X account`}
            >
              <span aria-hidden="true">𝕏</span>
            </TokenSocial>
            <TokenSocial
              href={token.telegramUrl}
              label={`${token.symbol} Telegram`}
            >
              <Send size={12} />
            </TokenSocial>
            <a
              href={`https://solscan.io/token/${token.mint}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${token.symbol} mint ${token.mint} on Solscan`}
            >
              <ExternalLink size={12} />
            </a>
          </div>
          {token.twitterUrl && (
            <a
              className="launch-twitter-handle"
              href={token.twitterUrl}
              target="_blank"
              rel="noreferrer"
            >
              @
              {new URL(token.twitterUrl).pathname.split("/").find(Boolean) ??
                "X"}
            </a>
          )}
          {display.progress && token.progressPercent !== null && (
            <div
              className="launch-progress"
              title={
                token.stage === "migrated"
                  ? "PumpSwap pool confirmed"
                  : "Estimated bonding curve progress"
              }
            >
              <progress
                max={100}
                value={token.progressPercent}
                aria-label={`${token.symbol} estimated curve progress`}
              />
              <span>{token.progressPercent.toFixed(0)}%</span>
            </div>
          )}
        </div>
        <dl
          className="launch-metrics"
          title={
            token.marketCheckedAt
              ? `Market data checked ${new Date(token.marketCheckedAt).toLocaleTimeString()}`
              : "Market data not yet available"
          }
        >
          <div>
            <dt title="Market cap">MC</dt>
            <dd className="launch-market-cap">
              {compactUsd(token.marketCapUsd)}
            </dd>
          </div>
          <div>
            <dt title="24-hour volume">V</dt>
            <dd>{compactUsd(token.volume24hUsd)}</dd>
          </div>
          <div className="launch-fee-trades">
            <span title="Recorded trading fees in SOL">
              F <img src="/assets/solana-logo.svg" alt="SOL" />{" "}
              {token.feesSol == null
                ? "—"
                : new Intl.NumberFormat("en-US", {
                    maximumFractionDigits: 6,
                  }).format(token.feesSol)}
            </span>
            <span title="Transactions over 24 hours">
              TX {compactCount(token.transactions24h)}
            </span>
          </div>
          {token.buys24h != null &&
            token.sells24h != null &&
            token.buys24h + token.sells24h > 0 && (
              <div
                className="launch-trade-balance"
                title={`${String(token.buys24h)} buys · ${String(token.sells24h)} sells in 24h`}
                aria-label={`${String(token.buys24h)} buys and ${String(token.sells24h)} sells in 24 hours`}
              >
                <span
                  style={{
                    width: `${String((token.buys24h / (token.buys24h + token.sells24h)) * 100)}%`,
                  }}
                />
              </div>
            )}
        </dl>
      </div>
      <TokenRiskDetails token={token} />
      <div className="launch-card-bottom">
        <div className="launch-data-chips">
          {display.liquidity && (
            <span title="Liquidity in USD">
              <small>Liq</small>
              {compactUsd(token.liquidityUsd)}
            </span>
          )}
          {display.price && (
            <span
              aria-label={`${token.symbol} price`}
              title="Token price in USD"
            >
              <small>Price</small>
              {formatUsd(token.priceUsd)}
            </span>
          )}
        </div>
        <LaunchSwapAction mint={token.mint} symbol={token.symbol} />
      </div>
      {copyState !== "idle" && (
        <span className="launch-copy-status" role="status">
          {copyState === "copied"
            ? "Mint copied"
            : "Copy unavailable. Open the explorer to copy the address."}
        </span>
      )}
    </article>
  );
}
