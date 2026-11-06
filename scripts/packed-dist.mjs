import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const files = (dir) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => statSync(join(dir, file)).isFile())
    .map((file) => file.split("\\").join("/"));

/**
 * Checks an installed package's dist against what `npm pack` packed (its
 * file paths, relative to the package root): no build metafile is packed,
 * every packed dist file is installed byte for byte as built, and the
 * installed dist holds nothing else.
 */
export function checkPackedDist(packedPaths, sourceRoot, installedRoot) {
  const packed = packedPaths.filter((path) => path.startsWith("dist/")).sort();
  assert.ok(packed.length > 0, "the pack has no dist files");
  assert.deepEqual(
    packed.filter((path) => /(^|\/)metafile-[^/]*\.json$/.test(path)),
    [],
    "a build metafile is packed",
  );
  for (const path of packed)
    assert.equal(
      hash(join(installedRoot, path)),
      hash(join(sourceRoot, path)),
      `${path} differs from the build`,
    );
  assert.deepEqual(
    files(join(installedRoot, "dist"))
      .map((file) => `dist/${file}`)
      .sort(),
    packed,
    "the installed dist differs from the pack",
  );
}
