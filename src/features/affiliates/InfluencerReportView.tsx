import type { InfluencerReport } from "../../../shared/influencer-contracts";

function downloadInfluencerStatement(report: InfluencerReport) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `walletor-influencers-${report.query.from.slice(0, 10)}-${String(report.query.after)}.json`;
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
export function InfluencerReportView({ report }: { report: InfluencerReport }) {
  return (
    <>
      <p>
        {report.startsAt
          ? `Walletor partner program active since ${report.startsAt}. ${String(report.registeredInfluencers.length)} registered creators in this report.`
          : "Walletor partner program is temporarily unavailable."}
      </p>
      <p>
        10% of verified Walletor fees from registered referred wallets accrues
        to their influencer from Walletor’s existing reserve. There is no
        third-party platform commission. Payments are manual every 30 days.
        These figures show accrued fees, not proof of an available treasury
        balance; completed payouts are not yet recorded here.
      </p>
      <button
        type="button"
        onClick={() => {
          downloadInfluencerStatement(report);
        }}
      >
        Download statement (JSON)
      </button>
      {(
        [
          ["Period earnings", report.periodTotals],
          ["Lifetime earnings", report.lifetimeTotals],
        ] as const
      ).map(([title, totals]) => (
        <section key={title}>
          <h3>{title}</h3>
          {!totals.length ? (
            <p>No verified commissions recorded.</p>
          ) : (
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Influencer / referral</th>
                    <th>Fee mint</th>
                    <th>Walletor fees (atomic)</th>
                    <th>Influencer earned (atomic)</th>
                    <th>Swaps</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={`${t.code}:${t.feeMint}`}>
                      <td>
                        {t.name}
                        <br />
                        <code>{t.code}</code>
                      </td>
                      <td>
                        <code>{t.feeMint}</code>
                      </td>
                      <td>{t.grossFeeAtomic}</td>
                      <td>{t.influencerAtomic}</td>
                      <td>{t.receiptCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      <p>
        Amounts are exact token atomic units, separated by mint. Statement dates
        use UTC, with the end date exclusive. Totals cover the full period;
        receipt pages contain up to 100 entries.
      </p>
      {report.receipts.length ? (
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Referral</th>
                <th>Verified swap</th>
                <th>Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {report.receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td>
                  <td>
                    <a
                      href={`https://solscan.io/tx/${encodeURIComponent(r.transactionHash)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r.transactionHash.slice(0, 14)}…
                    </a>
                  </td>
                  <td>{r.confirmedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
