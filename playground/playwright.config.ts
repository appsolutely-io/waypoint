import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { playgroundPort } from "./port";

const url = `http://127.0.0.1:${playgroundPort()}`;

export default defineConfig({
  testDir: "../tests/playground",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: url,
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: "node --import tsx scripts/playground.mjs",
    url,
    reuseExistingServer: false,
  },
  reporter: "list",
});
