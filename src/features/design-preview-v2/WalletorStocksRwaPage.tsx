import {
  ArrowRight,
  BadgeCheck,
  ChartNoAxesCombined,
  Clock3,
  Globe2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";

import { ConceptPageShell } from "./ConceptPageShell";
import { walletorRoutes } from "./routes";
import "./stocks-rwa-page.css";

const readinessItems = [
  {
    icon: BadgeCheck,
    title: "Verified assets only",
    description:
      "Stocks will be matched by their exact Solana mint—not by a ticker or token name that can be copied.",
  },
  {
    icon: LockKeyhole,
    title: "Always non-custodial",
    description:
      "Your connected wallet will review and sign every transaction. Walletor will never hold your assets or keys.",
  },
  {
    icon: Globe2,
    title: "Eligibility before access",
    description:
      "Issuer and jurisdiction checks must be ready before any tokenized-stock market can be enabled.",
  },
] as const;

export function WalletorStocksRwaPage() {
  return (
    <ConceptPageShell
      className="concept-stocks-rwa-page"
      mainClassName="concept-stocks-rwa-main"
    >
      <section className="rwa-coming-hero" aria-labelledby="rwa-coming-title">
        <div className="rwa-coming-hero__glow" aria-hidden="true" />
        <span className="rwa-coming-icon" aria-hidden="true">
          <ChartNoAxesCombined />
        </span>
        <span className="rwa-coming-badge">
          <Sparkles aria-hidden="true" /> Coming soon
        </span>
        <p className="rwa-coming-eyebrow">Stocks &amp; real-world assets</p>
        <h1 id="rwa-coming-title">A safer stock experience is on the way.</h1>
        <p className="rwa-coming-lead">
          Walletor is preparing verified tokenized-stock discovery with
          non-custodial execution and eligibility checks. Trading is disabled
          for everyone until those protections are complete.
        </p>
        <span className="rwa-coming-target">
          <Clock3 aria-hidden="true" /> Target: one month after Walletor&apos;s
          public launch
        </span>
        <div className="rwa-coming-actions">
          <Link
            className="rwa-coming-action rwa-coming-action--primary"
            to={walletorRoutes.home}
          >
            Trade crypto now <ArrowRight aria-hidden="true" />
          </Link>
          <a
            className="rwa-coming-action"
            href="https://www.docs.walletor.com"
            target="_blank"
            rel="noreferrer"
          >
            Read Walletor docs
          </a>
        </div>
      </section>

      <section
        className="rwa-readiness-grid"
        aria-label="Stocks launch safeguards"
      >
        {readinessItems.map(({ icon: Icon, title, description }) => (
          <article className="rwa-readiness-card" key={title}>
            <span aria-hidden="true">
              <Icon />
            </span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <aside
        className="rwa-coming-notice"
        aria-labelledby="rwa-coming-notice-title"
      >
        <ShieldCheck aria-hidden="true" />
        <span>
          <strong id="rwa-coming-notice-title">
            Not available for trading yet
          </strong>
          Tokenized stocks can have issuer, residency, investor-status, and
          country restrictions. Walletor will only launch markets that have been
          verified and approved for the user&apos;s eligibility. These assets
          provide tokenized economic exposure and are not presented as direct
          ownership of traditional shares.
        </span>
      </aside>
    </ConceptPageShell>
  );
}
