import { it, expect } from "vitest";
import { handleToolRead, handlePlanningRead } from "../../src/core/reads";
import samples from "../protocol/samples.json";
import type {
  ManifestEntry,
  ToolCall,
  ReadTemplate,
} from "../../src/protocol/generated";
const entry = samples.ManifestEntry as ManifestEntry;
const call = samples.ToolCall as ToolCall;
it("refuses disguised writes, foreign routes and sensitive query filters; projects only declared low fields", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { title: "Safe", email: "Hidden", untiered: "Hidden" };
  };
  for (const bad of [
    { ...call, method: "POST" },
    { ...call, path: "/items/../admin" },
    { ...call, query: { email: "a" } },
    { ...call, path: "/items/a?email=a" },
  ])
    expect((await handleToolRead(bad, [entry], request)).kind).toBe("refused");
  expect(calls).toBe(0);
  expect(await handleToolRead(call, [entry], request)).toEqual({
    kind: "result",
    callId: "call-a",
    result: { title: "Safe" },
  });
});
it("planning values match exact targets and never become model results", async () => {
  const template = samples.ReadTemplate as ReadTemplate;
  const result = await handlePlanningRead(template, template, async () => ({
    rows: { a: { title: "Sensitive", extra: "Hidden" } },
    versions: { a: "v1" },
  }));
  expect(result).toEqual({
    kind: "plan.values",
    rows: { a: { title: "Sensitive" } },
    versions: { a: "v1" },
  });
  expect(
    (
      await handlePlanningRead(
        { ...template, rows: ["b"] },
        template,
        async () => {
          throw new Error("must not run");
        },
      )
    ).kind,
  ).toBe("refused");
});
it("planning requests receive the trusted template object without stream metadata", async () => {
  const template = structuredClone(samples.ReadTemplate) as ReadTemplate;
  const call = { ...template, streamOnly: "untrusted" };
  const result = await handlePlanningRead(call, template, async (input) => {
    expect(input).toBe(template);
    expect(input).not.toHaveProperty("streamOnly");
    return { rows: { a: { title: "Value" } }, versions: { a: "v1" } };
  });
  expect(result.kind).toBe("plan.values");
});
