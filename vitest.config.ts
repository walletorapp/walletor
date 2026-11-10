import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "worker/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    coverage: { reporter: ["text", "html"] },
  },
});
