import {
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorState, LoadingState } from "../../components/QueryState";
import { TokenAvatar } from "../../components/TokenAvatar";
import { formatCount, formatUsd, shortAddress } from "../../lib/format";
import { Change } from "./TokenTable";
import { useToken } from "./useTokens";

export function TokenDetailPage({ backTo = "/swap" }: { backTo?: string }) {
  const { address = "" } = useParams();
  const result = useToken(address);
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1_500);
  }

  if (result.isPending)
    return <LoadingState label="Loading token intelligence" />;
  if (result.isError)
    return (
      <div className="page-stack">
        <Link className="back-link" to={backTo}>
          <ArrowLeft size={15} /> Back to swap
        </Link>
        <ErrorState
          error={result.error}
          onRetry={() => void result.refetch()}
        />
      </div>
    );
  const token = result.data;
  const chartUrl = `https://dexscreener.com/solana/${encodeURIComponent(token.address)}?embed=1&theme=dark&trades=0&info=0`;

  return (
    <section className="page-stack">
      <Link className="back-link" to={backTo}>
        <ArrowLeft size={15} /> Back to swap
      </Link>
      <div className="detail-heading">
        <div className="detail-heading__identity">
          <TokenAvatar
            logoUrl={token.logoUrl}
            symbol={token.symbol}
            size="lg"
          />
          <span>
            <p className="eyebrow">Token intelligence</p>
            <h1>{token.symbol}</h1>
            <small>{token.name}</small>
          </span>
        </div>
        <div className="detail-heading__actions">
          <button className="address-button" onClick={() => void copyAddress()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <code>{shortAddress(token.address)}</code>
          </button>
          <button
            className="icon-button"
            onClick={() => void result.refetch()}
            aria-label="Refresh token"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="detail-grid">
        <div className="detail-primary">
          <div className="chart-card">
            <div className="card-title">
              <span>
                <BarChart3 size={16} /> Dexscreener chart
              </span>
              <small>Third-party content</small>
            </div>
            <iframe
              src={chartUrl}
              title={`${token.symbol} market chart on Dexscreener`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="stat-grid">
            <Stat label="Price" value={formatUsd(token.priceUsd)} accent />
            <Stat label="Market cap" value={formatUsd(token.marketCapUsd)} />
            <Stat label="Liquidity" value={formatUsd(token.liquidityUsd)} />
            <Stat label="Volume 24h" value={formatUsd(token.volume24hUsd)} />
          </div>
        </div>
        <aside className="detail-aside">
          <div className="info-card">
            <p className="eyebrow">Price movement</p>
            <div className="movement-row">
              <span>
                <small>1 hour</small>
                <Change value={token.priceChange1hPercent} />
              </span>
              <span>
                <small>24 hours</small>
                <Change value={token.priceChange24hPercent} />
              </span>
            </div>
          </div>
          <div className="info-card">
            <h2>Market activity</h2>
            <Info label="Holders" value={formatCount(token.holders)} />
            <Info label="Trades 24h" value={formatCount(token.trades24h)} />
            <Info
              label="Buys / sells"
              value={`${formatCount(token.buys24h)} / ${formatCount(token.sells24h)}`}
            />
            <Info
              label="Unique wallets"
              value={formatCount(token.uniqueWallets24h)}
            />
            <Info label="Decimals" value={token.decimals?.toString() ?? "—"} />
          </div>
          <div className="info-card">
            <h2>Research elsewhere</h2>
            <p className="muted-copy">
              External sites are independent and may show different or delayed
              data.
            </p>
            <div className="external-links">
              <External
                href={`https://dexscreener.com/solana/${encodeURIComponent(token.address)}`}
                label="Dexscreener"
              />
              <External
                href={`https://solscan.io/token/${encodeURIComponent(token.address)}`}
                label="Solscan"
              />
            </div>
          </div>
          <div className="boundary-note">
            <strong>Trade through Jupiter</strong>
            <p>
              Walletor swaps require wallet review and Jupiter confirmation.
              Demo pool figures do not represent collected fees or rewards.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="stat-card">
      <small>{label}</small>
      <strong className={accent ? "positive" : ""}>{value}</strong>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function External({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={13} />
    </a>
  );
}
