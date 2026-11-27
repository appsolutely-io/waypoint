import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";
import type { RecoveryView } from "../../src/protocol/generated";
import {
  negotiate,
  SUPPORTED_PROTOCOLS,
  blockFallback,
} from "../../src/protocol/index";
describe("schema fixtures", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  for (const [name, value] of Object.entries(samples))
    it(name, () => {
      const validate = ajv.getSchema(
        `https://waypoint.example/schema#/$defs/${name}`,
      )!;
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(null)).toBe(false);
    });
  it("all definitions have a valid fixture", () =>
    expect(Object.keys(samples).sort()).toEqual(
      Object.keys(schema.$defs).sort(),
    ));
  it("separates draft, final and timed authority", () => {
    const valid = ajv.getSchema("https://waypoint.example/schema#/$defs/Plan")!;
    expect(valid({ ...samples.ImmediateDraft, digest: "unexpected" })).toBe(
      false,
    );
    expect(valid({ ...samples.TimedPlan, requests: [] })).toBe(false);
  });
});
it("negotiates known capabilities and rejects incompatible versions", () => {
  expect(SUPPORTED_PROTOCOLS).toEqual(["1.2", "1.1", "1.0"]);
  expect(negotiate(["9.0", "1.0"], ["plans", "future"])).toEqual({
    protocol: "1.0",
    capabilities: ["plans"],
  });
  expect(() => negotiate(["2.0"])).toThrow("update-required");
  expect(
    blockFallback({ type: "future/card", id: "x", fallback: "Readable" }),
  ).toEqual({ text: "Readable", disabled: true, update: true });
});
describe("a card's applied answer", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  const block = ajv.getSchema("https://waypoint.example/schema#/$defs/Block")!;
  const card = { ...samples.BlockButtons, answered: true };
  it("is optional, so a host that leaves it out stays valid", () =>
    expect(block(card), JSON.stringify(block.errors)).toBe(true));
  it("is the applied action or form reply without its protocol", () => {
    expect(block({ ...card, answer: samples.CardAnswer })).toBe(true);
    // A form's values may be left out, as for a sensitive form.
    const form = { kind: "form", clientReplyId: "r", blockId: "f" };
    expect(block({ ...card, answer: form })).toBe(true);
    expect(block({ ...card, answer: { ...form, values: { a: 1 } } })).toBe(
      true,
    );
  });
  it("refuses an answer that is not an action or a form reply", () => {
    for (const answer of [
      { kind: "action", clientReplyId: "r", blockId: "q" },
      { ...samples.CardAnswer, kind: "message" },
      { ...samples.CardAnswer, blockId: "" },
    ])
      expect(block({ ...card, answer })).toBe(false);
  });
});
describe("a message's attachments", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  const message = ajv.getSchema(
    "https://waypoint.example/schema#/$defs/Message",
  )!;
  const reply = ajv.getSchema(
    "https://waypoint.example/schema#/$defs/ReplyMessage",
  )!;
  it("carries the files a host stored, with an optional link", () => {
    expect(
      message({
        ...samples.Message,
        attachments: [samples.MessageAttachment],
      }),
      JSON.stringify(message.errors),
    ).toBe(true);
    expect(
      reply({
        ...samples.ReplyMessage,
        attachments: [samples.MessageAttachment],
      }),
      JSON.stringify(reply.errors),
    ).toBe(true);
  });
  it("refuses a malformed attachment", () => {
    for (const broken of [
      { ...samples.MessageAttachment, id: "" },
      { ...samples.MessageAttachment, name: "" },
      { ...samples.MessageAttachment, mediaType: "" },
      { ...samples.MessageAttachment, size: -1 },
    ])
      expect(
        message({ ...samples.Message, attachments: [broken] }),
        JSON.stringify(message.errors),
      ).toBe(false);
  });
  it("keeps a message without attachments valid", () =>
    expect(message(samples.Message), JSON.stringify(message.errors)).toBe(
      true,
    ));
});
describe("recovery views from a newer host", () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  const view = ajv.getSchema(
    "https://waypoint.example/schema#/$defs/RecoveryView",
  )!;
  it("validates a profile and a phase this client does not know", () => {
    // Typed as the generated type: both fields accept other values.
    const newer: RecoveryView = {
      ...(samples.RecoveryView as RecoveryView),
      profile: "plan-recovery-v2",
      phase: "manual-review-next",
    };
    expect(view(newer), JSON.stringify(view.errors)).toBe(true);
  });
  it("keeps the shared phase definition closed for intent replies", () => {
    const phase = ajv.getSchema(
      "https://waypoint.example/schema#/$defs/RecoveryPhase",
    )!;
    expect(phase("manual-review-next")).toBe(false);
    expect(phase("readback")).toBe(true);
  });
});

it("binds the attachment limits to the schema", async () => {
  const schema = (await import("../../src/protocol/schema.json")).default;
  const { MAX_ATTACHMENTS, MAX_NAME_LENGTH, MAX_MEDIA_TYPE_LENGTH } =
    await import("../../src/core/attachment-shape");
  expect(schema.$defs.Message.properties.attachments.maxItems).toBe(
    MAX_ATTACHMENTS,
  );
  expect(schema.$defs.ReplyMessage.properties.attachments.maxItems).toBe(
    MAX_ATTACHMENTS,
  );
  expect(schema.$defs.MessageAttachment.properties.name.maxLength).toBe(
    MAX_NAME_LENGTH,
  );
  expect(schema.$defs.MessageAttachment.properties.mediaType.maxLength).toBe(
    MAX_MEDIA_TYPE_LENGTH,
  );
});
