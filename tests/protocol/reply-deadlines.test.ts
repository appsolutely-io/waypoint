import { expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
const ajv = new Ajv2020({ strict: false, logger: false });
ajv.addSchema(schema);
const validate = (name: string, value: unknown) =>
  ajv.getSchema(`https://waypoint.example/schema#/$defs/${name}`)!(value);
const conversation = {
  protocol: "1.0",
  id: "conversation",
  title: "Chat",
  messages: [],
};
const start = {
  type: "message.start",
  protocol: "1.0",
  sequence: 1,
  messageId: "a",
  role: "assistant",
};
const stale = {
  type: "stale",
  protocol: "1.0",
  sequence: 1,
  reads: ["conversation"],
};
it.each([
  ["FrameMessageStart", start],
  ["FrameStale", stale],
] as const)(
  "start and stale schemas accept the new deadline owner and version fields (%s)",
  (name, value) => {
    expect(
      validate(name, {
        ...value,
        replyOverdueAt: 123,
        replyOverdueFor: "a",
        versionIndex: 2,
      }),
    ).toBe(true);
    expect(
      validate(name, {
        ...value,
        replyOverdueAt: null,
        replyOverdueFor: "a",
        versionIndex: 2,
      }),
    ).toBe(true);
    for (const patch of [
      { versionIndex: 0 },
      { versionIndex: 1.5 },
      { versionIndex: "2" },
      { replyOverdueFor: "" },
      { replyOverdueFor: 4 },
      { replyOverdueAt: "123" },
    ])
      expect(validate(name, { ...value, ...patch })).toBe(false);
  },
);
it("deadline owner fields validate on conversations start and stale frames", () => {
  expect(
    validate("Conversation", {
      ...conversation,
      replyExpectedId: "episode",
      replyLabel: "Discussing",
      replyOverdueFor: "episode",
      replyOverdueAt: 123,
    }),
  ).toBe(true);
  for (const patch of [
    { replyExpectedId: "" },
    { replyLabel: 4 },
    { replyLabel: "x".repeat(201) },
    { replyOverdueVersion: 0 },
    { replyOverdueVersion: 1.5 },
    { replyOverdueFor: "" },
  ])
    expect(validate("Conversation", { ...conversation, ...patch })).toBe(false);
});
it("reply end frames do not define a deadline field", () => {
  const properties = schema.$defs.FrameMessageEnd.properties;
  expect(properties).not.toHaveProperty("replyOverdueAt");
  expect(properties).not.toHaveProperty("replyOverdueFor");
});
it("legacy frames without deadline owners still validate", () => {
  expect(validate("FrameMessageStart", start)).toBe(true);
  expect(validate("FrameStale", stale)).toBe(true);
  expect(validate("Conversation", conversation)).toBe(true);
});
it("busy failure and recovery payloads are conversation-read-only schema fields", () => {
  for (const properties of [
    schema.$defs.FrameMessageStart.properties,
    schema.$defs.FrameStale.properties,
  ])
    for (const name of [
      "replyStatus",
      "replyFailure",
      "replyLabel",
      "replyExpectedId",
      "recovery",
    ])
      expect(properties).not.toHaveProperty(name);
});
