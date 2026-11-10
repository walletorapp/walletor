import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeftRight,
  Clock3,
  Coins,
  Gift,
  HandCoins,
  Menu,
  MessagesSquare,
  Search,
  Send,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { WalletorLogo } from "../components/WalletorLogo";
import { HowItWorksButton } from "../components/HowItWorksButton";
import { OPEN_TOKEN_SEARCH_EVENT } from "../features/swap/events";
import { WalletConnectionButton } from "../features/swap/WalletConnectionButton";

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, publicKey, wallet } = useWallet();
  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : null;
  const walletLabel = connected
    ? `${wallet?.adapter.name ?? "Wallet"} · ${shortAddress ?? "Connected"}`
    : "Connect Wallet";

  return (
    <div className="reference-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="reference-header">
        <button
          type="button"
          className="reference-menu-button"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          onClick={() => {
            setMobileOpen((value) => !value);
          }}
        >
          {mobileOpen ? <X /> : <Menu />}
        </button>

        <nav
          className={`reference-nav ${mobileOpen ? "reference-nav--open" : ""}`}
          aria-label="Primary navigation"
        >
          <div className="reference-nav__section">
            <span className="reference-nav__section-title">Trade</span>
            <NavLink
              to="/swap"
              end
              className={() =>
                location.pathname === "/swap" && !location.search
                  ? "active"
                  : ""
              }
              onClick={() => {
                setMobileOpen(false);
              }}
            >
              <ArrowLeftRight aria-hidden="true" />
              <span>Swap</span>
            </NavLink>
          </div>

          <div className="reference-nav__section">
            <span className="reference-nav__section-title">Earn</span>
            <NavLink
              to="/revenue-pool"
              onClick={() => {
                setMobileOpen(false);
              }}
            >
              <Coins aria-hidden="true" />
              <span>Prize Pool</span>
            </NavLink>
            <NavLink
              to="/rewards"
              onClick={() => {
                setMobileOpen(false);
              }}
            >
              <Gift aria-hidden="true" />
              <span>Rewards</span>
              <small>WLT</small>
            </NavLink>
            <NavLink
              to="/claim-rewards"
              onClick={() => {
                setMobileOpen(false);
              }}
            >
              <HandCoins aria-hidden="true" />
              <span>Claim Rewards</span>
            </NavLink>
          </div>

          <div className="reference-nav__section">
            <span className="reference-nav__section-title">Manage</span>
            <Link
              to="/swap?view=history"
              className={
                location.pathname === "/swap" &&
                location.search === "?view=history"
                  ? "active"
                  : ""
              }
              aria-current={
                location.pathname === "/swap" &&
                location.search === "?view=history"
                  ? "page"
                  : undefined
              }
              onClick={() => {
                setMobileOpen(false);
              }}
            >
              <Clock3 aria-hidden="true" />
              <span>History</span>
            </Link>
          </div>
        </nav>

        <NavLink
          to="/swap"
          className="reference-brand"
          aria-label="Walletor home"
        >
          <WalletorLogo />
          <span>
            <strong>Walletor</strong>
          </span>
        </NavLink>

        <div
          className={`reference-actions ${
            connected
              ? "reference-actions--connected"
              : "reference-actions--disconnected"
          }`}
        >
          <button
            type="button"
            className="reference-search"
            onClick={() => {
              if (location.pathname === "/swap" && !location.search) {
                window.dispatchEvent(new Event(OPEN_TOKEN_SEARCH_EVENT));
                return;
              }
              void navigate("/swap?tokenSearch=open");
            }}
          >
            <Search size={19} aria-hidden="true" />
            <span>Search tokens...</span>
          </button>
          <WalletConnectionButton
            className={`reference-wallet-button ${
              connected
                ? "reference-wallet-button--connected"
                : "reference-wallet-button--disconnected"
            }`}
          >
            {walletLabel}
          </WalletConnectionButton>
        </div>
      </header>

      <main id="main-content" className="reference-content" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="reference-footer">
        <small className="reference-footer__safety">
          Walletor will never ask you for money or seed phrases or contact you.
        </small>
        <small>Join the Walletor community</small>
        <nav aria-label="Walletor social links">
          <a
            href="https://x.com/walletorai"
            target="_blank"
            rel="noreferrer"
            aria-label="Walletor on X"
          >
            <span className="social-x" aria-hidden="true">
              𝕏
            </span>
            X
          </a>
          <a
            href="https://t.me/walletorswap"
            target="_blank"
            rel="noreferrer"
            aria-label="Walletor on Telegram"
          >
            <Send aria-hidden="true" />
            Telegram
          </a>
          <a
            href="https://discord.gg/hUCrahcEZK"
            target="_blank"
            rel="noreferrer"
            aria-label="Walletor on Discord"
          >
            <MessagesSquare aria-hidden="true" />
            Discord
          </a>
        </nav>
        <HowItWorksButton className="how-it-works-trigger--footer" />
      </footer>
    </div>
  );
}
