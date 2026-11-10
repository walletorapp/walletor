import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminFeeReservePanel } from "./AdminFeeReservePanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows the reserve separately from payouts and keeps estimated USD precision", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        data: {
          policy: "walletor-reserve-11-v1",
          startsAt: "2026-10-12T14:00:00.000Z",
          reserveBps: 1100,
          payoutEnabled: false,
          generatedAt: "2026-10-12T15:00:00.000Z",
          receipts: [],
          balances: [
            {
              feeMint: "SOL",
              reservedAtomic: "44000",
              estimatedMicroUsd: "44000",
              receiptCount: 1,
            },
          ],
        },
      }),
    ),
  );
  render(<AdminFeeReservePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Load reserve balance" }));
  expect(await screen.findByText("$0.044000")).toBeInTheDocument();
  expect(screen.getByText(/No automatic payments/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /pay|send|distribute/i }),
  ).not.toBeInTheDocument();
});

it("never displays an unavailable reserve as a zero balance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
  );
  render(<AdminFeeReservePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Load reserve balance" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your admin login",
  );
  expect(screen.queryByText("No fees reserved yet.")).not.toBeInTheDocument();
});
