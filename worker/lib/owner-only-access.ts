import { decodeJwt } from "jose";
import { requireCloudflareAccess } from "./cloudflare-access";
import { ApiFailure } from "./http";

export const OWNER_LOGIN_PATH = "/admin/private-access";
export const OWNER_SESSION_COOKIE = "__Host-walletor_admin_session";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

interface OwnerOnlyEnvironment {
  WALLETOR_OWNER_ONLY?: string;
  WALLETOR_OWNER_EMAIL?: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
}

function cookie(request: Request, name: string): string | undefined {
  const entries = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`));
  if (entries.length !== 1) return undefined;
  const value = entries[0]?.slice(name.length + 1);
  return value && value.length <= 16_384 ? value : undefined;
}

function loginUrl(request: Request): URL {
  const requested = new URL(request.url);
  const login = new URL(OWNER_LOGIN_PATH, requested.origin);
  login.searchParams.set(
    "returnTo",
    `${requested.pathname}${requested.search}`,
  );
  return login;
}

function returnUrl(request: Request): URL {
  const url = new URL(request.url);
  const path = url.searchParams.get("returnTo") ?? "/";
  if (!path.startsWith("/") || path.startsWith("//"))
    return new URL("/", url.origin);
  try {
    const destination = new URL(path, url.origin);
    if (
      destination.origin === url.origin &&
      destination.pathname !== OWNER_LOGIN_PATH
    )
      return destination;
  } catch {
    return new URL("/", url.origin);
  }
  return new URL("/", url.origin);
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders))
    headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function denied(request: Request, error: unknown): Response {
  const status = error instanceof ApiFailure ? error.status : 401;
  const url = new URL(request.url);
  const navigation =
    (request.method === "GET" || request.method === "HEAD") &&
    request.headers.get("Accept")?.includes("text/html") &&
    !/^\/(?:admin\/)?api(?:\/|$)/i.test(url.pathname);
  if (navigation && status === 401 && url.pathname !== OWNER_LOGIN_PATH) {
    return new Response(null, {
      status: 302,
      headers: { ...privateHeaders, Location: loginUrl(request).toString() },
    });
  }
  if (navigation) {
    return new Response(
      request.method === "HEAD"
        ? null
        : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Walletor · Private access</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050b15;color:#e7eefb;font:16px system-ui}main{max-width:420px;padding:32px}h1{font-size:28px}p{color:#9fb0c8;line-height:1.6}a{color:#71dcb2}</style></head><body><main><h1>Walletor is temporarily private</h1><p>Access is limited to the owner’s authorized admin account.</p><a href="${OWNER_LOGIN_PATH}">Admin sign in</a></main></body></html>`,
      {
        status,
        headers: {
          ...privateHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        },
      },
    );
  }
  return Response.json(
    {
      error: {
        code:
          status === 503
            ? "WALLETOR_PRIVATE_ACCESS_NOT_CONFIGURED"
            : "WALLETOR_PRIVATE_ACCESS_REQUIRED",
        message:
          "Walletor is temporarily private. Sign in with the authorized owner account.",
      },
    },
    { status, headers: privateHeaders },
  );
}

/** Gate every HTTP request before public routes, static assets or API handlers. */
export async function withOwnerOnlyAccess(
  request: Request,
  env: OwnerOnlyEnvironment,
  next: () => Promise<Response>,
): Promise<Response> {
  if (
    env.WALLETOR_OWNER_ONLY === undefined ||
    env.WALLETOR_OWNER_ONLY === "false"
  )
    return next();
  const owner = env.WALLETOR_OWNER_EMAIL?.trim().toLowerCase();
  const assertion =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    cookie(request, OWNER_SESSION_COOKIE) ??
    cookie(request, "CF_Authorization");
  try {
    if (!owner || owner.includes(",") || owner.length > 254) {
      throw new ApiFailure(
        503,
        "WALLETOR_PRIVATE_ACCESS_NOT_CONFIGURED",
        "Owner access is not configured.",
        false,
      );
    }
    await requireCloudflareAccess(assertion, {
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
      CLOUDFLARE_ACCESS_AUD: env.CLOUDFLARE_ACCESS_AUD,
      ADMIN_ALLOWED_EMAILS: owner,
    });
  } catch (error) {
    return denied(request, error);
  }

  if (new URL(request.url).pathname === OWNER_LOGIN_PATH) {
    // This exact path is protected by the existing /admin/* Access application.
    // Reuse its already-verified JWT in a host-only, HttpOnly cookie so the same
    // signed session reaches pages outside the original admin path as well.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { ...privateHeaders, Allow: "GET, HEAD" },
      });
    }
    const expires = assertion ? decodeJwt(assertion).exp : undefined;
    const maxAge = Math.max(
      0,
      Math.min(30 * 24 * 3600, Math.floor((expires ?? 0) - Date.now() / 1000)),
    );
    return new Response(null, {
      status: 302,
      headers: {
        ...privateHeaders,
        Location: returnUrl(request).toString(),
        "Set-Cookie": `${OWNER_SESSION_COOKIE}=${assertion ?? ""}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}`,
      },
    });
  }
  return privateResponse(await next());
}
