import { it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";
import { supportsReplySteps } from "../../src/protocol/version";

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const call = ajv.getSchema("https://waypoint.example/schema#/$defs/ToolCall")!;

it.each<[string | null, boolean]>([
  ["1.2", true],
  ["1.3", true],
  ["1.10", true],
  ["1.0", false],
  ["1.1", false],
  ["2.0", false],
  ["1.02", false],
  ["1.2.0", false],
  ["1.2\n", false],
  ["", false],
  [null, false],
])("recognizes compatible reply-step protocol %s", (protocol, expected) => {
  expect(supportsReplySteps(protocol)).toBe(expected);
});

it("validates host step statuses, Unicode labels and additive fields", () => {
  const valid = ajv.getSchema(
    "https://waypoint.example/schema#/$defs/ReplyStep",
  );
  expect(valid).toBeDefined();
  for (const status of ["running", "done", "failed"])
    expect(
      valid!({ id: "read", status, label: "😀".repeat(200), extra: true }),
    ).toBe(true);
  for (const value of [
    { id: "", status: "running" },
    { id: "read", status: "unknown" },
    { id: "read", status: "done", label: "" },
    { id: "read", status: "done", label: "😀".repeat(201) },
  ])
    expect(valid!(value)).toBe(false);
  const frame = ajv.getSchema(
    "https://waypoint.example/schema#/$defs/FrameStep",
  );
  expect(frame).toBeDefined();
  expect(
    frame!({
      type: "step",
      protocol: "1.2",
      sequence: 0,
      messageId: "a",
      step: { id: "s", status: "done" },
    }),
  ).toBe(true);
});

it("a tool call may name itself in plain words, within 200 characters", () => {
  expect(call(samples.ToolCall)).toBe(true);
  expect(call({ ...samples.ToolCall, label: "Reading 3 orders…" })).toBe(true);
  expect(call({ ...samples.ToolCall, label: "" })).toBe(false);
  expect(call({ ...samples.ToolCall, label: "x".repeat(201) })).toBe(false);
});
