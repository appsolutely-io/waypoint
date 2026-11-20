import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import ts from "typescript";

import { collect, options, undocumented } from "../../scripts/problem-ids.mjs";

const generated = resolve("src/protocol/generated.ts");

it("the problem id collector uses Problem types for spreads and excludes action ids", () => {
  const file = resolve("src/hooks/problem-id-fixture.ts");
  const helper = resolve("src/react/problem-id-helper.ts");
  const barrel = resolve("src/react/problem-id-barrel.ts");
  const text = `import type { Problem } from ${JSON.stringify(generated)};
    import { fixedId, importedProblem, importedIds, asProblem as normalize } from ${JSON.stringify(helper)};
    import * as helpers from ${JSON.stringify(helper)};
    import { reexportIds } from ${JSON.stringify(barrel)};
    const base: Problem = { code: "refused", id: "base-id" };
    const spread: Problem = { ...base, id: "spread-id" };
    const imported: Problem = { ...base, id: fixedId };
    report(importedProblem());
    normalize(null, "imported-normalizer-id");
    const constant = { code: "refused", id: "constant-id" } as const satisfies Problem;
    const action = { id: "action-id", label: "Action" };
    declare function report(problem: Problem): void;
    report({ code: "refused", id: "report-id" });
    declare const context: { report(problem: Problem): void };
    context.report({ code: "sign-in", id: "context-id" });
    const another = { id: "other-action-id" };
    declare function asProblem(error: unknown, id: string): Problem;
    asProblem(null, "normalizer-id");
    if (base.id === "selector-id") report(spread);
    ["member-id"].includes(base.id);
    const readonlyIds: readonly string[] = ["readonly-member-id"] as const;
    readonlyIds.includes(base.id);
    importedIds.includes(base.id);
    helpers.namespaceIds.includes(base.id);
    reexportIds.includes(base.id);
    (["asserted-member-id"] as readonly string[]).includes(base.id);
    ((["checked-member-id"] satisfies readonly string[])).includes(base.id);
  `;
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const fixtures = new Map([
    [file, text],
    [
      helper,
      `import type { Problem } from ${JSON.stringify(generated)};
      export const fixedId = "imported-id";
      export const importedIds: readonly string[] = ["imported-member-id"] as const;
      export const namespaceIds: readonly string[] = ["namespace-member-id"] as const;
      export const reexportIds: readonly string[] = ["reexport-member-id"] as const;
      export function importedProblem(): Problem {
        return { code: "refused", id: "helper-id" };
      }
      export function asProblem(error: unknown, id: string): Problem {
        return { code: "refused", id };
      }
    `,
    ],
  ]);
  fixtures.set(
    barrel,
    `export { reexportIds } from ${JSON.stringify(helper)};`,
  );
  host.readFile = (name) => fixtures.get(name) ?? read(name);
  host.fileExists = (name) => fixtures.has(name) || exists(name);
  const program = ts.createProgram(
    [file, helper, barrel, generated],
    options,
    host,
  );
  const ids = collect(program, [file, helper]);
  expect(ids).toEqual(
    new Set([
      "base-id",
      "spread-id",
      "imported-id",
      "helper-id",
      "imported-normalizer-id",
      "constant-id",
      "report-id",
      "context-id",
      "normalizer-id",
      "selector-id",
      "member-id",
      "readonly-member-id",
      "imported-member-id",
      "namespace-member-id",
      "reexport-member-id",
      "asserted-member-id",
      "checked-member-id",
    ]),
  );
  const sentence = [...ids].map((id) => `\`${id}\``).join(" ");
  for (const id of [
    "readonly-member-id",
    "imported-member-id",
    "namespace-member-id",
    "reexport-member-id",
    "asserted-member-id",
    "checked-member-id",
  ])
    expect(undocumented(ids, sentence.replace(`\`${id}\``, ""))).toContain(id);
});

it("lint invokes the fixed problem id inventory and propagates a scan failure", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "problem-id-lint-"));
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: { lint: string };
    };
    mkdirSync(resolve(directory, "node_modules/.bin"), { recursive: true });
    mkdirSync(resolve(directory, "scripts"));
    for (const name of ["eslint", "prettier"])
      writeFileSync(
        resolve(directory, "node_modules/.bin", name),
        "#!/bin/sh\nexit 0\n",
        { mode: 0o755 },
      );
    writeFileSync(resolve(directory, "scripts/privacy.mjs"), "");
    writeFileSync(
      resolve(directory, "scripts/problem-ids.mjs"),
      "process.exitCode = 37;\n",
    );
    writeFileSync(
      resolve(directory, "package.json"),
      JSON.stringify({ scripts: { lint: manifest.scripts.lint } }),
    );
    const result = spawnSync("npm", ["run", "lint"], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(37);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
