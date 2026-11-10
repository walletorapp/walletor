import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminPrizeSeedPanel } from "./AdminPrizeSeedPanel";

afterEach(() => vi.unstubAllGlobals());
const state = {
  authorityAddress: "distribution-wallet",
  depositAccount: "usdc-account",
  requestedAt: null,
  fundedAt: null,
  startsAt: null,
  endsAt: null,
  depositSignature: null,
  seededRounds: 0,
  remainingCents: 0,
};
it("requires explicit preparation and a verified receipt before showing a funded campaign", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: state })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { ...state, requestedAt: "2026-10-04T12:00:00.000Z" },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Transfer not finalized" } }),
        { status: 409 },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<AdminPrizeSeedPanel />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check daily reserve" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Prepare 700 USDC reserve" }),
  );
  await screen.findByText("distribution-wallet");
  expect(
    screen.queryByText(/700 USDC deposit verified/),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Deposit transaction signature"), {
    target: { value: "deposit-signature" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Verify deposit and schedule seven rounds",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Transfer not finalized",
  );
  expect(fetcher.mock.calls[2]?.[0]).toBe("/admin/api/prize-seed/confirm");
  expect(
    screen.queryByText(/700 USDC deposit verified/),
  ).not.toBeInTheDocument();
});
it("shows the bounded schedule for a verified reserve without requesting another transfer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            ...state,
            requestedAt: "2026-10-04T12:00:00.000Z",
            fundedAt: "2026-10-04T12:02:00.000Z",
            startsAt: "2026-10-05T10:00:00.000Z",
            endsAt: "2026-10-12T10:00:00.000Z",
            depositSignature: "signature",
            seededRounds: 2,
            remainingCents: 50_000,
          },
        }),
      ),
    ),
  );
  render(<AdminPrizeSeedPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Check daily reserve" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 of 7 rounds seeded",
    ),
  );
  expect(screen.getByRole("status")).toHaveTextContent("$500.00");
  expect(
    screen.queryByLabelText("Deposit transaction signature"),
  ).not.toBeInTheDocument();
});
