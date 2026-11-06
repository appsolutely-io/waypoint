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
