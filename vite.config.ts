import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const browserNodeShimPaths = new Map([
  [
    "buffer",
    fileURLToPath(new URL("./src/shims/buffer-browser.ts", import.meta.url)),
  ],
  [
    "https",
    fileURLToPath(new URL("./src/shims/https-browser.ts", import.meta.url)),
  ],
]);

function browserNodeShims(): Plugin {
  return {
    name: "walletor-browser-node-shims",
    enforce: "pre",
    resolveId(source) {
      if (this.environment.name !== "client") return null;
      return browserNodeShimPaths.get(source) ?? null;
    },
  };
}

function workerAnchorCompatibility(): Plugin {
  return {
    name: "walletor-worker-anchor-compatibility",
    enforce: "pre",
    async resolveId(source, importer) {
      if (this.environment.name === "client") return null;
      if (source !== "@coral-xyz/anchor" && source !== "@coral-xyz/anchor-31")
        return null;
      // Anchor's ESM entry uses CommonJS exports during Worker startup.
      // Select its published CJS build so the bundler can transform those uses.
      return this.resolve(`${source}/dist/cjs/index.js`, importer, {
        skipSelf: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [
    browserNodeShims(),
    workerAnchorCompatibility(),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
  optimizeDeps: {
    rolldownOptions: {
      plugins: [
        {
          name: "walletor-optimized-browser-node-shims",
          resolveId(source) {
            return browserNodeShimPaths.get(source) ?? null;
          },
        },
      ],
    },
  },
});
