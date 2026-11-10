import { authorizeBearer } from "../lib/auth";
import { ZealyVerificationSchema } from "../accounting/zealy";
import { verifyZealyTask } from "../accounting/runtime";

export const ZEALY_VERIFY_PATH = "/api/integrations/zealy/daily-swap";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const fail = (message: string) =>
  Response.json({ message }, { status: 400, headers });

async function readPayload(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error("JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function handleZealyTask(
  request: Request,
  env: Partial<Env>,
): Promise<Response> {
  if (request.method !== "POST")
    return fail("Use POST for Zealy verification.");
  const key = request.headers.get("X-Api-Key");
  try {
    if (
      !key ||
      key.length > 256 ||
      !env.ZEALY_API_KEY ||
      env.ZEALY_API_KEY.length < 32
    )
      return fail("Invalid verification API key.");
    await authorizeBearer(`Bearer ${key}`, env.ZEALY_API_KEY, {
      notConfiguredCode: "ZEALY_NOT_CONFIGURED",
      notConfiguredMessage: "Zealy is not configured.",
      unauthorizedCode: "ZEALY_UNAUTHORIZED",
      unauthorizedMessage: "Invalid verification API key.",
    });
  } catch {
    return fail("Invalid verification API key.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Zealy requires a response within ten seconds. All writes are idempotent
    // if the coordinator finishes after this response deadline.
    return await Promise.race([
      (async () => {
        const input = ZealyVerificationSchema.safeParse(
          await readPayload(request),
        );
        if (!input.success)
          return fail("Connect your Solana wallet in Zealy and try again.");
        if (input.data.subdomain !== env.ZEALY_COMMUNITY_SUBDOMAIN)
          return fail("This API key is not enabled for this community.");
        if (!env.ZEALY_RATE_LIMIT)
          return fail(
            "Verification is temporarily unavailable. Please retry shortly.",
          );
        const limited = await env.ZEALY_RATE_LIMIT.limit({
          key: `${input.data.subdomain}:${input.data.userId}`,
        });
        if (!limited.success)
          return fail(
            "Too many verification attempts. Please try again in one minute.",
          );
        const result = await verifyZealyTask(
          env,
          input.data,
          new Date().toISOString(),
        );
        if (result === "VERIFIED")
          return Response.json(
            { message: "Today's eligible Walletor swap is verified." },
            { headers },
          );
        if (result === "WALLET_BOUND")
          return fail(
            "This wallet or Zealy account is already linked. Contact support@walletor.com.",
          );
        if (result === "OTHER_QUEST")
          return fail(
            "This wallet has already used today's swap for another daily-swap quest.",
          );
        if (result === "NOT_STARTED")
          return fail("This campaign has not started yet.");
        return fail(
          "Complete a new eligible Walletor swap of $5 or more today (UTC), using your connected Solana wallet. Earlier campaign swaps do not count. If you just swapped, wait for reward verification and retry.",
        );
      })(),
      new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          resolve(
            fail(
              "Verification is temporarily unavailable. Please retry shortly.",
            ),
          );
        }, 7000);
      }),
    ]);
  } catch {
    return fail(
      "Verification is temporarily unavailable. Please retry shortly.",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
