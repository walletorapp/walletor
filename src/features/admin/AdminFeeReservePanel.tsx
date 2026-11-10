import { useState } from "react";
import {
  FeeReserveReportSchema,
  type FeeReserveReport,
} from "../../../shared/fee-reserve-contracts";

export function AdminFeeReservePanel() {
  const [report, setReport] = useState<FeeReserveReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const response = await fetch("/admin/api/fee-reserve", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.redirected || !response.ok)
        throw new Error(
          "Reserve report unavailable. Check your admin login and retry.",
        );
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("data" in body))
        throw new Error("Invalid reserve report.");
      setReport(FeeReserveReportSchema.parse(body.data));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Reserve report unavailable.",
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
    const link = document.createElement("a");
    link.href = url;
    link.download = "walletor-fee-reserve.json";
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
  return (
    <section className="admin-panel" aria-labelledby="reserve-heading">
      <h2 id="reserve-heading">Walletor fee reserve</h2>
      <p>
        11% of all new confirmed Walletor swap fees is held in reserve; 89%
        funds the Prize Pool, before atomic rounding. Approved lifetime
        referrals earmark commissions within this reserve. Check the lifetime
        commission statement before using reserve funds. No automatic payments
        are made.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void load();
        }}
      >
        {busy ? "Loading…" : "Load reserve balance"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <>
          <p>
            Started {report.startsAt}. These are fee receivables held back from
            prize funding, not proof of a transfer to a separate wallet. USD
            values are estimates.
          </p>
          <p>Report as of {report.generatedAt}.</p>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fee mint</th>
                  <th>Reserved (atomic units)</th>
                  <th>Estimated USD at receipt</th>
                  <th>Confirmed swaps</th>
                </tr>
              </thead>
              <tbody>
                {report.balances.map((b) => (
                  <tr key={b.feeMint}>
                    <td>
                      <code>{b.feeMint}</code>
                    </td>
                    <td>{b.reservedAtomic}</td>
                    <td>
                      ${(BigInt(b.estimatedMicroUsd) / 1_000_000n).toString()}.
                      {(BigInt(b.estimatedMicroUsd) % 1_000_000n)
                        .toString()
                        .padStart(6, "0")}
                    </td>
                    <td>{b.receiptCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!report.balances.length ? <p>No fees reserved yet.</p> : null}
          <p>
            Balances include all reserve receipts. Download includes the latest
            100 receipts; different token amounts must not be added together.
          </p>
          <button type="button" onClick={download}>
            Download reserve report
          </button>
        </>
      ) : null}
    </section>
  );
}
