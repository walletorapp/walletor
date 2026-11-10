import { ArrowUpRight, Clock3, History, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";

import { formatUsd } from "../../lib/format";
import { loadSwapHistory } from "../swap/history";
import { ConceptPageHeading } from "./ConceptPageHeading";
import { ConceptPageShell } from "./ConceptPageShell";
import { walletorRoutes } from "./routes";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function shortSignature(value: string): string {
  return `${value.slice(0, 7)}…${value.slice(-7)}`;
}

export function WalletorConceptHistoryPage() {
  const entries = loadSwapHistory();
  const latest = entries.at(0);

  return (
    <ConceptPageShell className="concept-history-page">
      <ConceptPageHeading
        eyebrow="Confirmed execution"
        title="Swap History"
        description="Jupiter-confirmed Walletor swaps saved locally on this device."
        icon={History}
      />

      <section className="concept-history-summary" aria-label="History summary">
        <div>
          <History aria-hidden="true" />
          <span>
            <small>Confirmed swaps</small>
            <strong>{entries.length.toLocaleString("en-US")}</strong>
          </span>
        </div>
        <div>
          <Clock3 aria-hidden="true" />
          <span>
            <small>Last activity</small>
            <strong>
              {latest ? formatDate(latest.confirmedAt) : "No swaps yet"}
            </strong>
          </span>
        </div>
        <div>
          <WalletCards aria-hidden="true" />
          <span>
            <small>Record location</small>
            <strong>This device</strong>
          </span>
        </div>
      </section>

      <section
        className="concept-history-ledger"
        aria-labelledby="concept-history-ledger-title"
      >
        <header>
          <div>
            <small>Local transaction record</small>
            <h2 id="concept-history-ledger-title">Recent swaps</h2>
          </div>
          <span>Latest {Math.min(entries.length, 50)}</span>
        </header>

        {entries.length ? (
          <div className="concept-history-list">
            {entries.map((entry) => (
              <article key={entry.signature}>
                <span className="concept-history-pair">
                  <strong>
                    {entry.inputToken.symbol} → {entry.outputToken.symbol}
                  </strong>
                  <small>{formatDate(entry.confirmedAt)}</small>
                </span>
                <span>
                  <small>Sold</small>
                  <strong>
                    {entry.inputAmount} {entry.inputToken.symbol}
                  </strong>
                </span>
                <span>
                  <small>Received</small>
                  <strong>
                    {entry.outputAmount} {entry.outputToken.symbol}
                  </strong>
                </span>
                <span>
                  <small>Notional</small>
                  <strong>
                    {entry.inputUsdValue === null
                      ? "—"
                      : formatUsd(entry.inputUsdValue)}
                  </strong>
                </span>
                <a
                  href={`https://solscan.io/tx/${encodeURIComponent(entry.signature)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortSignature(entry.signature)}
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
        ) : (
          <div className="concept-history-empty">
            <span>
              <History aria-hidden="true" />
            </span>
            <h3>No confirmed swaps on this device</h3>
            <p>
              Your history appears here only after Jupiter confirms a
              wallet-signed transaction.
            </p>
            <Link to={walletorRoutes.home}>Make your first swap</Link>
          </div>
        )}
      </section>
    </ConceptPageShell>
  );
}
