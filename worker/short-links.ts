const SHORT_HOSTS = new Set(["campaign.walletor.com", "short.walletor.com"]);
const SEGMENTO_ORIGIN = "https://referral.segmento.tech";

/** Branded links retain Segmento's short code; Segmento resolves the campaign. */
export function shortLinkResponse(request: Request): Response {
  const url = new URL(request.url);
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (!SHORT_HOSTS.has(url.hostname))
    return new Response("Not found", { status: 404, headers });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD" },
    });

  // Never accept destination URLs, nested paths or caller-supplied parameters.
  // Campaign/UTM data comes from the link registered in Segmento itself.
  if (url.pathname === "/")
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: "https://walletor.com/" },
    });
  if (!/^\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname))
    return new Response("Invalid short link", { status: 404, headers });
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: `${SEGMENTO_ORIGIN}${url.pathname}` },
  });
}

export default { fetch: shortLinkResponse } satisfies ExportedHandler;
