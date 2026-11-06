import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkPackedDist } from "./packed-dist.mjs";
const root = resolve(process.argv[2] ?? ".api-temp/consumers");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const name = manifest.name;
mkdirSync(root, { recursive: true });
const output = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", root],
    { encoding: "utf8" },
  ),
);
const tarball = join(root, output[0].filename);
for (const manager of ["npm", "pnpm"]) {
  const dir = join(root, manager);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "consumer-fixture",
      version: "1.0.0",
      private: true,
      type: "module",
    }),
  );
  const run = (bin, args) =>
    execFileSync(bin, args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
  run(
    manager,
    manager === "npm"
      ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]
      : ["add", "--ignore-scripts", tarball],
  );
  const installed = JSON.parse(
    readFileSync(join(dir, "node_modules", name, "package.json"), "utf8"),
  );
  assert.equal(installed.name, name);
  const hash = (path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(
    hash(join(dir, "node_modules", name, "dist/index.js")),
    hash("dist/index.js"),
  );
  const installedRoot = join(dir, "node_modules", name);
  // What the pack holds, not what the build left in dist.
  checkPackedDist(
    output[0].files.map((file) => file.path),
    ".",
    installedRoot,
  );
  writeFileSync(
    join(dir, "probe.mjs"),
    readFileSync(new URL("./consumer-probe.mjs", import.meta.url)),
  );
  for (const format of ["esm", "cjs"]) {
    process.stdout.write(run("node", ["probe.mjs", format, name]));
    run("node", [
      resolve("scripts/consumer-lazy-probe.mjs"),
      join(installedRoot, "dist"),
      format,
    ]);
  }
  process.stdout.write(
    execFileSync(
      process.execPath,
      [
        resolve("scripts/native-smoke.mjs"),
        join(installedRoot, "dist/index.js"),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(installed.exports, manifest.exports);
  assert.equal(existsSync(join(dir, "node_modules/react")), false);
  // Development-only checks stay decidable by the consumer's bundler: the
  // published code keeps `process.env.NODE_ENV` for it to replace.
  for (const format of ["js", "cjs"])
    assert.match(
      readFileSync(
        join(dir, `node_modules/${name}/dist/skin-antd/index.${format}`),
        "utf8",
      ),
      /process\.env\.NODE_ENV/,
    );
  run("node", [
    "--input-type=module",
    "-e",
    `import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {SUPPORTED_PROTOCOLS} from '${name}';assert.deepEqual(SUPPORTED_PROTOCOLS,['1.1','1.0']);for(const entry of ['react','skin-default','skin-antd','testing','schema.json','styles.css'])assert.ok(import.meta.resolve('${name}/'+entry));`,
  ]);
  run("node", ["-e", `require('${name}');require('${name}/skin-default');`]);
  run(
    manager,
    manager === "npm"
      ? [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "react@19",
          "react-dom@19",
          "antd@5",
          "@testing-library/react@16",
        ]
      : [
          "add",
          "--ignore-scripts",
          "react@19",
          "react-dom@19",
          "antd@5",
          "@testing-library/react@16",
        ],
  );
  run("node", [
    "--input-type=module",
    "-e",
    `for(const entry of ['react','skin-default','skin-antd','testing'])await import('${name}/'+entry);`,
  ]);
  run("node", [
    "-e",
    `for(const entry of ['react','skin-default','skin-antd','testing'])require('${name}/'+entry);`,
  ]);
  process.stdout.write(
    manager + ": prebuilt exports install and load without lifecycle scripts\n",
  );
}
