import { build } from "esbuild";
import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const forbidden = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);
// With --allow-react the entry may use React itself (the renderer-neutral
// hooks), but still nothing that needs a DOM: no React DOM, no skin, no CSS.
const args = process.argv.slice(2);
const allowReact = args.includes("--allow-react");
// --forbid=<package>: a package this entry must not hold either.
const extra = args
  .filter((arg) => arg.startsWith("--forbid="))
  .map((arg) => arg.slice("--forbid=".length));
const entry = args.find((arg) => !arg.startsWith("--")) ?? "dist/index.js";
const runtime = allowReact
  ? /^(react-dom|antd|@testing-library\/react)(\/|$)/
  : /^(react|react-dom|antd|@testing-library\/react)(\/|$)/;
const result = await build({
  entryPoints: [entry],
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["react-native", "import", "default"],
  bundle: true,
  metafile: true,
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "native-runtime-boundary",
      setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path }) => {
          if (
            path.startsWith("node:") ||
            forbidden.has(path) ||
            runtime.test(path) ||
            extra.some(
              (name) => path === name || path.startsWith(`${name}/`),
            ) ||
            path.endsWith(".css")
          ) {
            return {
              errors: [{ text: `Forbidden native runtime import: ${path}` }],
            };
          }
        });
        // React itself stays the host's: it is not bundled here.
        if (allowReact)
          build.onResolve({ filter: /^react(\/|$)/ }, ({ path }) => ({
            path,
            external: true,
          }));
      },
    },
  ],
});
// A built entry holds a forbidden package inline, not as an import: the
// build's metafile says which sources each output it reaches was made of.
if (extra.length) {
  const absolute = resolve(entry);
  const root = absolute.slice(0, absolute.lastIndexOf("/dist/"));
  const metafile = join(root, "dist/metafile-esm.json");
  // Only a build in place has its metafile; a packed one leaves it out.
  if (absolute.includes("/dist/") && existsSync(metafile)) {
    const outputs = JSON.parse(readFileSync(metafile, "utf8")).outputs;
    for (const input of Object.keys(result.metafile.inputs)) {
      const at = input.lastIndexOf("dist/");
      const output = at < 0 ? undefined : outputs[input.slice(at)];
      const held = Object.keys(output?.inputs ?? {}).filter((source) =>
        extra.some((name) => source.includes(`node_modules/${name}/`)),
      );
      if (held.length) {
        process.stderr.write(`Forbidden package in ${input}: ${held[0]}\n`);
        process.exit(1);
      }
    }
  }
}
process.stdout.write(
  `native graph: ${Object.keys(result.metafile.inputs).length} modules resolved (device-free; no native UI)\n` +
    // The hooks' graph is small: listed, so a reader sees what it holds.
    (allowReact
      ? Object.keys(result.metafile.inputs)
          .map((input) => `  ${input}\n`)
          .join("")
      : ""),
);
