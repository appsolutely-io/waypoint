import { it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const block = ajv.getSchema("https://waypoint.example/schema#/$defs/Block")!;
const details = ajv.getSchema(
  "https://waypoint.example/schema#/$defs/BlockDetails",
)!;

it("supporting detail is a block of its own, named by a summary", () => {
  expect(details, "BlockDetails is defined").toBeTruthy();
  expect(block(samples.BlockDetails), JSON.stringify(block.errors)).toBe(true);
  const nested = {
    ...samples.BlockDetails,
    body: { summary: "How this was worked out", blocks: [samples.BlockList] },
  };
  expect(block(nested)).toBe(true);
  expect(
    details({ ...samples.BlockDetails, body: { summary: "", blocks: [] } }),
  ).toBe(false);
  expect(details({ ...samples.BlockDetails, body: { blocks: [] } })).toBe(
    false,
  );
});
