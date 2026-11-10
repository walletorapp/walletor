import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { ConceptRail } from "./ConceptRail";
import { ConceptSocialFooter } from "./ConceptSocialFooter";
import { PrizeReactor } from "./PrizeReactor";
import { TerminalHeader } from "./TerminalHeader";
import { TradingDeck } from "./TradingDeck";
import { WalletorEnginePanel } from "./WalletorEnginePanel";
import "./concept-two.css";

export function WalletorConceptTwo() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const targetId = location.hash.slice(1);
    if (!targetId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [location.hash]);

  return (
    <div className="walletor-concept-two concept-home-page">
      <div className="concept-ambient concept-ambient-a" />
      <div className="concept-ambient concept-ambient-b" />
      <ConceptRail
        mobileOpen={menuOpen}
        onMobileClose={() => {
          setMenuOpen(false);
        }}
      />

      <div className="concept-shell">
        <TerminalHeader
          menuOpen={menuOpen}
          onMenuOpen={() => {
            setMenuOpen(true);
          }}
        />

        <main className="concept-main">
          <div className="concept-grid">
            <TradingDeck />
            <PrizeReactor />
          </div>

          <WalletorEnginePanel variant="page" />

          <ConceptSocialFooter />
        </main>
      </div>
    </div>
  );
}
