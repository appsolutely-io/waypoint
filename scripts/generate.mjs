import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import { openEnums } from "./open-enums.mjs";
const schema = JSON.parse(await readFile("src/protocol/schema.json", "utf8"));
openEnums(schema);
const all = {
  ...schema,
  oneOf: Object.keys(schema.$defs).map((name) => ({ $ref: `#/$defs/${name}` })),
};
const types = await compile(all, "Protocol", {
  bannerComment: "/* Generated from schema.json. */",
  additionalProperties: false,
  style: { singleQuote: true },
  unreachableDefinitions: true,
});
const file = "src/protocol/generated.ts";
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== types)
    throw new Error("Generated protocol differs");
} else await writeFile(file, types);

// Each language's catalogue for hosts that draw their own UI: the text of
// every key the plan view, cards, problems and reply row return, and the
// message actions, as one frozen object per language, generated from the
// catalogues the web chat loads, so a host imports only its own language. Form-fill text is not included: the
// renderer-neutral hooks return no form keys.
const { tsImport } = await import("tsx/esm/api");
const { format } = await import("prettier");
const load = (path) => tsImport(path, import.meta.url);
const [core, recovery, confirmation, block, problem, reply] = await Promise.all(
  [
    load("../src/react/i18n.ts"),
    load("../src/react/recovery-messages.ts"),
    load("../src/react/confirmation-messages.ts"),
    load("../src/react/block-messages.ts"),
    load("../src/react/problem-messages.ts"),
    load("../src/react/reply-messages.ts"),
  ],
);
const locales = {
  en: [
    core.english,
    recovery.recoveryEnglish,
    confirmation.confirmationEnglish,
    block.blockEnglish,
    problem.problemEnglish,
    reply.replyEnglish,
  ],
  "zh-Hans": [
    core.simplifiedChinese,
    recovery.recoverySimplifiedChinese,
    confirmation.confirmationSimplifiedChinese,
    block.blockSimplifiedChinese,
    problem.problemSimplifiedChinese,
    reply.replySimplifiedChinese,
  ],
};
for (const [locale, catalogues] of Object.entries(locales)) {
  const messages = Object.assign({}, ...catalogues);
  const source = await format(
    `/* Generated from the message catalogues by scripts/generate.mjs. */
// No imports: a host's bundle takes only this language's text.
const messages: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(messages)});
export default messages;
`,
    { parser: "typescript" },
  );
  const path = `src/messages/${locale}.ts`;
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8").catch(() => "")) !== source)
      throw new Error(`Generated ${path} differs`);
  } else await writeFile(path, source);
}
