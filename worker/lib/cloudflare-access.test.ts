import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireCloudflareAccess } from "./cloudflare-access";

describe("Cloudflare Access admin authentication", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails closed when the Access binding is incomplete", async () => {
    await expect(
      requireCloudflareAccess(undefined, {
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "walletor.cloudflareaccess.com",
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "ADMIN_ACCESS_NOT_CONFIGURED",
    });
  });

  it("rejects a request without a signed Access assertion", async () => {
    await expect(
      requireCloudflareAccess(undefined, {
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "walletor.cloudflareaccess.com",
        CLOUDFLARE_ACCESS_AUD: "test-audience",
        ADMIN_ALLOWED_EMAILS: "admin@walletor.com",
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "ADMIN_ACCESS_REQUIRED",
    });
  });

  it("rejects malformed assertions without exposing verification details", async () => {
    await expect(
      requireCloudflareAccess("not-a-jwt", {
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "walletor.cloudflareaccess.com",
        CLOUDFLARE_ACCESS_AUD: "test-audience",
        ADMIN_ALLOWED_EMAILS: "admin@walletor.com",
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "ADMIN_ACCESS_INVALID",
    });
  });

  it("accepts a correctly signed token for the configured issuer and audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "walletor-admin-test";
    publicJwk.alg = "RS256";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ keys: [publicJwk] })),
    );
    const issuer = "https://walletor-admin-test.cloudflareaccess.com";
    const audience = "walletor-admin-audience";
    const assertion = await new SignJWT({ email: "admin@walletor.com" })
      .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      requireCloudflareAccess(assertion, {
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: issuer,
        CLOUDFLARE_ACCESS_AUD: audience,
        ADMIN_ALLOWED_EMAILS: "admin@walletor.com",
      }),
    ).resolves.toEqual({ email: "admin@walletor.com" });
  });
  it.each([
    {
      name: "unapproved email",
      email: "stranger@walletor.com",
      expires: true,
      code: "ADMIN_ACCESS_DENIED",
      status: 403,
    },
    {
      name: "missing expiry",
      email: "admin@walletor.com",
      expires: false,
      code: "ADMIN_ACCESS_INVALID",
      status: 401,
    },
  ])(
    "rejects correctly signed tokens with $name",
    async ({ email, expires, code, status }) => {
      const { privateKey, publicKey } = await generateKeyPair("RS256", {
        extractable: true,
      });
      const jwk = await exportJWK(publicKey);
      jwk.kid = "negative-access-test";
      const issuer = `https://negative-${String(expires)}.cloudflareaccess.com`;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ keys: [jwk] })),
      );
      let token = new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience("admin");
      if (expires) token = token.setExpirationTime("5m");
      await expect(
        requireCloudflareAccess(await token.sign(privateKey), {
          CLOUDFLARE_ACCESS_TEAM_DOMAIN: issuer,
          CLOUDFLARE_ACCESS_AUD: "admin",
          ADMIN_ALLOWED_EMAILS: "admin@walletor.com",
        }),
      ).rejects.toMatchObject({ code, status });
    },
  );
});
