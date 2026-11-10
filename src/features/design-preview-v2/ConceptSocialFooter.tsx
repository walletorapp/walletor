import { BookOpenText } from "lucide-react";
import { Link } from "react-router-dom";

interface BrandMarkProps {
  brand: "x" | "telegram" | "discord";
}

function BrandMark({ brand }: BrandMarkProps) {
  if (brand === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
      </svg>
    );
  }

  if (brand === "telegram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9.78 18.65.28-4.23 7.68-6.92c.34-.3-.07-.45-.52-.17L7.74 13.3 3.64 12c-.88-.25-.9-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.8c-.19.91-.74 1.13-1.5.71l-4.14-3.05-2 1.93c-.23.23-.42.42-.82.42Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.54 5.34A17.4 17.4 0 0 0 15.22 4l-.53 1.08a16.1 16.1 0 0 0-5.38 0L8.78 4a17.4 17.4 0 0 0-4.32 1.34C1.73 9.39.99 13.34 1.36 17.23a17.5 17.5 0 0 0 5.3 2.68l1.28-1.75a11.2 11.2 0 0 1-2.01-.97l.49-.37c3.88 1.79 8.09 1.79 11.93 0l.5.37c-.65.38-1.32.7-2.01.97l1.28 1.75a17.4 17.4 0 0 0 5.3-2.68c.43-4.51-.73-8.42-3.88-11.89ZM8.5 14.83c-1.17 0-2.12-1.08-2.12-2.41 0-1.33.93-2.42 2.12-2.42 1.2 0 2.14 1.09 2.12 2.42 0 1.33-.93 2.41-2.12 2.41Zm7 0c-1.17 0-2.12-1.08-2.12-2.41 0-1.33.93-2.42 2.12-2.42 1.2 0 2.14 1.09 2.12 2.42 0 1.33-.92 2.41-2.12 2.41Z" />
    </svg>
  );
}

const socialLinks = [
  {
    brand: "x" as const,
    label: "X",
    href: "https://x.com/walletorai",
  },
  {
    brand: "telegram" as const,
    label: "Telegram",
    href: "https://t.me/walletorswap",
  },
  {
    brand: "discord" as const,
    label: "Discord",
    href: "https://discord.gg/hUCrahcEZK",
  },
] as const;

export function ConceptSocialFooter() {
  return (
    <footer className="concept-social-footer">
      <Link className="concept-social-link" to="/leaderboard">
        Leaderboard & Winners
      </Link>
      <span className="concept-social-footer__title">Follow Us</span>
      <nav aria-label="Walletor social links">
        {socialLinks.map((social) => (
          <a
            key={social.brand}
            className={`concept-social-link concept-social-link--${social.brand}`}
            href={social.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Walletor on ${social.label}`}
          >
            <span className="concept-social-link__mark">
              <BrandMark brand={social.brand} />
            </span>
            <span>{social.label}</span>
          </a>
        ))}
      </nav>
      <a
        className="concept-social-link concept-social-link--docs"
        href="https://www.docs.walletor.com"
        target="_blank"
        rel="noreferrer"
        aria-label="Read Walletor documentation"
      >
        <span className="concept-social-link__mark">
          <BookOpenText aria-hidden="true" />
        </span>
        <span>Docs</span>
      </a>
      <p className="concept-social-footer__disclaimer">
        <strong>
          Walletor will never ask you for money or seed phrases or contact you.
        </strong>{" "}
        Walletor is a non-custodial interface. Digital-asset trading involves
        risk, and swaps, token values, rewards, and prize outcomes are not
        guaranteed. Nothing on Walletor is financial advice. Review the{" "}
        <a
          href="https://www.docs.walletor.com/legal/disclaimer/"
          target="_blank"
          rel="noreferrer"
        >
          full disclaimer
        </a>
        . <a href="/about-walletor">About Walletor</a>.{" "}
        <Link to="/referral-privacy">Referral tracking preferences</Link>.{" "}
        <Link to="/influencers">Influencer program</Link>.
      </p>
    </footer>
  );
}
