export class ApiFailure extends Error {
  constructor(
    readonly status:
      400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503 | 504,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function requestIdFrom(c: {
  req: { header(name: string): string | undefined };
}): string {
  return c.req.header("cf-ray") ?? crypto.randomUUID();
}

export function publicCacheHeaders(seconds: number): Record<string, string> {
  const staleSeconds = seconds * 3;
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${String(seconds)}, stale-while-revalidate=${String(staleSeconds)}, stale-if-error=300`,
    Vary: "Accept-Encoding",
  };
}
