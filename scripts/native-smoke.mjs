import { build } from "esbuild";
import { builtinModules } from "node:module";

const forbidden = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);
const result = await build({
  entryPoints: [process.argv[2] ?? "dist/index.js"],
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
            /^(react|react-dom|antd|@testing-library\/react)(\/|$)/.test(path)
          ) {
            return {
              errors: [{ text: `Forbidden native runtime import: ${path}` }],
            };
          }
        });
      },
    },
  ],
});
process.stdout.write(
  `native graph: ${Object.keys(result.metafile.inputs).length} modules resolved (device-free; no native UI)\n`,
);
