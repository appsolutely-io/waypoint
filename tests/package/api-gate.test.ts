import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
it("API checking refuses a missing declaration entry", () => {
  mkdirSync(".api-temp", { recursive: true });
  const directory = mkdtempSync(".api-temp/missing-api-");
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/api.mjs"), "--entry=react"],
      { cwd: directory, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist/react/index.d.ts");
  } finally {
    rmSync(directory, { recursive: true });
  }
});
