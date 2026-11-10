import { useState } from "react";

export function TokenAvatar({
  logoUrl,
  symbol,
  size = "md",
}: {
  logoUrl: string | null;
  symbol: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const visibleLogoUrl = logoUrl && logoUrl !== failedLogoUrl ? logoUrl : null;
  const fallback =
    symbol
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <span className={`token-avatar token-avatar--${size}`} aria-hidden="true">
      {visibleLogoUrl ? (
        <img
          src={visibleLogoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => {
            setFailedLogoUrl(visibleLogoUrl);
          }}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
