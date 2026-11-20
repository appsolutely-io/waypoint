import { expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";
const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const valid = (name: string, value: unknown) =>
  ajv.getSchema(`https://waypoint.example/schema#/$defs/${name}`)!(value);
const sender = { id: "reviewer", name: "Reviewer", avatarUrl: "/reviewer.png" };
it("sender fields validate in messages and message-start frames", () => {
  expect(schema.$defs).toHaveProperty("MessageSender");
  for (const role of ["user", "assistant", "notice"]) {
    expect(valid("Message", { ...samples.Message, role, sender })).toBe(true);
    expect(
      valid("FrameMessageStart", {
        ...samples.FrameMessageStart,
        role,
        sender,
      }),
    ).toBe(true);
  }
});
it("malformed sender names are rejected by the protocol schema", () => {
  for (const name of [5, "", "x".repeat(81), null])
    for (const definition of ["Message", "FrameMessageStart"] as const)
      expect(
        valid(definition, {
          ...samples[definition],
          sender: { ...sender, name },
        }),
      ).toBe(false);
  expect(
    valid("Message", { ...samples.Message, sender: { ...sender, id: "" } }),
  ).toBe(false);
});
it("legacy protocol samples remain valid without sender fields", () => {
  expect(valid("Message", samples.Message)).toBe(true);
  expect(valid("FrameMessageStart", samples.FrameMessageStart)).toBe(true);
});
