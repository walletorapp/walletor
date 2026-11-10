import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReferralPanel, ReferralInviteNotice } from "./ReferralPanel";
import { referralMessage } from "../../../shared/referral-contracts";

const wallet = "So11111111111111111111111111111111111111112";
const mocks = vi.hoisted(() => ({
  connected: true,
  signMessage: vi.fn(),
  setVisible: vi.fn(),
}));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: mocks.connected,
    publicKey: mocks.connected
      ? { toBase58: () => "So11111111111111111111111111111111111111112" }
      : null,
    signMessage: mocks.signMessage,
  }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  useWalletModal: () => ({ setVisible: mocks.setVisible }),
}));
const code = "a".repeat(32);
const data = {
  walletAddress: wallet,
  code,
  qualifiedReferrals: 2,
  bonusPoints: "200",
  joined: false,
  canJoin: true,
  activeRoundId: "round",
  roundEndsAt: "2026-09-17T00:00:00.000Z",
  boostStartsAt: "2026-09-16T00:00:00.000Z",
  roundQualifiedReferrals: 2,
  boostBps: 2000,
  eligibleForBoost: true,
};
function mount(path = "/referal", notice = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {notice ? <ReferralInviteNotice /> : <ReferralPanel />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  });
  mocks.connected = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.connected = true;
  vi.clearAllMocks();
});
it("requires connection and shows no invented referral statistics", async () => {
  mocks.connected = false;
  mount();
  await userEvent.click(screen.getByRole("button", { name: /Connect wallet/ }));
  expect(mocks.setVisible).toHaveBeenCalledWith(true);
  expect(screen.queryByText("200")).not.toBeInTheDocument();
});
it("renders server totals and social composers carrying the wallet link", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data })));
  mount();
  expect(
    await screen.findByDisplayValue(`https://walletor.com/?ref=${code}`),
  ).toBeInTheDocument();
  expect(screen.getByText("200")).toBeInTheDocument();
  expect(screen.getByText("+20%")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(`/api/referrals?wallet=${wallet}`, {
    cache: "no-store",
  });
  for (const name of [/Twitter/, /WhatsApp/, /Telegram/]) {
    const link = screen.getByRole("link", { name });
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(
      `https://walletor.com/?ref=${code}`,
    );
  }
  expect(mocks.signMessage).not.toHaveBeenCalled();
});
it("signs only a user-requested, bound registration message, then posts the proof", async () => {
  const invite = "b".repeat(32);
  const nonce = "00000000-0000-4000-8000-000000000000";
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  const message = referralMessage(wallet, invite, nonce, expiresAt);
  const fetcher = vi.fn<
    (input: string, init?: RequestInit) => Promise<Response>
  >((input) => {
    if (input.endsWith("challenge"))
      return Promise.resolve(
        Response.json({ data: { nonce, expiresAt, message } }),
      );
    if (input.endsWith("join"))
      return Promise.resolve(Response.json({ data: { joined: true } }));
    return Promise.resolve(Response.json({ data }));
  });
  vi.stubGlobal("fetch", fetcher);
  mocks.signMessage.mockResolvedValue(new Uint8Array(64));
  mount(`/referal?ref=${invite}`);
  await screen.findByRole("button", { name: "Register referral" });
  expect(mocks.signMessage).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Register referral" }),
  );
  expect(await screen.findByText(/Referral registered/)).toBeInTheDocument();
  expect(mocks.signMessage).toHaveBeenCalledWith(
    new TextEncoder().encode(message),
  );
  expect(
    fetcher.mock.calls.some(
      ([url, init]) =>
        url.endsWith("/join") &&
        typeof init?.body === "string" &&
        init.body.includes(nonce),
    ),
  ).toBe(true);
});
it("keeps the first invite instead of silently switching attribution", async () => {
  window.localStorage.setItem(
    "walletor:referral-invite:v1",
    JSON.stringify({ code, expiresAt: Date.now() + 300000 }),
  );
  mount(`/?ref=${"b".repeat(32)}`, true);
  expect(
    await screen.findByRole("link", { name: /Register it before/ }),
  ).toHaveAttribute("href", `/referal?ref=${code}`);
});

it("does not save or display a native invitation for a marked Segmento hex code", () => {
  mount(`/?ref=${code}&sgm_rdr=1`, true);
  expect(
    screen.queryByRole("link", { name: /Register it before/ }),
  ).not.toBeInTheDocument();
  expect(window.localStorage.getItem("walletor:referral-invite:v1")).toBeNull();
});

it("preserves an existing native invite when arriving through a Segmento link", async () => {
  window.localStorage.setItem(
    "walletor:referral-invite:v1",
    JSON.stringify({ code, expiresAt: Date.now() + 300000 }),
  );
  mount(`/?ref=${"b".repeat(32)}&sgm_rdr=1`, true);
  expect(
    await screen.findByRole("link", { name: /Register it before/ }),
  ).toHaveAttribute("href", `/referal?ref=${code}`);
});
