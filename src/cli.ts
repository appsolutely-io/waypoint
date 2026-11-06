#!/usr/bin/env node
import { runConformance } from "./conformance/index";
const baseUrl = process.argv[2];
if (!baseUrl) throw new Error("Provide a test base URL");
const result = await runConformance({
  baseUrl,
  profile: process.argv.includes("--app-host") ? "app-host" : "admin-host",
  request: async (path, init) => {
    const r = await fetch(baseUrl + path, init);
    return { status: r.status, body: await r.json() };
  },
});
process.stdout.write(JSON.stringify(result) + "\n");
if (!result.passed) process.exitCode = 1;
