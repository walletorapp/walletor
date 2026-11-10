interface DesignPreviewEnv {
  ASSETS: Fetcher;
  WALLETOR_API: Fetcher;
}

const API_PATH_PREFIX = "/api/";

function upstreamRequest(request: Request): Request {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(
    requestUrl.pathname + requestUrl.search,
    "https://walletor.internal",
  );
  const headers = new Headers(request.headers);
  headers.delete("host");

  return new Request(upstreamUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(new URL("/design-preview-2", url), 302);
    }

    if (url.pathname.startsWith(API_PATH_PREFIX)) {
      return env.WALLETOR_API.fetch(upstreamRequest(request));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<DesignPreviewEnv>;
