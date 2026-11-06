import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    maxWorkers: 2,
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
  },
  esbuild: { jsx: "automatic" },
});
