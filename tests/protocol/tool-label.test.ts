import { it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const call = ajv.getSchema("https://waypoint.example/schema#/$defs/ToolCall")!;

it("a tool call may name itself in plain words, within 200 characters", () => {
  expect(call(samples.ToolCall)).toBe(true);
  expect(call({ ...samples.ToolCall, label: "Reading 3 orders…" })).toBe(true);
  expect(call({ ...samples.ToolCall, label: "" })).toBe(false);
  expect(call({ ...samples.ToolCall, label: "x".repeat(201) })).toBe(false);
});
