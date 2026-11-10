import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { stdout } from "node:process";

const browserSourceExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".map",
  ".ts",
  ".tsx",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return browserSourceExtensions.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

async function assertSecretNotBundled() {
  const files = [
    ...(await sourceFiles("src")),
    ...(await sourceFiles("dist/client")),
  ];
  const leakingFiles = [];
  for (const file of files) {
    if ((await readFile(file, "utf8")).includes("JUPITER_API_KEY")) {
      leakingFiles.push(file);
    }
  }
  if (leakingFiles.length > 0) {
    throw new Error(
      `JUPITER_API_KEY crossed the browser boundary: ${leakingFiles.join(", ")}`,
    );
  }
}

async function assertRwaTradingIsClosed() {
  const config = await readFile("wrangler.jsonc", "utf8");
  const requiredClosedFlags = [
    '"ENABLE_RWA_TRADING": "false"',
    '"ENABLE_RWA_REWARDS": "false"',
    '"ENABLE_JUPITERZ_ROUTE_BADGE": "false"',
  ];
  const missing = requiredClosedFlags.filter((flag) => !config.includes(flag));
  if (missing.length > 0) {
    throw new Error(
      `Launch-candidate RWA safety flags are missing: ${missing.join(", ")}`,
    );
  }
}

await Promise.all([assertSecretNotBundled(), assertRwaTradingIsClosed()]);
stdout.write(
  "Launch safety checks passed: browser secrets absent; RWA trading closed.\n",
);
