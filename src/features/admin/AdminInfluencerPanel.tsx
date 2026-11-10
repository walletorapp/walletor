import { useState } from "react";
import {
  InfluencerReportSchema,
  InfluencerReportQuerySchema,
  type InfluencerReport,
} from "../../../shared/influencer-contracts";
import {
  influencerApi,
  defaultInfluencerDates,
  influencerDateQuery,
} from "../affiliates/influencer-client";
import { InfluencerReportView } from "../affiliates/InfluencerReportView";

export function AdminInfluencerPanel() {
  const [dates, setDates] = useState(defaultInfluencerDates);
  const [report, setReport] = useState<InfluencerReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(next: boolean) {
    setBusy(true);
    setError("");
    if (!next) setReport(null);
    try {
      const query = InfluencerReportQuerySchema.parse(
        next && report
          ? { ...report.query, after: report.nextCursor ?? 0 }
          : influencerDateQuery(dates.from, dates.through),
      );
      const params = new URLSearchParams({
        from: query.from,
        to: query.to,
        after: String(query.after),
      });
      setReport(
        InfluencerReportSchema.parse(
          await influencerApi(`/admin/api/influencers/report?${params}`),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Commission report unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="admin-panel"
      aria-labelledby="lifetime-commissions-heading"
    >
      <h2 id="lifetime-commissions-heading">Lifetime influencer commissions</h2>
      <p>
        Verified accruals within the 11% reserve. Creators register directly
        with their own wallet; referred users sign a registration before their
        first order. No Segmento commission or automatic payments apply to this
        program.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(false);
        }}
      >
        <div className="admin-affiliate-filters">
          <label>
            From (UTC)
            <input
              required
              type="date"
              value={dates.from}
              disabled={busy}
              onChange={(e) => {
                setDates({ ...dates, from: e.target.value });
                setReport(null);
              }}
            />
          </label>
          <label>
            Through (UTC)
            <input
              required
              type="date"
              value={dates.through}
              disabled={busy}
              onChange={(e) => {
                setDates({ ...dates, through: e.target.value });
                setReport(null);
              }}
            />
          </label>
        </div>
        <button disabled={busy}>
          {busy ? "Loading…" : "Load lifetime commission statement"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <>
          <InfluencerReportView report={report} />
          {report.nextCursor ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void load(true);
              }}
            >
              Next receipts
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
