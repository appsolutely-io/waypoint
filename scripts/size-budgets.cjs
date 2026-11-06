// Size budgets for the chunks the build splits out and names by hash. The
// build's ESM metafile says which source modules each output holds and what
// it imports, so a shared chunk is found by a module it holds, and every
// ESM browser output can be checked to fall under some budget. The CommonJS
// outputs mirror them and the command-line build is not shipped to
// browsers; neither is checked.
const { existsSync, readFileSync } = require("node:fs");
const { dirname, join, posix, relative } = require("node:path");

const pattern = (glob) =>
  new RegExp(
    `^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
// The outputs a budget measures: its files and everything they import
// statically, except what it ignores (matched as the import is written).
function measured(outputs, budget) {
  const ignored = (budget.ignore ?? []).map(pattern);
  const paths = Array.isArray(budget.path) ? budget.path : [budget.path];
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !outputs[file]) return;
    seen.add(file);
    for (const imported of outputs[file].imports) {
      if (imported.external || imported.kind !== "import-statement") continue;
      let written = posix.relative(dirname(file), imported.path);
      if (!written.startsWith(".")) written = `./${written}`;
      if (!ignored.some((test) => test.test(written))) visit(imported.path);
    }
  };
  for (const path of paths) {
    const test = pattern(path);
    for (const file of Object.keys(outputs)) if (test.test(file)) visit(file);
  }
  return seen;
}

/**
 * Adds a budget for each shared chunk, found by the source module it holds,
 * and refuses a build with an ESM browser output no budget measures. Paths,
 * the metafile's included, are relative to `root`, where the config is.
 */
function withSharedChunks(budgets, { root = ".", dist, shared }) {
  const file = join(root, dist, "metafile-esm.json");
  if (!existsSync(file)) {
    // Before any build there is nothing to measure; a build without the
    // metafile would leave the shared chunks unmeasured.
    if (existsSync(join(root, dist, "index.js")))
      throw new Error(`${file} is missing: run the build again`);
    return budgets;
  }
  const outputs = JSON.parse(readFileSync(file, "utf8")).outputs;
  const all = [
    ...budgets,
    ...shared.map(({ source, ...budget }) => {
      const holders = Object.keys(outputs).filter(
        (output) =>
          output.endsWith(".js") &&
          Object.hasOwn(outputs[output].inputs, source),
      );
      if (holders.length !== 1)
        throw new Error(
          `${budget.name}: ${source} is in ${holders.length} outputs, not one`,
        );
      return { ...budget, path: holders[0] };
    }),
  ];
  const covered = new Set(
    all.flatMap((budget) => [...measured(outputs, budget)]),
  );
  const missing = Object.keys(outputs).filter(
    (output) => output.endsWith(".js") && !covered.has(output),
  );
  if (missing.length)
    throw new Error(
      `No size budget measures ${missing
        .map((output) => relative(dist, output))
        .join(", ")}`,
    );
  return all;
}

module.exports = { withSharedChunks };
