import { useState, type ReactNode } from "react";

import { ConceptRail } from "./ConceptRail";
import { ConceptSocialFooter } from "./ConceptSocialFooter";
import { TerminalHeader } from "./TerminalHeader";
import "./concept-two.css";

interface ConceptPageShellProps {
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}

export function ConceptPageShell({
  children,
  className = "",
  mainClassName = "",
}: ConceptPageShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`walletor-concept-two concept-subpage ${className}`.trim()}>
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
        <main className={`concept-main ${mainClassName}`.trim()}>
          {children}
          <ConceptSocialFooter />
        </main>
      </div>
    </div>
  );
}
