export function isAdminPath(path: string): boolean {
  try {
    // React routes are case-insensitive and may decode URL segments.
    return /^\/admin(?:\/|$)/i.test(decodeURIComponent(path));
  } catch {
    return /^\/admin/i.test(path);
  }
}
