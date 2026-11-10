import { useState } from "react";
import {
  AffiliateReportResponseSchema,
  type AffiliateReport,
} from "../../../shared/affiliate-report-contracts";

export function AdminAffiliatePanel() {
  const [wallet, setWallet] = useState("");
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<AffiliateReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(next = false) {
    setBusy(true);
    setError(null);
    if (!next) setReport(null);
    try {
      const query =
        next && report
          ? { ...report.query, after: report.nextCursor ?? undefined }
          : {
              from: new Date(`${from}T00:00:00Z`).toISOString(),
              to: new Date(
                Date.parse(`${to}T00:00:00Z`) + 86_400_000,
              ).toISOString(),
              wallet: wallet.trim() || undefined,
              limit: 50,
            };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      const response = await fetch(
        `/admin/api/affiliates/segmento/preview?${params.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (
        response.redirected ||
        response.status === 401 ||
        response.status === 403
      )
        throw new Error("Refresh your admin login and try again.");
      if (!response.ok)
        throw new Error(
          response.status === 400
            ? "Choose valid dates within 31 days and a valid Solana wallet."
            : "Verified fee report is unavailable. Please retry.",
        );
      const body: unknown = await response.json();
      setReport(AffiliateReportResponseSchema.parse(body).data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Fee report unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `walletor-segmento-preview-${report.query.after ?? "first-page"}.json`;
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  return (
    <section className="admin-panel" aria-labelledby="affiliate-heading">
      <h2 id="affiliate-heading">Historical fee-only estimate</h2>
      <p>
        <strong>Preview only · allocations and payments inactive</strong>
      </p>
      <p>
        Use the Lifetime influencer commissions statement for verified creator
        earnings. This older estimate ignores referral ownership and is not
        payable.
      </p>
      <p>
        Proposed split of Walletor’s verified fees: 10% KOL, 1% Segmento, 89%
        Prize Pool before rounding. These are fee receivables, not a treasury
        balance.
      </p>
      <p>
        The separate Walletor fee reserve is not a Segmento commission or
        payment. This hypothetical preview does not deduct any additional fees.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="admin-affiliate-filters">
          <label>
            From (UTC)
            <input
              type="date"
              required
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </label>
          <label>
            Through (UTC)
            <input
              type="date"
              required
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </label>
          <label>
            Trader wallet (optional)
            <input
              value={wallet}
              onChange={(event) => {
                setWallet(event.target.value);
              }}
              placeholder="All verified wallets"
            />
          </label>
        </div>
        <button type="submit" disabled={busy}>
          {busy ? "Loading…" : "Preview verified fees"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <>
          <p role="status">
            {report.receipts.length} receipts on this page. KOL attribution is
            unverified; proposed commissions are not payable allocations.
          </p>
          <p>
            {report.query.from} to {report.query.to} (end exclusive).
          </p>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fee mint</th>
                  <th>Walletor fee</th>
                  <th>Proposed KOL</th>
                  <th>Proposed Segmento</th>
                  <th>Proposed pool</th>
                </tr>
              </thead>
              <tbody>
                {report.pageTotalsByMint.map((total) => (
                  <tr key={total.feeMint}>
                    <td>
                      <code>{total.feeMint}</code>
                    </td>
                    <td>{total.walletorFeeAtomic}</td>
                    <td>{total.proposedKolAtomic}</td>
                    <td>{total.proposedSegmentoAtomic}</td>
                    <td>{total.proposedPoolAtomic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Atomic token units; totals cover this page only. The download
            includes each transaction and its proposed split.
          </p>
          <button type="button" onClick={download} disabled={busy}>
            Download this preview page
          </button>{" "}
          {report.nextCursor ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void load(true);
              }}
            >
              Next page
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
