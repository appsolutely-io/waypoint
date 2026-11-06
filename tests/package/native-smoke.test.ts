import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

it("native graph follows lazy chunks and refuses missing chunks and runtime imports", () => {
  mkdirSync(".api-temp", { recursive: true });
  const root = mkdtempSync(".api-temp/native-graph-");
  const run = () =>
    spawnSync(
      process.execPath,
      ["scripts/native-smoke.mjs", resolve(root, "index.js")],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(
      `${root}/index.js`,
      'export const open=()=>import("./lazy.js");',
    );
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("lazy.js");
    writeFileSync(`${root}/lazy.js`, "export const value=1;");
    expect(run().status).toBe(0);
    for (const dependency of ["node:fs", "react-dom", "fs"]) {
      writeFileSync(
        `${root}/lazy.js`,
        `export * from ${JSON.stringify(dependency)};`,
      );
      const refused = run();
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("Forbidden native runtime import");
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});
