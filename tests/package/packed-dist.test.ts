import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkPackedDist } from "../../scripts/packed-dist.mjs";

// A built package and an installed copy of what was packed from it.
let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));
function fixture() {
  mkdirSync(".api-temp", { recursive: true });
  root = mkdtempSync(".api-temp/packed-dist-");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const side of ["source", "installed"]) {
    write(`${side}/dist/index.js`, "export {};");
    write(`${side}/dist/react/index.js`, "export {};");
  }
  // Built, but not packed.
  write("source/dist/metafile-esm.json", "{}");
  const packed = ["package.json", "dist/index.js", "dist/react/index.js"];
  const check = (paths = packed) =>
    checkPackedDist(paths, join(root, "source"), join(root, "installed"));
  return { write, check, packed };
}

it("accepts an install of exactly what was packed, whatever else was built", () => {
  const { check } = fixture();
  expect(() => check()).not.toThrow();
});

it("refuses a packed file whose installed bytes differ", () => {
  const { write, check } = fixture();
  write("installed/dist/react/index.js", "export const changed = 1;");
  expect(() => check()).toThrow("dist/react/index.js differs from the build");
});

it("refuses an installed dist file that was not packed", () => {
  const { write, check } = fixture();
  write("installed/dist/extra.js", "export {};");
  expect(() => check()).toThrow("the installed dist differs from the pack");
});

it("refuses a packed metafile", () => {
  const { write, check, packed } = fixture();
  write("installed/dist/metafile-esm.json", "{}");
  expect(() => check([...packed, "dist/metafile-esm.json"])).toThrow(
    "a build metafile is packed",
  );
});
