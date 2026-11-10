import { useWallet } from "@solana/wallet-adapter-react";
import { Command, Menu, Search, WalletCards } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { OPEN_TOKEN_SEARCH_EVENT } from "../swap/events";
import { WalletConnectionButton } from "../swap/WalletConnectionButton";
import { walletorRoutes } from "./routes";

interface TerminalHeaderProps {
  menuOpen: boolean;
  onMenuOpen: () => void;
}

export function TerminalHeader({ menuOpen, onMenuOpen }: TerminalHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, publicKey, wallet } = useWallet();
  const address = publicKey?.toBase58();
  const shortAddress = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;
  const walletLabel = connected
    ? `${wallet?.adapter.name ?? "Wallet"} · ${shortAddress ?? "Connected"}`
    : "Connect wallet";
  const openSearch = useCallback(() => {
    if (location.pathname === walletorRoutes.home) {
      window.dispatchEvent(new Event(OPEN_TOKEN_SEARCH_EVENT));
      return;
    }
    void navigate(`${walletorRoutes.home}?tokenSearch=open`);
  }, [location.pathname, navigate]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [openSearch]);

  return (
    <header className="concept-header">
      <button
        type="button"
        className="concept-menu-trigger"
        aria-label="Open navigation menu"
        aria-controls="concept-navigation"
        aria-expanded={menuOpen}
        onClick={onMenuOpen}
      >
        <Menu className="size-[19px]" aria-hidden="true" />
      </button>

      <Link
        to={walletorRoutes.home}
        className="concept-mobile-brand"
        aria-label="Go to Walletor homepage"
      >
        <img
          src="/assets/walletor-logo-animated-clean.webp"
          alt=""
          aria-hidden="true"
        />
        <strong>Walletor</strong>
      </Link>

      <div className="concept-title-lockup">
        <span>Walletor</span>
        <strong>Airdrops Every Day</strong>
      </div>

      <button
        type="button"
        className="concept-command"
        aria-label="Search tokens"
        onClick={openSearch}
      >
        <Search className="size-[18px]" aria-hidden="true" />
        <span>Search token or paste mint</span>
        <kbd>
          <Command className="size-3" aria-hidden="true" />K
        </kbd>
      </button>

      <div className="concept-header-actions">
        <div className="concept-wallet-shell">
          <span className="concept-wallet-icon">
            <WalletCards className="size-4" aria-hidden="true" />
          </span>
          <WalletConnectionButton>{walletLabel}</WalletConnectionButton>
        </div>
      </div>
    </header>
  );
}
