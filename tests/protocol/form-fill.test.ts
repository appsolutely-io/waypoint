import { it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
it("requires validation per value and never accepts malformed known form blocks as extensions", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  const valid = ajv.getSchema("https://waypoint.example/schema#/$defs/Block")!;
  const block = {
    type: "form.fill",
    id: "fill",
    fallback: "Draft",
    body: {
      requestId: "r",
      values: {
        title: {
          value: "Title",
          validation: {
            status: "invalid",
            messages: ["Invalid"],
            guidance: "Keep complete",
          },
        },
      },
    },
  };
  expect(valid(block)).toBe(true);
  expect(
    valid({
      ...block,
      body: { requestId: "r", values: { title: { value: "Title" } } },
    }),
  ).toBe(false);
  expect(valid({ ...block, body: { requestId: "r", values: {} } })).toBe(false);
});
it("accepts a display label on a generated field value", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  const valid = ajv.getSchema(
    "https://waypoint.example/schema#/$defs/FormFillValue",
  )!;
  expect(
    valid({
      label: "Display title",
      value: "Draft",
      validation: { status: "valid", messages: [] },
    }),
  ).toBe(true);
});
