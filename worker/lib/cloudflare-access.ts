import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { AdminActor } from "../../shared/admin-contracts";
import { ApiFailure } from "./http";

const keySets = new Map<string, JWTVerifyGetKey>();

function accessIssuer(rawDomain: string): string {
  const value = rawDomain.trim();
  const url = new URL(
    value.startsWith("https://") ? value : `https://${value}`,
  );
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid Cloudflare Access team domain.");
  }
  return url.origin;
}

function remoteKeySet(issuer: string): JWTVerifyGetKey {
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  const existing = keySets.get(certsUrl);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(certsUrl));
  keySets.set(certsUrl, created);
  return created;
}

export async function requireCloudflareAccess(
  assertion: string | undefined,
  env: Partial<Env>,
): Promise<AdminActor> {
  const rawTeamDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CLOUDFLARE_ACCESS_AUD?.trim();
  const allowedEmails = (env.ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!rawTeamDomain || !audience || allowedEmails.length === 0) {
    throw new ApiFailure(
      503,
      "ADMIN_ACCESS_NOT_CONFIGURED",
      "Walletor Admin is not configured for Cloudflare Access yet.",
      false,
    );
  }
  if (!assertion) {
    throw new ApiFailure(
      401,
      "ADMIN_ACCESS_REQUIRED",
      "Authenticate through Cloudflare Access to open Walletor Admin.",
      false,
    );
  }

  try {
    const issuer = accessIssuer(rawTeamDomain);
    const { payload } = await jwtVerify(assertion, remoteKeySet(issuer), {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "email"],
    });
    if (typeof payload.email !== "string" || payload.email.length > 254) {
      throw new Error("Cloudflare Access token has no valid email claim.");
    }
    if (!allowedEmails.includes(payload.email.toLowerCase())) {
      throw new ApiFailure(
        403,
        "ADMIN_ACCESS_DENIED",
        "This account is not authorized for Walletor Admin.",
        false,
      );
    }
    return { email: payload.email };
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(
      401,
      "ADMIN_ACCESS_INVALID",
      "The Cloudflare Access session is invalid or expired.",
      false,
    );
  }
}
