import { regionUnavailableHtml } from "./region-unavailable-page";

// Kosovo was reopened on 2026-10-13 at the owner's request.
const BLOCKED_COUNTRIES = new Set([
  "AF",
  "CN",
  "CD",
  "CI",
  "CU",
  "IR",
  "IQ",
  "KP",
  "LY",
  "MK",
  "ML",
  "MM",
  "NI",
  "PS",
  "RU",
  "RS",
  "SO",
  "SD",
  "SY",
  "US",
  "YE",
  "ZW",
]);
const UNITED_STATES_COUNTRY_CODE = "US";

function requestCountry(request: Request): string | null {
  const cloudflareCountry = request.cf?.country;
  const country =
    typeof cloudflareCountry === "string"
      ? cloudflareCountry
      : request.headers.get("CF-IPCountry");
  const normalized = country?.trim().toUpperCase();
  return normalized && /^[A-Z0-9]{2}$/.test(normalized) ? normalized : null;
}

export function unavailableCountry(request: Request): string | null {
  const country = requestCountry(request);
  return country && BLOCKED_COUNTRIES.has(country) ? country : null;
}

export function unavailableRwaCountry(request: Request): string | null {
  const country = requestCountry(request);
  return country === UNITED_STATES_COUNTRY_CODE ? country : null;
}

export function isRwaPageRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return path === "/stocks-rwa" || path.startsWith("/stocks-rwa/");
}

export function unavailableJurisdictionResponse(
  request: Request,
  country: string,
): Response {
  const path = new URL(request.url).pathname;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });

  if (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/admin/api" ||
    path.startsWith("/admin/api/")
  ) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE_IN_JURISDICTION",
          message: "Walletor is not available in your country or region.",
          retryable: false,
        },
        meta: { country },
      },
      { status: 451, headers },
    );
  }

  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(regionUnavailableHtml, { status: 451, headers });
}

export function unavailableRwaJurisdictionResponse(
  request: Request,
  country: string,
): Response {
  const path = new URL(request.url).pathname;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });

  if (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/admin/api" ||
    path.startsWith("/admin/api/")
  ) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    return Response.json(
      {
        error: {
          code: "RWA_UNAVAILABLE_IN_JURISDICTION",
          message:
            "Stocks (RWA) trading is unavailable in the United States or to U.S. persons.",
          retryable: false,
        },
        meta: { country },
      },
      { status: 451, headers },
    );
  }

  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stocks (RWA) unavailable</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 24px; color: #eef6ff; background: radial-gradient(circle at 50% 0%, #0d2440, #02060d 55%); }
      main { width: min(100%, 620px); padding: 40px; border: 1px solid #1d4268; border-radius: 24px; background: rgba(5, 13, 24, .92); box-shadow: 0 28px 80px rgba(0, 0, 0, .45); text-align: center; }
      span { display: inline-block; margin-bottom: 14px; color: #67c9ff; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(32px, 8vw, 48px); letter-spacing: -.04em; }
      p { margin: 18px auto 0; color: #9bb0c5; font-size: 17px; line-height: 1.6; }
      a { display: inline-flex; margin-top: 24px; color: #67c9ff; font-weight: 750; text-decoration: none; }
      a:focus-visible { outline: 2px solid #67c9ff; outline-offset: 4px; }
    </style>
  </head>
  <body>
    <main>
      <span>Regional restriction</span>
      <h1>Stocks (RWA) are unavailable in the United States.</h1>
      <p>Walletor does not provide access to tokenized-stock discovery, quotes, or execution from this location. These products are also unavailable to U.S. persons.</p>
      <a href="/swap">Return to crypto swaps</a>
    </main>
  </body>
</html>`,
    { status: 451, headers },
  );
}
