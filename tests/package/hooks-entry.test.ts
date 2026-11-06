import { it, expect } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pkg from "../../package.json";

it("the hooks entry is a public export with types, ESM and CommonJS", () => {
  expect(pkg.exports).toHaveProperty("./hooks", {
    types: "./dist/hooks/index.d.ts",
    import: "./dist/hooks/index.js",
    require: "./dist/hooks/index.cjs",
  });
  expect(existsSync("etc/hooks.api.md")).toBe(true);
});

it("the hooks entry's graph holds React and nothing that needs a DOM or a skin", () => {
  const smoke = spawnSync(
    process.execPath,
    ["scripts/native-smoke.mjs", "src/hooks/index.ts", "--allow-react"],
    { encoding: "utf8" },
  );
  expect(smoke.stderr).toBe("");
  expect(smoke.status).toBe(0);
  expect(smoke.stdout).not.toMatch(/src\/react\/ui\.tsx|\.css/);
  // Typed against the ES library only: a DOM type in its graph fails here.
  const typecheck = spawnSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "-p",
      "tsconfig.hooks.json",
    ],
    { encoding: "utf8" },
  );
  expect(typecheck.stdout + typecheck.stderr).toBe("");
  expect(typecheck.status).toBe(0);
});
