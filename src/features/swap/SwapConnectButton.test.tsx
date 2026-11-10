import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { SwapConnectButton } from "./SwapConnectButton";
import { WalletConnectionButton } from "./WalletConnectionButton";

const mocks = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  select: vi.fn(),
  setVisible: vi.fn(),
  connected: false,
  connecting: false,
}));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    wallet: { adapter: { name: "Backpack" }, readyState: "NotDetected" },
    connected: mocks.connected,
    connecting: mocks.connecting,
    connect: mocks.connect,
    select: mocks.select,
  }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  useWalletModal: () => ({ setVisible: mocks.setVisible }),
  WalletMultiButton: ({ children }: PropsWithChildren) => (
    <button type="button" aria-haspopup="menu">
      {children}
    </button>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connected = false;
  mocks.connecting = false;
});

it("opens the picker instead of retrying a remembered, uninstalled Backpack", () => {
  render(<SwapConnectButton />);
  fireEvent.click(screen.getByRole("button", { name: "Connect / Swap" }));
  expect(mocks.select).toHaveBeenCalledWith(null);
  expect(mocks.setVisible).toHaveBeenCalledWith(true);
  expect(mocks.select.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.setVisible.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Change wallet" })).toBeNull();
});

it("lets users escape a pending connection through the picker", () => {
  mocks.connecting = true;
  render(<WalletConnectionButton>Connect wallet</WalletConnectionButton>);
  const button = screen.getByRole("button", { name: "Choose another wallet" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(mocks.select).toHaveBeenCalledWith(null);
  expect(mocks.setVisible).toHaveBeenCalledWith(true);
});

it("preserves the connected wallet menu", () => {
  mocks.connected = true;
  render(<WalletConnectionButton>Backpack · abcd…1234</WalletConnectionButton>);
  expect(screen.getByRole("button")).toHaveAttribute("aria-haspopup", "menu");
  expect(screen.getByRole("button")).toHaveTextContent("Backpack · abcd…1234");
  expect(mocks.select).not.toHaveBeenCalled();
});

it("preserves disabled connection actions", () => {
  render(
    <WalletConnectionButton disabled>Connect wallet</WalletConnectionButton>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.setVisible).not.toHaveBeenCalled();
});
