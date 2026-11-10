export function launchLink(
  value: string | null | undefined,
  kind: "website" | "twitter" | "telegram" = "website",
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      host.includes(":") ||
      /^[\d.]+$/.test(host) ||
      /\.(?:local|internal|localhost)$/.test(host)
    )
      return null;
    if (
      kind === "twitter" &&
      !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)
    )
      return null;
    if (
      kind === "telegram" &&
      !["t.me", "telegram.me", "www.t.me"].includes(host)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
