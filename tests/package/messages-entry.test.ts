import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import pkg from "../../package.json";

const smoke = (entry: string, ...flags: string[]) =>
  spawnSync(process.execPath, ["scripts/native-smoke.mjs", entry, ...flags], {
    encoding: "utf8",
  });

it("the formatter and each locale are their own public entries", () => {
  for (const entry of ["messages", "messages/en", "messages/zh-Hans"])
    expect(pkg.exports).toHaveProperty(`./${entry}`, {
      types: `./dist/${entry}/index.d.ts`,
      import: `./dist/${entry}/index.js`,
      require: `./dist/${entry}/index.cjs`,
    });
});

it("/hooks carries no strings and no message formatter", () => {
  const hooks = smoke("src/hooks/index.ts", "--allow-react");
  expect(hooks.status).toBe(0);
  expect(hooks.stdout).not.toMatch(/intl-messageformat|-messages\.ts|i18n\.ts/);
});

it("/messages and each locale need neither React nor a DOM", () => {
  for (const entry of [
    "src/messages/index.ts",
    "src/messages/en.ts",
    "src/messages/zh-Hans.ts",
  ]) {
    const result = smoke(entry);
    expect([entry, result.stderr]).toEqual([entry, ""]);
    expect(result.status).toBe(0);
  }
});
