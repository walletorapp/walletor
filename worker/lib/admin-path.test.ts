import { expect, it } from "vitest";
import { isAdminPath } from "./admin-path";
it("protects the admin shell and API including case and encoded separators", () => {
  for (const path of [
    "/admin",
    "/admin/",
    "/admin/api/backups",
    "/ADMIN",
    "/%61dmin",
    "/admin%2fapi/session",
    "/admin%zz",
  ])
    expect(isAdminPath(path)).toBe(true);
  for (const path of [
    "/",
    "/claim-rewards",
    "/leaderboard",
    "/api/prize-pool",
    "/administrator",
  ])
    expect(isAdminPath(path)).toBe(false);
});
