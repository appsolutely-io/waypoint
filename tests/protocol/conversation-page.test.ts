import { expect, it } from "vitest";
import Ajv from "ajv/dist/2020";
import schema from "../../src/protocol/schema.json";
import samples from "./samples.json";
const ajv = new Ajv({ strict: false });
ajv.addSchema(schema);
const value = {
  conversation: samples.Conversation,
  snapshotId: "snapshot",
  olderCursor: null,
  outline: [],
  heldClientMessageIds: [],
};
const valid = (name: string, input: unknown): boolean =>
  ajv.getSchema(`https://waypoint.example/schema#/$defs/${name}`)!(
    input,
  ) as boolean;
it("conversation pages declare complete outline and receipt fields or a typed stale result", () => {
  expect(valid("ConversationPage", value)).toBe(true);
  expect(valid("ConversationPage", { stale: true })).toBe(true);
  for (const key of [
    "conversation",
    "snapshotId",
    "olderCursor",
    "outline",
    "heldClientMessageIds",
  ])
    expect(
      valid(
        "ConversationPage",
        Object.fromEntries(
          Object.entries(value).filter(([name]) => name !== key),
        ),
      ),
    ).toBe(false);
  expect(valid("ConversationPage", { ...value, snapshotId: "" })).toBe(false);
  expect(valid("ConversationPage", { ...value, olderCursor: "" })).toBe(false);
});
it("outline entries require an opaque body revision and plain text", () => {
  const entry = {
    id: "message",
    role: "notice",
    revision: "revision",
    text: "History",
  };
  expect(valid("OutlineMessage", entry)).toBe(true);
  expect(valid("OutlineMessage", { ...entry, revision: "" })).toBe(false);
  expect(valid("OutlineMessage", { ...entry, text: undefined })).toBe(false);
});
