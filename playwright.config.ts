import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:43197",
    headless: true,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: "node --import tsx scripts/browser-fixture.mjs",
    url: "http://127.0.0.1:43197/tests/browser/index.html",
    reuseExistingServer: false,
  },
  reporter: "list",
});
