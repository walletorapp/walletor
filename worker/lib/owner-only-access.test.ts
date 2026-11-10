// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  OWNER_LOGIN_PATH,
  OWNER_SESSION_COOKIE,
  withOwnerOnlyAccess,
} from "./owner-only-access";

const issuer = "https://owner-only-test.cloudflareaccess.com";
const audience = "walletor-admin-owner-test";
const email = "owner@example.com";
const env = {
  WALLETOR_OWNER_ONLY: "true",
  WALLETOR_OWNER_EMAIL: email,
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: issuer,
  CLOUDFLARE_ACCESS_AUD: audience,
  ADMIN_ALLOWED_EMAILS: "another-admin@walletor.com",
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  jwk = await exportJWK(keys.publicKey);
  jwk.kid = "owner-test";
  jwk.alg = "RS256";
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ keys: [jwk] }))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function token(
  overrides: {
    email?: string;
    audience?: string;
    issuer?: string;
    expiry?: number;
    noExpiry?: boolean;
  } = {},
) {
  let jwt = new SignJWT({ email: overrides.email ?? email })
    .setProtectedHeader({ alg: "RS256", kid: "owner-test" })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience);
  if (!overrides.noExpiry)
    jwt = jwt.setExpirationTime(
      overrides.expiry ?? Math.floor(Date.now() / 1000) + 3600,
    );
  return jwt.sign(keys.privateKey);
}
const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://walletor.com${path}`, { headers });

it.each([
  "/",
  "/trenches",
  "/tokens/So11111111111111111111111111111111111111112",
  "/assets/index.js",
  "/robots.txt",
  "/sitemap.xml",
  "/about-walletor",
  "/api/health",
  "/api/prize-pool",
  "/api/tokens/launches",
  "/api/swap/order",
  "/api/integrations/zealy/daily-swap",
  "/admin/api/claims",
])("blocks anonymous %s before its handler runs", async (path) => {
  const next = vi.fn(() => Promise.resolve(new Response("must not be public")));
  const response = await withOwnerOnlyAccess(request(path), env, next);
  expect(response.status).toBe(401);
  expect(next).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(await response.text()).not.toContain("must not be public");
});

it("closes write and preflight requests as well as page reads", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const next = vi.fn(() => Promise.resolve(new Response("unexpected")));
    const response = await withOwnerOnlyAccess(
      new Request("https://walletor.com/api/swap/execute", { method }),
      env,
      next,
    );
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  }
});

it("sends browser navigation through the existing protected admin login", async () => {
  const response = await withOwnerOnlyAccess(
    request("/trenches?ref=example", { Accept: "text/html" }),
    env,
    () => Promise.resolve(new Response("unexpected")),
  );
  expect(response.status).toBe(302);
  const destination = new URL(response.headers.get("location") ?? "");
  expect(destination.pathname).toBe(OWNER_LOGIN_PATH);
  expect(destination.searchParams.get("returnTo")).toBe(
    "/trenches?ref=example",
  );
});

it.each(["header", "cookie", "access-cookie"])(
  "accepts the configured owner's signed %s session and disables shared caches",
  async (source) => {
    const jwt = await token();
    const headers: Record<string, string> =
      source === "header"
        ? { "Cf-Access-Jwt-Assertion": jwt }
        : {
            Cookie: `${source === "cookie" ? OWNER_SESSION_COOKIE : "CF_Authorization"}=${jwt}`,
          };
    const next = vi.fn(() =>
      Promise.resolve(
        new Response("private app", {
          headers: { "Cache-Control": "public, max-age=86400" },
        }),
      ),
    );
    const response = await withOwnerOnlyAccess(
      request("/assets/index.js", headers),
      env,
      next,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private app");
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  },
);

it.each([
  { email: "another-owner@example.com" },
  { audience: "unrelated-app" },
  { issuer: "https://different.cloudflareaccess.com" },
  { expiry: 1 },
  { noExpiry: true },
])(
  "rejects signed sessions with unauthorized claims: %j",
  async (overrides) => {
    const next = vi.fn(() => Promise.resolve(new Response("unexpected")));
    const response = await withOwnerOnlyAccess(
      request("/api/prize-pool", {
        Cookie: `${OWNER_SESSION_COOKIE}=${await token(overrides)}`,
      }),
      env,
      next,
    );
    expect([401, 403]).toContain(response.status);
    expect(next).not.toHaveBeenCalled();
  },
);

it("rejects forged identity headers and malformed/ambiguous cookies", async () => {
  const attempts: Record<string, string>[] = [
    { "Cf-Access-Authenticated-User-Email": email },
    { "Cf-Access-Jwt-Assertion": "not-signed" },
    { Cookie: `${OWNER_SESSION_COOKIE}=forged` },
    {
      Cookie: `${OWNER_SESSION_COOKIE}=${await token()}; ${OWNER_SESSION_COOKIE}=forged`,
    },
  ];
  for (const headers of attempts) {
    const next = vi.fn(() => Promise.resolve(new Response("unexpected")));
    const response = await withOwnerOnlyAccess(
      request("/", headers),
      env,
      next,
    );
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  }
});

it("bootstraps a host-only HttpOnly owner session without extending the signed token lifetime", async () => {
  const jwt = await token();
  const next = vi.fn(() => Promise.resolve(new Response("unexpected")));
  const response = await withOwnerOnlyAccess(
    request(
      `${OWNER_LOGIN_PATH}?returnTo=${encodeURIComponent("/trenches?ref=example")}`,
      { "Cf-Access-Jwt-Assertion": jwt },
    ),
    env,
    next,
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://walletor.com/trenches?ref=example",
  );
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain(
    `${OWNER_SESSION_COOKIE}=${jwt}; Path=/; Secure; HttpOnly; SameSite=Lax;`,
  );
  const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
  expect(maxAge).toBeGreaterThan(0);
  expect(maxAge).toBeLessThanOrEqual(3600);
  expect(next).not.toHaveBeenCalled();
});

it.each([
  "https://evil.example/",
  "//evil.example/",
  "/\\evil.example/",
  OWNER_LOGIN_PATH,
])(
  "does not redirect the owner to an untrusted or looping return URL: %s",
  async (returnTo) => {
    const response = await withOwnerOnlyAccess(
      request(`${OWNER_LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`, {
        "Cf-Access-Jwt-Assertion": await token(),
      }),
      env,
      () => Promise.resolve(new Response("unexpected")),
    );
    expect(response.headers.get("location")).toBe("https://walletor.com/");
  },
);

it("fails closed when enabled without the owner/Access configuration", async () => {
  const next = vi.fn(() => Promise.resolve(new Response("unexpected")));
  const response = await withOwnerOnlyAccess(
    request("/"),
    { WALLETOR_OWNER_ONLY: "true" },
    next,
  );
  expect(response.status).toBe(503);
  expect(next).not.toHaveBeenCalled();
});

it("leaves the existing handler unchanged only when owner-only mode is explicitly disabled or absent", async () => {
  for (const settings of [{}, { WALLETOR_OWNER_ONLY: "false" }]) {
    const next = vi.fn(() => Promise.resolve(new Response("public")));
    const response = await withOwnerOnlyAccess(request("/"), settings, next);
    expect(await response.text()).toBe("public");
    expect(next).toHaveBeenCalledTimes(1);
  }
});
