import { ApiFailure } from "./http";

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function constantTimeSecretMatch(
  provided: string,
  expected: string,
): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    digest(provided),
    digest(expected),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= (providedDigest[index] ?? 0) ^ (expectedDigest[index] ?? 0);
  }
  return difference === 0;
}

export async function authorizeBearer(
  authorization: string | undefined,
  secret: string | undefined,
  errors: Readonly<{
    notConfiguredCode: string;
    notConfiguredMessage: string;
    unauthorizedCode: string;
    unauthorizedMessage: string;
  }>,
): Promise<void> {
  if (!secret) {
    throw new ApiFailure(
      503,
      errors.notConfiguredCode,
      errors.notConfiguredMessage,
      false,
    );
  }
  const prefix = "Bearer ";
  const provided = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  if (!provided || !(await constantTimeSecretMatch(provided, secret))) {
    throw new ApiFailure(
      401,
      errors.unauthorizedCode,
      errors.unauthorizedMessage,
      false,
    );
  }
}
