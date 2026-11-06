import { build } from "esbuild";
import { builtinModules } from "node:module";

const forbidden = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);
// With --allow-react the entry may use React itself (the renderer-neutral
// hooks), but still nothing that needs a DOM: no React DOM, no skin, no CSS.
const args = process.argv.slice(2);
const allowReact = args.includes("--allow-react");
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
process.stdout.write(
  `native graph: ${Object.keys(result.metafile.inputs).length} modules resolved (device-free; no native UI)\n` +
    // The hooks' graph is small: listed, so a reader sees what it holds.
    (allowReact
      ? Object.keys(result.metafile.inputs)
          .map((input) => `  ${input}\n`)
          .join("")
      : ""),
);
