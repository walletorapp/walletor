import { useQuery } from "@tanstack/react-query";
import { ComplianceAdminResponseSchema } from "../../../shared/compliance-contracts";

export function AdminCompliancePanel() {
  const query = useQuery({
    queryKey: ["admin", "compliance"],
    queryFn: async () => {
      const response = await fetch("/admin/api/compliance", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Compliance status could not be loaded.");
      const payload: unknown = await response.json();
      return ComplianceAdminResponseSchema.parse(payload).data;
    },
    refetchInterval: 60_000,
  });
  return (
    <section className="admin-panel" aria-label="Sanctions screening">
      <h2>Sanctions screening</h2>
      <p>
        Checks explicitly listed Solana addresses in the OFAC SDN list. This
        does not establish AML clearance, identity, indirect exposure, or
        complete sanctions coverage.
      </p>
      {query.isPending && <p role="status">Loading screening status…</p>}
      {query.isError && (
        <p role="alert">
          Screening status is unavailable. Check the source and audit database
          before funding.
        </p>
      )}
      {query.data && (
        <>
          {query.data.status.enabled &&
            query.data.status.state !== "CURRENT" && (
              <p role="alert">
                Screening data is unavailable or expired. Distribution funding
                and claim preparation are paused. Swaps are not screened.
                Restore the official source refresh before proceeding.
              </p>
            )}
          <dl className="admin-health-list">
            <div>
              <dt>Source status</dt>
              <dd>{query.data.status.state}</dd>
            </div>
            <div>
              <dt>Last successful retrieval</dt>
              <dd>{query.data.status.fetchedAt ?? "Never retrieved"}</dd>
            </div>
            <div>
              <dt>OFAC publication date</dt>
              <dd>{query.data.status.publishedDate ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Explicit Solana addresses</dt>
              <dd>{query.data.status.addressCount}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{query.data.status.policyVersion}</dd>
            </div>
          </dl>
          <h3>Recent screening records</h3>
          <p>
            A “No direct match” result is limited to this source. Restricted
            records need review; there is no automatic override or
            redistribution.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Wallet</th>
                  <th>Result</th>
                  <th>Review reference</th>
                </tr>
              </thead>
              <tbody>
                {query.data.events.map((event) => (
                  <tr key={event.eventId}>
                    <td>{event.createdAt}</td>
                    <td>{event.action}</td>
                    <td>{event.walletAddress}</td>
                    <td>
                      {event.decision === "NO_DIRECT_MATCH"
                        ? "No direct match"
                        : event.decision}
                    </td>
                    <td>{event.eventId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.events.length === 0 && <p>No screening records yet.</p>}
        </>
      )}
      <p>
        <a
          href="https://docs.walletor.com/legal/aml-sanctions/"
          target="_blank"
          rel="noreferrer"
        >
          Screening scope and review information
        </a>
      </p>
    </section>
  );
}
