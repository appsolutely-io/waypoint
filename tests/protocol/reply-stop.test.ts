import { it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../src/protocol/schema.json";
import { negotiate } from "../../src/protocol/index";

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const valid = (name: string) =>
  ajv.getSchema(`https://waypoint.example/schema#/$defs/${name}`)!;

it("a stop is a reply naming the message being written", () => {
  const stop = {
    kind: "stop",
    protocol: "1.0",
    clientReplyId: "stop-a",
    messageId: "a",
  };
  expect(valid("Reply")(stop)).toBe(true);
  expect(valid("Reply")({ ...stop, messageId: undefined })).toBe(false);
});

it("a stopped reply is a message status and a way a reply ends", () => {
  const message = {
    id: "a",
    role: "assistant",
    content: "Partial",
    blocks: [],
    createdAt: 0,
    status: "stopped",
  };
  expect(valid("Message")(message)).toBe(true);
  expect(
    valid("FrameMessageEnd")({
      type: "message.end",
      protocol: "1.0",
      sequence: 1,
      messageId: "a",
      status: "stopped",
    }),
  ).toBe(true);
});

it("reply-stop is negotiated only when both sides offer it", () => {
  expect(
    negotiate(["1.0"], ["reply-stop"], { capabilities: ["reply-stop"] })
      .capabilities,
  ).toEqual(["reply-stop"]);
  expect(
    negotiate(["1.0"], ["reply-stop"], { capabilities: [] }).capabilities,
  ).toEqual([]);
});
