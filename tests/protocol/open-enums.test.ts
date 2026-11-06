import { describe, expect, it } from "vitest";
import { compile } from "json-schema-to-typescript";
import Ajv2020 from "ajv/dist/2020.js";
import { openEnums } from "../../scripts/open-enums.mjs";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";

// The generator's handling of `x-open-enum`, on fixture schemas: what each
// form of the annotation turns into.
const generate = async (definitions: Record<string, unknown>) => {
  const fixture = structuredClone({
    $defs: definitions,
    oneOf: Object.keys(definitions).map((name) => ({
      $ref: `#/$defs/${name}`,
    })),
  });
  openEnums(fixture);
  return compile(fixture as never, "Fixture", {
    bannerComment: "",
    additionalProperties: false,
    style: { singleQuote: true },
    unreachableDefinitions: true,
  });
};
const OPEN = "(string & {})";

describe("x-open-enum in the generator", () => {
  it("a list of known values keeps them and accepts any other string", async () => {
    const types = await generate({
      View: {
        type: "object",
        properties: {
          profile: { type: "string", "x-open-enum": ["first", "second"] },
        },
        required: ["profile"],
        additionalProperties: false,
      },
    });
    expect(types).toContain(`profile: 'first' | 'second' | ${OPEN};`);
  });
  it("the name of an enum definition keeps that type and accepts any other string", async () => {
    const types = await generate({
      Phase: { enum: ["one", "two"] },
      View: {
        type: "object",
        properties: {
          phase: { type: "string", "x-open-enum": "Phase" },
        },
        required: ["phase"],
        additionalProperties: false,
      },
    });
    expect(types).toContain(`phase: Phase | ${OPEN};`);
    // The definition itself stays closed for whoever references it.
    expect(types).toMatch(/export type Phase = ['"]one['"] \| ['"]two['"];/);
  });
  it("an annotated array item is open, and an unannotated reference stays closed", async () => {
    const types = await generate({
      Phase: { enum: ["one", "two"] },
      View: {
        type: "object",
        properties: {
          seen: {
            type: "array",
            items: { type: "string", "x-open-enum": "Phase" },
          },
          phase: { $ref: "#/$defs/Phase" },
        },
        required: ["seen", "phase"],
        additionalProperties: false,
      },
    });
    expect(types).toContain(`seen: (Phase | ${OPEN})[];`);
    expect(types).toContain("phase: Phase;");
  });
  it("an annotated member of an intersection keeps its union grouped", async () => {
    const types = await generate({
      View: {
        type: "object",
        properties: {
          both: {
            allOf: [
              { type: "string", minLength: 1 },
              { type: "string", "x-open-enum": ["a", "b"] },
            ],
          },
        },
        required: ["both"],
        additionalProperties: false,
      },
    });
    expect(types).toContain(`both: string & ('a' | 'b' | ${OPEN});`);
  });
  it("a nullable annotated string stays nullable", async () => {
    const types = await generate({
      View: {
        type: "object",
        properties: {
          profile: { type: ["string", "null"], "x-open-enum": ["first"] },
        },
        required: ["profile"],
        additionalProperties: false,
      },
    });
    expect(types).toContain(`profile: 'first' | ${OPEN} | null;`);
  });
  it("leaves a schema without the annotation unchanged", () => {
    const plain = {
      $defs: { Phase: { enum: ["one"] }, Name: { type: "string" } },
    };
    const copy = structuredClone(plain);
    openEnums(copy);
    expect(copy).toEqual(plain);
  });
});

describe("unknown recovery phases in the shipped schema", () => {
  // Ajv's default options refuse unknown keywords and formats; the README
  // has hosts register both, the annotation as a keyword.
  for (const strict of [false, "default"] as const)
    describe(strict ? "Ajv's default options" : "non-strict", () => {
      // No logger: Ajv logs its type-strictness notes, which change nothing.
      const ajv = new Ajv2020(strict ? { logger: false } : { strict });
      if (strict) {
        ajv.addKeyword("x-open-enum");
        ajv.addFormat("date-time", (value: string) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(
            value,
          ),
        );
      }
      ajv.addSchema(schema);
      const at = (name: string) =>
        ajv.getSchema(`https://waypoint.example/schema#/$defs/${name}`)!;
      it("a recovery view from a newer host may name a phase this client does not know", () => {
        const view = at("RecoveryView");
        const newer = { ...samples.RecoveryView, phase: "manual-review-next" };
        expect(view(newer), JSON.stringify(view.errors)).toBe(true);
      });
      it("an intent reply naming an unknown phase is refused", () => {
        const reply = at("PlanIntentReply");
        expect(
          reply(samples.PlanIntentReply),
          JSON.stringify(reply.errors),
        ).toBe(true);
        expect(
          reply({ ...samples.PlanIntentReply, phase: "manual-review-next" }),
        ).toBe(false);
      });
      it("a saved disposition naming another phase is refused", () => {
        const reply = at("PlanIntentReply");
        expect(
          reply({
            ...samples.PlanIntentReply,
            savedDisposition: { phase: "readback", count: 1 },
          }),
        ).toBe(false);
      });
    });
});
