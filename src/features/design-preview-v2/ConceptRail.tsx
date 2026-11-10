import {
  ArrowLeftRight,
  Sprout,
  BookOpenText,
  ChartNoAxesCombined,
  Clock3,
  Gem,
  Gift,
  Users,
  Rocket,
  Trophy,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { walletorRoutes } from "./routes";

const items = [
  {
    label: "Swap",
    icon: ArrowLeftRight,
    path: walletorRoutes.home,
  },
  { label: "Trenches", icon: Sprout, path: walletorRoutes.launches },
  {
    label: "Claims",
    icon: Gem,
    path: walletorRoutes.claim,
  },
  {
    label: "Stocks",
    icon: ChartNoAxesCombined,
    path: walletorRoutes.stocksRwa,
  },
  {
    label: "Rewards",
    icon: Gift,
    path: walletorRoutes.rewards,
  },
  {
    label: "Airdrop",
    icon: Rocket,
    path: walletorRoutes.airdrop,
  },
  { label: "History", icon: Clock3, path: walletorRoutes.history },
  { label: "Referral", icon: Users, path: "/referal" },
  { label: "Leaderboard", icon: Trophy, path: "/leaderboard" },
] as const;

const mobileItems = items.filter((item) =>
  ["Swap", "Trenches", "Claims", "Rewards", "Airdrop"].includes(item.label),
);

interface ConceptRailProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function ConceptRail({ mobileOpen, onMobileClose }: ConceptRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const activePath = location.pathname;

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      <button
        type="button"
        className={`concept-rail-backdrop ${mobileOpen ? "is-open" : ""}`}
        aria-label="Close navigation menu"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={onMobileClose}
      />
      <aside
        id="concept-navigation"
        className={`concept-rail ${mobileOpen ? "is-mobile-open" : ""}`}
        aria-label="Walletor navigation"
      >
        <button
          type="button"
          className="concept-rail-close"
          aria-label="Close navigation menu"
          onClick={onMobileClose}
        >
          <X className="size-[19px]" aria-hidden="true" />
        </button>
        <Link
          to={walletorRoutes.home}
          className="concept-rail-brand"
          aria-label="Go to Walletor homepage"
          onClick={onMobileClose}
        >
          <img
            className="concept-rail-logo"
            src="/assets/walletor-logo-animated-clean.webp"
            alt=""
            aria-hidden="true"
          />
          <div className="concept-rail-wordmark">
            <strong>Walletor</strong>
          </div>
        </Link>

        <nav className="concept-rail-nav" aria-label="Concept sections">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.label}
                aria-current={item.path === activePath ? "page" : undefined}
                className={`concept-rail-item ${
                  item.path === activePath ? "is-active" : ""
                }`}
                onClick={() => {
                  void navigate(item.path);
                  onMobileClose();
                }}
              >
                {item.label === "Claims" ? (
                  <span
                    className="concept-rail-item__signal"
                    aria-hidden="true"
                  />
                ) : null}
                <Icon className="size-[18px]" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
          <a
            className="concept-rail-item"
            href="https://www.docs.walletor.com"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpenText className="size-[18px]" aria-hidden="true" />
            <span>Docs</span>
          </a>
        </nav>

        <div className="concept-rail-foot">
          <span className="concept-signal" />
          <span>Live engine</span>
        </div>
      </aside>

      <nav
        className="concept-mobile-dock"
        aria-label="Walletor mobile navigation"
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = item.path === activePath;

          return (
            <Link
              key={item.label}
              to={item.path}
              className={active ? "is-active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={onMobileClose}
            >
              {item.label === "Claims" ? (
                <span
                  className="concept-mobile-item__signal"
                  aria-hidden="true"
                />
              ) : null}
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
