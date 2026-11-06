import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

it("the consumer probe exercises lazy public operations in both module formats", async () => {
  mkdirSync(".api-temp", { recursive: true });
  const root = mkdtempSync(".api-temp/consumer-probe-");
  try {
    for (const format of ["esm", "cjs"] as const) {
      const entry = resolve(root, `index.${format === "esm" ? "mjs" : "cjs"}`);
      const bundle = await build({
        entryPoints: ["src/index.ts"],
        bundle: true,
        format,
        write: false,
        logLevel: "silent",
      });
      writeFileSync(entry, bundle.outputFiles[0]!.contents);
      const result = spawnSync(
        process.execPath,
        ["scripts/consumer-probe.mjs", format, entry],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        `${format}: lazy package operations passed`,
      );
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("the packed lazy probe discovers new entries and requires both formats", () => {
  mkdirSync(".api-temp", { recursive: true });
  const root = mkdtempSync(".api-temp/lazy-probe-");
  const run = (format: string) =>
    spawnSync(
      process.execPath,
      ["scripts/consumer-lazy-probe.mjs", resolve(root), format],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(`${root}/package.json`, '{"type":"module"}');
    writeFileSync(`${root}/index.d.ts`, "export {};");
    writeFileSync(`${root}/index.js`, 'throw new Error("Eager entry");');
    writeFileSync(`${root}/index.cjs`, 'throw new Error("Eager entry");');
    writeFileSync(`${root}/shared-types.d.ts`, "export {};");
    for (const entry of ["flow-parser", "form-session", "extra-lazy"]) {
      writeFileSync(`${root}/${entry}.d.ts`, "export {};");
      writeFileSync(`${root}/${entry}.js`, `console.log("esm:${entry}");`);
      writeFileSync(`${root}/${entry}.cjs`, `console.log("cjs:${entry}");`);
    }
    for (const format of ["esm", "cjs"]) {
      const result = run(format);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split("\n").sort()).toEqual(
        ["flow-parser", "form-session", "extra-lazy"]
          .map((entry) => `${format}:${entry}`)
          .sort(),
      );
    }
    rmSync(`${root}/extra-lazy.cjs`);
    const missing = run("cjs");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("extra-lazy.cjs");
  } finally {
    rmSync(root, { recursive: true });
  }
});
