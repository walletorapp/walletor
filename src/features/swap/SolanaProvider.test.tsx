import { render, screen, waitFor } from "@testing-library/react";
import { useContext, type PropsWithChildren } from "react";
import { WalletContext } from "@solana/wallet-adapter-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createSolanaClient, walletProvider } = vi.hoisted(() => ({
  createSolanaClient: vi.fn(() => Promise.resolve({})),
  walletProvider: vi.fn(
    ({ children }: PropsWithChildren & { wallets: { name: string }[] }) =>
      children,
  ),
}));

class TestWalletAdapter {
  constructor(readonly name: string) {}
}

vi.mock("@metamask/connect-solana", () => ({ createSolanaClient }));
vi.mock("./TangemWalletAdapter", () => ({
  TangemWalletAdapter: class extends TestWalletAdapter {
    constructor() {
      super("Tangem");
    }
  },
}));
vi.mock("@solana/wallet-adapter-phantom", () => ({
  PhantomWalletAdapter: class extends TestWalletAdapter {
    constructor() {
      super("Phantom");
    }
  },
}));
vi.mock("@solana/wallet-adapter-backpack", () => ({
  BackpackWalletAdapter: class extends TestWalletAdapter {
    constructor() {
      super("Backpack");
    }
  },
}));
vi.mock("@solana/wallet-adapter-trust", () => ({
  TrustWalletAdapter: class extends TestWalletAdapter {
    constructor() {
      super("Trust");
    }
  },
}));
vi.mock("@solana/wallet-adapter-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWallet: () => ({
    wallets: [
      { adapter: { name: "Solflare" } },
      { adapter: { name: "Phantom" } },
    ],
    wallet: null,
    select: vi.fn(),
  }),
  ConnectionProvider: ({ children }: PropsWithChildren) => children,
  WalletProvider: walletProvider,
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  WalletModalProvider: ({ children }: PropsWithChildren) => children,
}));

describe("SolanaProvider", () => {
  beforeEach(() => {
    walletProvider.mockClear();
    vi.stubEnv("VITE_WALLETCONNECT_PROJECT_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("adds Tangem alongside existing wallets when configured", async () => {
    vi.stubEnv("VITE_WALLETCONNECT_PROJECT_ID", "a".repeat(32));
    const { SolanaProvider } = await import("./SolanaProvider");
    render(
      <SolanaProvider>
        <div>Configured</div>
      </SolanaProvider>,
    );
    await waitFor(() => {
      expect(
        walletProvider.mock.calls.at(-1)?.[0].wallets.map(({ name }) => name),
      ).toEqual(["Phantom", "Backpack", "Trust", "Tangem"]);
    });
  });

  it("hides Solflare discovered through Wallet Standard", async () => {
    const { SolanaProvider } = await import("./SolanaProvider");
    function Options() {
      const { wallets } = useContext(WalletContext);
      return (
        <div data-testid="wallet-options">
          {wallets.map(({ adapter }) => adapter.name).join(",")}
        </div>
      );
    }
    render(
      <SolanaProvider>
        <Options />
      </SolanaProvider>,
    );
    expect(screen.getByTestId("wallet-options")).toHaveTextContent("Phantom");
    expect(screen.getByTestId("wallet-options")).not.toHaveTextContent(
      "Solflare",
    );
  });

  it("registers every supported Solana wallet connection path", async () => {
    const { SolanaProvider } = await import("./SolanaProvider");

    render(
      <SolanaProvider>
        <div>Walletor application</div>
      </SolanaProvider>,
    );

    expect(screen.getByText("Walletor application")).toBeInTheDocument();

    await waitFor(() => {
      expect(createSolanaClient).toHaveBeenCalledWith({
        dapp: {
          name: "Walletor",
          url: window.location.origin,
        },
      });
    });

    await waitFor(() => {
      const latestProps = walletProvider.mock.calls.at(-1)?.[0];
      expect(latestProps?.wallets.map(({ name }) => name)).toEqual([
        "Phantom",
        "Backpack",
        "Trust",
      ]);
    });
  });
});
