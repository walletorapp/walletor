import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminInfluencerPanel } from "./AdminInfluencerPanel";
import { INFLUENCER_POLICY } from "../../../shared/influencer-contracts";
afterEach(() => {
  vi.unstubAllGlobals();
});
it("reports an empty direct program without presenting estimates as earned commissions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        data: {
          policy: INFLUENCER_POLICY,
          startsAt: "2026-10-16T14:00:00.000Z",
          generatedAt: "2026-10-16T14:00:00.000Z",
          payoutMode: "MANUAL",
          paymentRecordingEnabled: false,
          registeredInfluencers: [],
          query: {
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-10-17T00:00:00.000Z",
            after: 0,
          },
          periodTotals: [],
          lifetimeTotals: [],
          receipts: [],
          nextCursor: null,
        },
      }),
    ),
  );
  render(<AdminInfluencerPanel />);
  fireEvent.click(
    screen.getByRole("button", { name: "Load lifetime commission statement" }),
  );
  expect(await screen.findByText(/0 registered creators/)).toBeInTheDocument();
  expect(screen.getAllByText("No verified commissions recorded.")).toHaveLength(
    2,
  );
  expect(
    screen.queryByRole("button", { name: /send|pay now/i }),
  ).not.toBeInTheDocument();
});
it("does not show zero earnings when Access requires login", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("<html>Login</html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );
  render(<AdminInfluencerPanel />);
  fireEvent.click(
    screen.getByRole("button", { name: "Load lifetime commission statement" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your login",
  );
  expect(
    screen.queryByText("No verified commissions recorded."),
  ).not.toBeInTheDocument();
});
