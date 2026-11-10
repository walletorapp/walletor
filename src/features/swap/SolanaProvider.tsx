import {
  WalletAdapterNetwork,
  type Adapter,
} from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletContext,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { useEffect, useMemo, useState, type PropsWithChildren } from "react";

let metaMaskRegistration: Promise<void> | null = null;
let fallbackWalletAdapters: Promise<Adapter[]> | null = null;

function registerMetaMask(origin: string): Promise<void> {
  metaMaskRegistration ??= import("@metamask/connect-solana").then(
    async ({ createSolanaClient }) => {
      await createSolanaClient({
        dapp: {
          name: "Walletor",
          url: origin,
        },
      });
    },
  );

  return metaMaskRegistration;
}

function loadFallbackWalletAdapters(): Promise<Adapter[]> {
  fallbackWalletAdapters ??= Promise.all([
    import("@solana/wallet-adapter-phantom"),
    import("@solana/wallet-adapter-backpack"),
    import("@solana/wallet-adapter-trust"),
  ]).then(
    ([
      { PhantomWalletAdapter },
      { BackpackWalletAdapter },
      { TrustWalletAdapter },
    ]) => [
      new PhantomWalletAdapter(),
      new BackpackWalletAdapter(),
      new TrustWalletAdapter(),
    ],
  );

  return fallbackWalletAdapters;
}

interface CompatibilityStatus {
  fallbackWallets: boolean;
  metaMask: boolean;
  tangem: boolean;
}

const initialCompatibilityStatus: CompatibilityStatus = {
  fallbackWallets: false,
  metaMask: false,
  tangem: false,
};

function isAllowedWallet(name: string): boolean {
  return !name.toLowerCase().includes("solflare");
}

function AvailableWallets({ children }: PropsWithChildren) {
  const context = useWallet();
  const wallets = useMemo(
    () =>
      context.wallets.filter(({ adapter }) => isAllowedWallet(adapter.name)),
    [context.wallets],
  );
  useEffect(() => {
    if (context.wallet && !isAllowedWallet(context.wallet.adapter.name)) {
      context.select(null);
    }
  }, [context]);
  return (
    <WalletContext.Provider value={{ ...context, wallets }}>
      {children}
    </WalletContext.Provider>
  );
}

export function SolanaProvider({ children }: PropsWithChildren) {
  const [wallets, setWallets] = useState<Adapter[]>([]);
  const [tangem, setTangem] = useState<Adapter | null>(null);
  const availableAdapters = useMemo(
    () => (tangem ? [...wallets, tangem] : wallets),
    [wallets, tangem],
  );
  const [compatibilityStatus, setCompatibilityStatus] =
    useState<CompatibilityStatus>(initialCompatibilityStatus);
  const endpoint = useMemo(
    () => clusterApiUrl(WalletAdapterNetwork.Mainnet),
    [],
  );

  useEffect(() => {
    let active = true;

    // Public application ID; deployments can override it or disable with an empty value.
    const configuredProjectId: unknown =
      import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
      "ee83eb0e49f4b46e76324e065bec61c7";
    const projectId =
      typeof configuredProjectId === "string" ? configuredProjectId.trim() : "";
    if (projectId) {
      void import("./TangemWalletAdapter")
        .then(({ TangemWalletAdapter }) => {
          if (active) setTangem(new TangemWalletAdapter(projectId));
        })
        .catch(() => {
          if (active)
            setCompatibilityStatus((current) => ({ ...current, tangem: true }));
        });
    }

    void registerMetaMask(window.location.origin).then(
      () => {
        if (active) {
          setCompatibilityStatus((current) => ({
            ...current,
            metaMask: false,
          }));
        }
      },
      () => {
        metaMaskRegistration = null;
        if (!active) return;
        setCompatibilityStatus((current) => ({
          ...current,
          metaMask: true,
        }));
      },
    );

    void loadFallbackWalletAdapters().then(
      (supportedWallets) => {
        if (!active) return;
        setWallets(supportedWallets);
        setCompatibilityStatus((current) => ({
          ...current,
          fallbackWallets: false,
        }));
      },
      () => {
        fallbackWalletAdapters = null;
        if (!active) return;
        setCompatibilityStatus((current) => ({
          ...current,
          fallbackWallets: true,
        }));
      },
    );

    return () => {
      active = false;
    };
  }, []);

  const hasCompatibilityIssue =
    Object.values(compatibilityStatus).some(Boolean);

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* Installed wallets take the Wallet Standard path. The explicit
          adapters keep supported install and mobile handoff options visible. */}
      <WalletProvider
        wallets={availableAdapters}
        autoConnect={(adapter) =>
          Promise.resolve(isAllowedWallet(adapter.name))
        }
      >
        <AvailableWallets>
          <WalletModalProvider>
            {hasCompatibilityIssue ? (
              <div className="wallet-compatibility-warning" role="alert">
                Some Solana wallet options are temporarily unavailable.
                Installed Wallet Standard wallets can still connect.
              </div>
            ) : null}
            {children}
          </WalletModalProvider>
        </AvailableWallets>
      </WalletProvider>
    </ConnectionProvider>
  );
}
