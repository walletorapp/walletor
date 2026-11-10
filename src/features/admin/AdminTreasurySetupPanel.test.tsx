import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { AdminTreasurySetupPanel } from "./AdminTreasurySetupPanel";
import { REWARDS_AUTOMATION_ADDRESS } from "../../../shared/treasury-setup-contracts";

const wallet = vi.hoisted(() => ({
  publicKey: null as PublicKey | null,
  signTransaction: vi.fn(),
}));
const authorityAddress = "Ho37RbRu1WvmgZcq33HCzUfzp1s1urHVwz1nS7KbWDXh";
function renderPanel() {
  return render(
    <AdminTreasurySetupPanel
      authorityAddress={authorityAddress}
      automaticSettlementEnabled={false}
    />,
  );
}
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => wallet }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  wallet.publicKey = null;
  vi.clearAllMocks();
});

it.each([
  [
    503,
    "Treasury setup requires Solana mainnet.",
    "Treasury setup requires Solana mainnet.",
  ],
  [
    401,
    "Unauthorized",
    "Your admin session has expired or access was denied. Refresh your admin session and try again.",
  ],
])(
  "distinguishes HTTP %s from a session failure",
  async (status, message, expected) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: { message } }, { status })),
    );
    renderPanel();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Check fee recipient" }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  },
);

it.each([authorityAddress, REWARDS_AUTOMATION_ADDRESS])(
  "checks recipient %s without offering a transfer or signing",
  async (currentPartner) => {
    wallet.publicKey = new PublicKey(REWARDS_AUTOMATION_ADDRESS);
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          referralAccount: "E62WC7EP9sQWeu7EkPkXk2TeK2T2VrUQaTwGqw4TEhrJ",
          currentPartner,
          automationAddress: REWARDS_AUTOMATION_ADDRESS,
          partnerShareBps: 8000,
          authorized: false,
          transaction: null,
          blockhash: null,
          lastValidBlockHeight: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    renderPanel();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Check fee recipient" }),
    );
    expect(
      await screen.findByText(
        currentPartner === authorityAddress
          ? /Fee recipient matches/
          : /fee recipient differs/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Authorize/ }),
    ).not.toBeInTheDocument();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/admin/api/treasury/setup", {
      credentials: "same-origin",
    });
  },
);
