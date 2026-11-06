import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const format = process.argv[3];
const require = createRequire(import.meta.url);
const entries = readdirSync(root)
  .filter((file) => file.endsWith(".d.ts") && file !== "index.d.ts")
  .map((file) => file.slice(0, -".d.ts".length))
  .filter((entry) =>
    ["js", "cjs"].some((extension) =>
      existsSync(join(root, `${entry}.${extension}`)),
    ),
  );
for (const entry of entries) {
  const path = join(root, `${entry}.${format === "esm" ? "js" : "cjs"}`);
  if (format === "esm") await import(pathToFileURL(path).href);
  else require(path);
}
