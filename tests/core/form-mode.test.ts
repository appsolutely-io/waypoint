import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  type TransportEvent,
} from "../../src/core/client";
import { config } from "../support/client";
it("reopened form mode refuses reads, plans and flows at core entry points", async () => {
  const cfg = config();
  let deliver: (e: TransportEvent) => void = () => {};
  cfg.transport.read = async () => ({
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    messages: [],
    mode: "form-fill",
    subject: {
      key: "draft-a",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
  });
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill", "plans", "flows"],
  });
  cfg.transport.subscribe = (_id, listener) => {
    deliver = listener;
    return () => {};
  };
  const read = vi.fn(),
    run = vi.fn();
  cfg.reads = { manifest: [], request: read };
  cfg.flowSource = { list: async () => [], setFavourite: async () => {}, run };
  const c = createWaypointClient(cfg);
  await c.ready;
  deliver({
    type: "frame",
    frame: {
      protocol: "1.1",
      sequence: 1,
      type: "tool.call",
      call: {
        id: "read",
        operation: "items.list",
        method: "GET",
        path: "/items",
        query: {},
      },
    },
  });
  await c.runFlow("flow", {});
  await c.runPlan("plan", "digest");
  expect(read).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(
    await c.reply({
      kind: "tool-result",
      clientReplyId: "no",
      callId: "read",
      result: {},
    }),
  ).toBe(false);
  c.dispose();
});
it("form chat sends field-projected form requests and refuses ordinary replies", async () => {
  const { createFormSession } = await import("../../src/core/form-session");
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "form-request",
  });
  const cfg = config({ formSession: session });
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async () => ({
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    messages: [],
    mode: "form-fill",
    subject: {
      key: "draft-a",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
  });
  const send = vi.spyOn(cfg.transport, "send");
  const c = createWaypointClient(cfg);
  await c.ready;
  await c.setDraft("Fill this");
  await c.send();
  expect(send.mock.calls[0]?.[0].kind).toBe("form-fill");
  expect(
    await c.reply({
      kind: "message",
      clientReplyId: "general",
      clientMessageId: "general",
      content: "No fields",
    }),
  ).toBe(false);
  c.dispose();
});
it("does not route form regeneration through general message version adapters", async () => {
  const cfg = config();
  cfg.transport.read = async () => ({
    protocol: "1.0",
    id: "conversation-a",
    title: "Form",
    mode: "form-fill",
    subject: {
      key: "draft-a",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
    messages: [
      {
        id: "assistant",
        role: "assistant",
        content: "Draft",
        blocks: [],
        createdAt: 0,
      },
    ],
  });
  const regenerate = vi.fn();
  cfg.versions = { regenerate, edit: vi.fn(), select: vi.fn() };
  const c = createWaypointClient(cfg);
  await c.ready;
  await c.regenerate("assistant");
  expect(regenerate).not.toHaveBeenCalled();
  c.dispose();
});
it("scopes ordinary composer followups to the child field", async () => {
  const { createFormSession } = await import("../../src/core/form-session");
  const s = createFormSession({
    fields: [
      { name: "title", label: "Title", tier: "low", value: "" },
      { name: "summary", label: "Summary", tier: "low", value: "" },
    ],
    ids: () => "child-request",
  });
  const cfg = config({ formSession: s });
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async () => ({
    protocol: "1.1",
    id: "conversation-a",
    title: "Child",
    messages: [],
    mode: "form-fill",
    subject: {
      key: "draft-a",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
    parentConversationId: "root",
    field: "title",
  });
  const send = vi.spyOn(cfg.transport, "send");
  const c = createWaypointClient(cfg);
  await c.ready;
  await c.setDraft("Refine it");
  await c.send();
  const reply = send.mock.calls[0]![0];
  expect(reply.kind).toBe("form-fill");
  if (reply.kind === "form-fill") {
    expect(reply.request.field).toBe("title");
    expect(reply.request.fields.map((f) => f.name)).toEqual(["title"]);
  }
  c.dispose();
});
it("reuses failed composer form requests until the material changes", async () => {
  const { createFormSession } = await import("../../src/core/form-session");
  let serial = 0;
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => `request-${++serial}`,
  });
  const cfg = config({ formSession: session });
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async (id) => ({
    protocol: "1.1",
    id,
    title: "Form",
    messages: [],
    mode: "form-fill",
  });
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({ id: "accepted" });
  cfg.transport.send = send;
  const c = createWaypointClient(cfg);
  await c.ready;
  await c.setDraft("Fill this");
  await c.send();
  await c.send();
  expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
  await c.setDraft("Different material");
  await c.send();
  expect(send.mock.calls[2]![0].clientReplyId).not.toBe(
    send.mock.calls[0]![0].clientReplyId,
  );
  c.dispose();
});
