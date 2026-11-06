import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

it("the production size command refuses an oversized reachable recovery payload", () => {
  const budgets = createRequire(import.meta.url)("../../.size-limit.cjs") as {
    name: string;
    limit: string;
  }[];
  const budget = budgets.find(
    (check) => check.name === "core with lazy recovery",
  )!;
  mkdirSync(".api-temp", { recursive: true });
  const root = mkdtempSync(".api-temp/production-size-");
  const run = () =>
    spawnSync(
      "npm",
      [
        "--silent",
        "run",
        "size",
        "--",
        "--config",
        resolve(root, ".size-limit.cjs"),
        "--json",
      ],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(
      `${root}/.size-limit.cjs`,
      `module.exports = require(${JSON.stringify(resolve(".size-limit.cjs"))})\n.filter(check => check.name === "core with lazy recovery")\n.map(check => ({ ...check, path: "index.js" }));\n`,
    );
    writeFileSync(
      `${root}/index.js`,
      'export const open=()=>import("./frame-decoder.js");',
    );
    writeFileSync(`${root}/frame-decoder.js`, 'export const value="small";');
    const small = run();
    expect(small.status, small.stdout + small.stderr).toBe(0);
    writeFileSync(
      `${root}/frame-decoder.js`,
      `export const value=${JSON.stringify(randomBytes(35000).toString("hex"))};`,
    );
    const oversized = run();
    expect(oversized.status, oversized.stdout + oversized.stderr).toBe(1);
    const checks = JSON.parse(oversized.stdout) as {
      name: string;
      passed: boolean;
      size: number;
      sizeLimit: number;
    }[];
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      name: "core with lazy recovery",
      passed: false,
      sizeLimit: Number.parseFloat(budget.limit) * 1000,
    });
    expect(checks[0]!.size).toBeGreaterThan(checks[0]!.sizeLimit);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// A fixture build: an entry, a lazy chunk it imports dynamically, and a
// chunk only the lazy chunk imports, with the metafile the build writes.
// Its paths are relative to its root, as the real ones are to the config.
function fixtureBuild(sharedCode = 'export const t="messages";') {
  mkdirSync(".api-temp", { recursive: true });
  const root = mkdtempSync(".api-temp/shared-chunks-");
  mkdirSync(`${root}/dist`);
  writeFileSync(
    `${root}/dist/index.js`,
    'export const open=()=>import("./lazy-A.js");',
  );
  writeFileSync(
    `${root}/dist/lazy-A.js`,
    'import{t}from"./chunk-B.js";export default t;',
  );
  writeFileSync(`${root}/dist/chunk-B.js`, sharedCode);
  const output = (
    imports: { path: string; kind: string }[],
    inputs: string[],
  ) => ({
    imports,
    inputs: Object.fromEntries(inputs.map((input) => [input, {}])),
  });
  writeFileSync(
    `${root}/dist/metafile-esm.json`,
    JSON.stringify({
      outputs: {
        "dist/index.js": output(
          [{ path: "dist/lazy-A.js", kind: "dynamic-import" }],
          ["src/index.ts"],
        ),
        "dist/lazy-A.js": output(
          [{ path: "dist/chunk-B.js", kind: "import-statement" }],
          ["src/lazy.ts"],
        ),
        "dist/chunk-B.js": output([], ["src/messages.ts"]),
        "dist/index.cjs": output([], ["src/index.ts"]),
      },
    }),
  );
  const budgets = [
    {
      name: "entry",
      path: "dist/index.js",
      limit: "1 KB",
      gzip: true,
      ignore: ["./lazy-*"],
    },
    {
      name: "lazy",
      path: "dist/lazy-*.js",
      limit: "1 KB",
      gzip: true,
      ignore: ["./chunk-*"],
    },
  ];
  const shared = [
    {
      name: "lazy messages",
      source: "src/messages.ts",
      limit: "1 KB",
      gzip: true,
    },
  ];
  return { root, budgets, shared, options: { root, dist: "dist", shared } };
}
const { withSharedChunks } = createRequire(import.meta.url)(
  "../../scripts/size-budgets.cjs",
) as {
  withSharedChunks(
    budgets: { name: string; path: string; ignore?: string[] }[],
    options: { root: string; dist: string; shared: object[] },
  ): { name: string; path: string }[];
};

it("each shared lazy chunk gets its own budget, found by the module it holds", () => {
  const { root, budgets, options } = fixtureBuild();
  try {
    const all = withSharedChunks(budgets, options);
    expect(all.map((budget) => [budget.name, budget.path])).toEqual([
      ["entry", "dist/index.js"],
      ["lazy", "dist/lazy-*.js"],
      ["lazy messages", "dist/chunk-B.js"],
    ]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("a build with a chunk no budget measures is refused", () => {
  const { root, budgets, options } = fixtureBuild();
  try {
    expect(() => withSharedChunks(budgets, { ...options, shared: [] })).toThrow(
      "No size budget measures chunk-B.js",
    );
    // A lazy chunk without a budget of its own is refused the same way.
    expect(() =>
      withSharedChunks(budgets.slice(0, 1), { ...options, shared: [] }),
    ).toThrow("No size budget measures lazy-A.js, chunk-B.js");
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("a shared budget whose module is not in exactly one chunk is refused", () => {
  const { root, budgets, shared, options } = fixtureBuild();
  try {
    expect(() =>
      withSharedChunks(budgets, {
        ...options,
        shared: [{ ...shared[0], source: "src/moved.ts" }],
      }),
    ).toThrow("lazy messages: src/moved.ts is in 0 outputs, not one");
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("a build without its metafile is refused; no build at all is not", () => {
  const { root, budgets, options } = fixtureBuild();
  try {
    rmSync(`${root}/dist/metafile-esm.json`);
    expect(() => withSharedChunks(budgets, options)).toThrow(
      "metafile-esm.json is missing",
    );
    expect(withSharedChunks(budgets, { ...options, dist: "none" })).toBe(
      budgets,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("the production size command refuses an oversized shared lazy chunk", () => {
  const { root, budgets, shared } = fixtureBuild(
    `export const t=${JSON.stringify(randomBytes(4000).toString("hex"))};`,
  );
  try {
    writeFileSync(
      `${root}/.size-limit.cjs`,
      `const { withSharedChunks } = require(${JSON.stringify(
        resolve("scripts/size-budgets.cjs"),
      )});\nmodule.exports = withSharedChunks(${JSON.stringify(
        budgets,
      )}, { root: __dirname, dist: "dist", shared: ${JSON.stringify(shared)} });\n`,
    );
    const run = spawnSync(
      "npm",
      [
        "--silent",
        "run",
        "size",
        "--",
        "--config",
        resolve(root, ".size-limit.cjs"),
        "--json",
      ],
      { encoding: "utf8" },
    );
    expect(run.status, run.stdout + run.stderr).toBe(1);
    const checks = JSON.parse(run.stdout) as {
      name: string;
      passed: boolean;
      size: number;
    }[];
    expect(checks.map((check) => [check.name, check.passed])).toEqual([
      ["entry", true],
      ["lazy", true],
      ["lazy messages", false],
    ]);
    // Each check measured its own file.
    for (const check of checks) expect(check.size).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true });
  }
});
