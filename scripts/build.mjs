import { build } from "tsup";
import { copyFile, mkdir, access } from "node:fs/promises";
const entry = {
  index: "src/index.ts",
  "flow-parser": "src/core/flow-parser.ts",
  "form-session": "src/core/form-session.ts",
  conformance: "src/conformance/run.ts",
  intent: "src/core/intent.ts",
  "on-demand": "src/core/on-demand.ts",
  "stream-reads": "src/core/reads-impl.ts",
  "storage-commit": "src/core/storage-commit.ts",
  "frame-decoder": "src/core/frame-decoder.ts",
};
for (const part of ["react", "skin-default", "skin-antd", "testing"]) {
  try {
    await access(`src/${part}/index.ts`);
    entry[`${part}/index`] = `src/${part}/index.ts`;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await build({
  entry,
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  platform: "browser",
  clean: true,
  // What each output holds and imports, for the size budgets; not packed.
  metafile: true,
  minify: true,
  // Development-only checks are the consumer's bundler's to decide. esbuild
  // fixes `process.env.NODE_ENV` at "production" for a minified browser
  // build; defining it as itself keeps it as written.
  esbuildOptions(options) {
    options.define = {
      ...options.define,
      "process.env.NODE_ENV": "process.env.NODE_ENV",
    };
  },
  external: ["react", "react-dom", "antd", "@testing-library/react", "vitest"],
  outDir: "dist",
  target: "es2022",
});
await build({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  target: "es2022",
  minify: true,
});
await copyFile("src/protocol/schema.json", "dist/schema.json");
try {
  await copyFile("src/react/styles.css", "dist/styles.css");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir("etc", { recursive: true });
