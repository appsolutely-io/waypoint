import { it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const outcome = ajv.getSchema(
  "https://waypoint.example/schema#/$defs/Outcome",
)!;

it("a step's outcome may say why it failed and whether it can be retried", () => {
  expect(outcome(samples.Outcome)).toBe(true);
  const failed = {
    ...samples.Outcome,
    status: 412,
    reason: "The item changed since the plan was made.",
    retryable: false,
  };
  expect(outcome(failed), JSON.stringify(outcome.errors)).toBe(true);
  expect(outcome({ ...failed, reason: "" })).toBe(false);
  expect(outcome({ ...failed, reason: "x".repeat(501) })).toBe(false);
  expect(outcome({ ...failed, retryable: "no" })).toBe(false);
});
