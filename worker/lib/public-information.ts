const PUBLIC_INFORMATION_PATHS = new Set([
  "/about-walletor",
  "/about-walletor.html",
  "/robots.txt",
  "/sitemap.xml",
]);

/** Public descriptions only; never authorizes the app, APIs or wallet actions. */
export function isPublicInformationRequest(request: Request): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    PUBLIC_INFORMATION_PATHS.has(new URL(request.url).pathname)
  );
}
