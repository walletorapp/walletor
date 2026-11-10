import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ArrowLeft, ArrowUpRight, Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { TokenDetail } from "../../../shared/contracts";
import type { LaunchToken } from "../../../shared/launch-contracts";
import { TokenAvatar } from "../../components/TokenAvatar";
import {
  fetchLaunchBoard,
  fetchTokenChartMarket,
  searchSwapTokens,
} from "../../lib/api";
import { formatCount, formatUsd, shortAddress } from "../../lib/format";
import { SwapPage } from "../swap/SwapPage";
import { Change } from "./TokenTable";
import { useToken } from "./useTokens";
import "./token-trading.css";

export function TokenTradingPage() {
  const { address = "" } = useParams();
  try {
    new PublicKey(address);
  } catch {
    return (
      <section className="token-terminal">
        <Link className="back-link" to="/trenches">
          Back to Trenches
        </Link>
        <h1>Invalid token address</h1>
        <p>
          Choose a token from Trenches or search using its Solana mint address.
        </p>
      </section>
    );
  }
  return <TokenTerminal key={address} address={address} />;
}

function TokenTerminal({ address }: { address: string }) {
  const result = useToken(address);
  const market = useQuery({
    queryKey: ["tokens", "chart-market", address],
    queryFn: ({ signal }) => fetchTokenChartMarket(address, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const launches = useQuery({
    queryKey: ["launch-board"],
    queryFn: ({ signal }) => fetchLaunchBoard(signal),
    enabled: result.isError,
    staleTime: 10_000,
    refetchInterval: result.isError ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
  const checks = useQuery({
    queryKey: ["tokens", "controls", address],
    queryFn: async ({ signal }) => {
      const tokens = await searchSwapTokens(address, signal);
      return tokens.find((token) => token.address === address) ?? null;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const launch = launches.data?.tokens.find((token) => token.mint === address);
  const token = result.data ?? (launch ? fromLaunch(launch) : null);
  const currentChecks = checks.isError ? null : checks.data;
  const symbol = token?.symbol ?? shortAddress(address);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [showTrades, setShowTrades] = useState(true);
  const chartPair =
    market.data?.mint === address ? market.data.pairAddress : null;
  const chartBaseUrl = chartPair
    ? `https://dexscreener.com/solana/${encodeURIComponent(chartPair)}`
    : `https://dexscreener.com/search?q=${encodeURIComponent(address)}`;
  const chartUrl = `${chartBaseUrl}?embed=1&theme=dark&trades=${showTrades ? "1" : "0"}&info=0`;

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="token-terminal" aria-label="Token trading terminal">
      <div className="token-terminal-topline">
        <Link className="back-link" to="/trenches">
          <ArrowLeft size={14} /> Trenches
        </Link>
        <a className="token-trade-jump" href="#token-trade">
          Trade <ArrowUpRight size={14} />
        </a>
      </div>
      <header className="token-terminal-heading">
        <div className="token-terminal-identity">
          <TokenAvatar
            logoUrl={token?.logoUrl ?? null}
            symbol={symbol}
            size="lg"
          />
          <div>
            <p className="eyebrow">Solana · Token market</p>
            <h1>{symbol}</h1>
            <span>
              {token?.name ??
                (result.isError
                  ? "Token details unavailable"
                  : "Loading token details…")}
            </span>
          </div>
        </div>
        <div className="token-terminal-heading-actions">
          <button
            className="address-button"
            onClick={() => void copyMint()}
            aria-label="Copy token mint"
          >
            {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
            <code>{shortAddress(address)}</code>
          </button>
          <button
            className="icon-button"
            aria-label="Refresh token"
            disabled={result.isFetching}
            onClick={() => {
              void result.refetch();
              void checks.refetch();
              void market.refetch();
            }}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>
      {copyState !== "idle" && (
        <p role="status">
          {copyState === "copied"
            ? "Mint address copied."
            : "Could not copy the mint address. Select it below."}
        </p>
      )}
      <div className="token-terminal-layout">
        <div className="token-terminal-market">
          <section
            className="token-terminal-chart"
            aria-label="Market chart and recent trades"
          >
            <header>
              <div className="token-chart-controls" aria-label="Chart display">
                <button
                  aria-pressed={!showTrades}
                  onClick={() => {
                    setShowTrades(false);
                  }}
                >
                  Chart
                </button>
                <button
                  aria-pressed={showTrades}
                  onClick={() => {
                    setShowTrades(true);
                  }}
                >
                  Chart & trades
                </button>
              </div>
              <a href={chartBaseUrl} target="_blank" rel="noreferrer">
                Dexscreener <ArrowUpRight size={12} />
              </a>
            </header>
            {chartPair ? (
              <iframe
                key={chartUrl}
                src={chartUrl}
                title={`${symbol} market chart on Dexscreener`}
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="token-chart-empty" role="status">
                <strong>
                  {market.isPending
                    ? "Finding this token’s chart…"
                    : market.isError
                      ? "Chart market is temporarily unavailable"
                      : "No chart market found yet"}
                </strong>
                <span>
                  {market.isPending
                    ? "Matching the token to its trading pool."
                    : "Use Refresh token to check again. You can still review token details and check a swap quote below."}
                </span>
              </div>
            )}
            <p>
              Chart and recent trades provided by Dexscreener. Newly launched
              tokens may not have a chart yet.
            </p>
          </section>
          <section
            className="token-terminal-panel"
            aria-labelledby="token-activity-title"
          >
            <h2 id="token-activity-title">
              Market activity <span>24h</span>
            </h2>
            <div className="token-activity-grid">
              <Metric
                label="Volume"
                value={formatUsd(token?.volume24hUsd ?? null)}
              />
              <Metric
                label="Transactions"
                value={formatCount(token?.trades24h ?? null)}
              />
              <Metric
                label="Buys"
                value={formatCount(token?.buys24h ?? null)}
              />
              <Metric
                label="Sells"
                value={formatCount(token?.sells24h ?? null)}
              />
              <Metric
                label="Holders"
                value={formatCount(token?.holders ?? null)}
              />
              <Metric
                label="Unique traders"
                value={formatCount(token?.uniqueWallets24h ?? null)}
              />
            </div>
          </section>
          <section
            className="token-terminal-panel"
            aria-labelledby="token-controls-title"
          >
            <h2 id="token-controls-title">Token controls</h2>
            <div className="token-control-rows">
              <Metric
                label="Mint authority"
                value={authority(currentChecks?.mintAuthorityDisabled)}
              />
              <Metric
                label="Freeze authority"
                value={authority(currentChecks?.freezeAuthorityDisabled)}
              />
              <Metric
                label="Top holders"
                value={
                  currentChecks?.topHoldersPercent == null
                    ? "—"
                    : `${currentChecks.topHoldersPercent.toFixed(2)}%`
                }
              />
            </div>
            <p>
              Provider-reported token controls. Missing data is unknown; these
              checks do not establish that a token is safe.
            </p>
          </section>
        </div>
        <aside className="token-terminal-side">
          <section
            className="token-terminal-panel"
            aria-labelledby="token-overview-title"
          >
            <h2 id="token-overview-title">Overview</h2>
            <div className="token-overview-grid">
              <Metric
                label="Price USD"
                value={formatUsd(token?.priceUsd ?? null)}
              />
              <Metric
                label="Market cap"
                value={formatUsd(token?.marketCapUsd ?? null)}
              />
              <Metric
                label="Liquidity"
                value={formatUsd(token?.liquidityUsd ?? null)}
              />
              <Metric
                label="Holders"
                value={formatCount(token?.holders ?? null)}
              />
            </div>
            <div className="token-price-changes">
              <span>
                1h <Change value={token?.priceChange1hPercent ?? null} />
              </span>
              <span>
                24h <Change value={token?.priceChange24hPercent ?? null} />
              </span>
            </div>
            {result.isPending ? (
              <p role="status">Loading market data…</p>
            ) : result.isError ? (
              <p role="status">
                {result.data
                  ? `Market refresh unavailable. Last received ${new Date(result.dataUpdatedAt).toLocaleTimeString()}.`
                  : launch
                    ? "Showing available Trenches data."
                    : "Token market data is currently unavailable."}
              </p>
            ) : (
              <p>
                Jupiter snapshot received{" "}
                {new Date(result.dataUpdatedAt).toLocaleTimeString()}. Refreshes
                every 45 seconds.
              </p>
            )}
          </section>
          <section
            id="token-trade"
            className="token-terminal-trade concept-trade--live"
            aria-label={`Trade ${symbol}`}
          >
            <h2>
              Trade <span>{symbol}</span>
            </h2>
            <SwapPage embeddedConcept initialOutputMint={address} />
          </section>
          <section className="token-terminal-panel token-terminal-address">
            <h2>Token address</h2>
            <code>{address}</code>
            <a
              href={`https://solscan.io/token/${encodeURIComponent(address)}`}
              target="_blank"
              rel="noreferrer"
            >
              View on Solscan <ArrowUpRight size={13} />
            </a>
          </section>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="token-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function authority(disabled: boolean | null | undefined) {
  return disabled == null ? "—" : disabled ? "Disabled" : "Enabled";
}

function fromLaunch(token: LaunchToken): TokenDetail {
  return {
    address: token.mint,
    symbol: token.symbol,
    name: token.name,
    logoUrl: token.logoUrl,
    rank: null,
    priceUsd: token.priceUsd,
    marketCapUsd: token.marketCapUsd,
    liquidityUsd: token.liquidityUsd,
    volume24hUsd: token.volume24hUsd,
    priceChange1hPercent: null,
    priceChange24hPercent: null,
    holders: token.holders ?? null,
    listedAt: null,
    decimals: null,
    supply: null,
    trades24h: token.transactions24h ?? null,
    buys24h: token.buys24h ?? null,
    sells24h: token.sells24h ?? null,
    uniqueWallets24h: null,
  };
}
