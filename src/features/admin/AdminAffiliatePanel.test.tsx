import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminAffiliatePanel } from "./AdminAffiliatePanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads a private preview and explicitly keeps allocations and payments inactive", async () => {
  const fetchMock = vi.fn((url: string) => {
    const params = new URL(url, "https://walletor.com").searchParams;
    return Promise.resolve(
      Response.json({
        data: {
          mode: "PREVIEW_ONLY",
          commissionAccountingEnabled: false,
          payoutEnabled: false,
          attributionStatus: "NOT_VERIFIED",
          projectId: "walletor",
          generatedAt: new Date().toISOString(),
          query: { from: params.get("from"), to: params.get("to"), limit: 50 },
          policy: { kolBps: 1000, platformBpsOfKol: 1000 },
          receipts: [],
          pageTotalsByMint: [],
          nextCursor: null,
          limitations: ["Not payable"],
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AdminAffiliatePanel />);
  expect(
    screen.getByText(/allocations and payments inactive/),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Preview verified fees" }),
  );
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("0 receipts");
  });
  expect(
    screen.getByRole("button", { name: "Download this preview page" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: /pay now|activate|send/i }),
  ).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/admin/api/affiliates/segmento/preview?"),
    { credentials: "same-origin", cache: "no-store" },
  );
});

it("shows authentication failure instead of a zero commission balance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  render(<AdminAffiliatePanel />);
  fireEvent.click(
    screen.getByRole("button", { name: "Preview verified fees" }),
  );
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Refresh your admin login",
    );
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Download this preview page" }),
  ).not.toBeInTheDocument();
});
