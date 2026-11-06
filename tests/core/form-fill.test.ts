import { it, expect, vi, describe, afterEach } from "vitest";
import { createFormSession } from "../../src/core/form-session";
import { negotiate } from "../../src/protocol/index";
const fields = [
  { name: "title", label: "Title", tier: "low" as const, value: "Original" },
  {
    name: "secret",
    label: "Secret",
    tier: "sensitive" as const,
    value: "Hidden",
  },
];
function setup() {
  let id = 0;
  return createFormSession({ fields, ids: () => `request-${++id}` });
}
it("negotiates form fill only with a compatible peer and preserves old chat", () => {
  expect(negotiate(["1.1", "1.0"], ["form-fill"])).toEqual({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  expect(negotiate(["1.0"], ["plans", "form-fill"])).toEqual({
    protocol: "1.0",
    capabilities: ["plans"],
  });
});
it("projects only low fields on initial and regenerated requests without saving", () => {
  const session = setup();
  const listener = vi.fn();
  session.subscribe(listener);
  const request = session.begin({
    text: "Fill",
    references: ["https://example.test/reference"],
  });
  expect(request.fields.map((f) => f.name)).toEqual(["title"]);
  expect(JSON.stringify(request)).not.toContain("Hidden");
  expect(
    session.receive({
      requestId: request.requestId,
      values: {
        title: {
          value: "Too long",
          validation: {
            status: "invalid",
            messages: ["Invalid"],
            guidance: "Shorten it",
          },
        },
      },
    }),
  ).toBe(true);
  expect(session.getSnapshot().fields.title?.value).toBe("Too long");
  expect(session.getSnapshot().fields.title?.validation?.guidance).toBe(
    "Shorten it",
  );
  expect(
    session.begin({ text: "Again", field: "title" }).fields.map((f) => f.name),
  ).toEqual(["title"]);
  expect(() => session.begin({ text: "No", field: "secret" })).toThrow();
  expect(listener).toHaveBeenCalled();
});
it("replaces untouched drafts and asks before replacing edits, checking prompt revisions", () => {
  const s = setup();
  const fill = (value: string) => {
    const r = s.begin({ text: "Fill" });
    s.receive({
      requestId: r.requestId,
      values: {
        title: { value, validation: { status: "valid", messages: [] } },
      },
    });
  };
  fill("Generated");
  fill("Regenerated");
  expect(s.getSnapshot().fields.title?.value).toBe("Regenerated");
  s.edit("title", "Mine");
  fill("Suggestion");
  expect(s.getSnapshot().fields.title?.value).toBe("Mine");
  const token = s.getSnapshot().fields.title!.replacement!.revision;
  s.edit("title", "New edit");
  expect(s.replace("title", token)).toBe(false);
  fill("New suggestion");
  expect(
    s.replace("title", s.getSnapshot().fields.title!.replacement!.revision),
  ).toBe(true);
  expect(s.getSnapshot().fields.title?.value).toBe("New suggestion");
  s.edit("title", "Keep");
  fill("Discard");
  s.cancelReplacement("title");
  expect(s.getSnapshot().fields.title?.value).toBe("Keep");
});
it("rejects incomplete, extra, duplicate, stale and disposed results", () => {
  const s = setup();
  const r = s.begin({ text: "Fill" });
  expect(s.receive({ requestId: r.requestId, values: {} })).toBe(false);
  expect(
    s.receive({
      requestId: r.requestId,
      values: {
        secret: { value: "No", validation: { status: "valid", messages: [] } },
      },
    }),
  ).toBe(false);
  const next = s.begin({ text: "New" });
  const value = {
    value: "Yes",
    validation: { status: "valid" as const, messages: [] },
  };
  expect(s.receive({ requestId: r.requestId, values: { title: value } })).toBe(
    false,
  );
  expect(
    s.receive({ requestId: next.requestId, values: { title: value } }),
  ).toBe(true);
  expect(
    s.receive({ requestId: next.requestId, values: { title: value } }),
  ).toBe(false);
  const pending = s.begin({ text: "Later" });
  s.dispose();
  expect(
    s.receive({ requestId: pending.requestId, values: { title: value } }),
  ).toBe(false);
  expect(Object.keys(s.getSnapshot().fields)).toEqual([]);
});
it("isolates two forms and detects edits while generation is pending", () => {
  const a = setup(),
    b = setup();
  const r = a.begin({ text: "Fill" });
  a.edit("title", "Mine");
  a.receive({
    requestId: r.requestId,
    values: {
      title: {
        value: "Generated",
        validation: { status: "valid", messages: [] },
      },
    },
  });
  expect(a.getSnapshot().fields.title?.replacement).toBeDefined();
  expect(b.getSnapshot().fields.title?.value).toBe("Original");
});
it("client form results never persist field drafts or call a write adapter", async () => {
  const { createWaypointClient } = await import("../../src/core/client");
  const { config } = await import("../support/client");
  const s = setup();
  const request = s.begin({ text: "Fill" });
  const cfg = config({ formSession: s });
  const set = vi.fn();
  cfg.storage = { get: () => null, set, remove: () => {} };
  cfg.transport.read = async () => ({
    protocol: "1.1",
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
        id: "result",
        role: "assistant",
        content: "",
        createdAt: 0,
        blocks: [
          {
            type: "form.fill",
            id: "block",
            fallback: "Draft",
            body: {
              requestId: request.requestId,
              values: {
                title: {
                  value: "Private draft value",
                  validation: { status: "valid", messages: [] },
                },
              },
            },
          },
        ],
      },
    ],
  });
  const send = vi.spyOn(cfg.transport, "send");
  const c = createWaypointClient(cfg);
  await c.ready;
  expect(s.getSnapshot().fields.title?.value).toBe("Private draft value");
  expect(send).not.toHaveBeenCalled();
  expect(JSON.stringify(set.mock.calls)).not.toContain("Private draft value");
  c.dispose();
  expect(Object.keys(s.getSnapshot().fields)).toEqual([]);
});
it("HTTP conversation source preserves creation ids and encodes subject filters", async () => {
  const { createHttpConversationSource } =
    await import("../../src/core/transports");
  const request = vi.fn(async (_path: string) => ({ status: 200, body: [] }));
  const source = createHttpConversationSource(request);
  await source.list("draft/a?b");
  expect(request.mock.calls[0]?.[0]).toBe(
    "/conversations?subject=draft%2Fa%3Fb",
  );
});
it("ignores inherited field names when editing or cancelling replacements", () => {
  const s = setup();
  s.edit("title", "Mine");
  s.edit("toString", "Injected");
  s.cancelReplacement("constructor");
  expect(s.replace("toString", 0)).toBe(false);
  expect(Object.keys(s.getSnapshot().fields)).toEqual(["title"]);
  expect(s.begin({ text: "Fill" }).fields.map((f) => f.name)).toEqual([
    "title",
  ]);
});
it("normalizes undefined initial and edited field values to null", () => {
  const s = createFormSession({
    fields: [{ name: "empty", label: "Empty", tier: "low", value: undefined }],
    ids: () => "empty",
  });
  expect(s.getSnapshot().fields.empty?.value).toBeNull();
  s.edit("empty", undefined);
  expect(s.begin({ text: "Fill" }).fields[0]?.value).toBeNull();
});
it("publishes pending fill state until a matching result or cancellation", () => {
  const s = setup();
  const listener = vi.fn();
  s.subscribe(listener);
  expect(s.getSnapshot()).toHaveProperty("pending", false);
  const r = s.begin({ text: "Fill" });
  expect(s.getSnapshot()).toHaveProperty("pending", true);
  expect(listener).toHaveBeenCalledOnce();
  s.receive({ requestId: "stale", values: {} });
  expect(s.getSnapshot()).toHaveProperty("pending", true);
  s.receive({
    requestId: r.requestId,
    values: {
      title: { value: "Draft", validation: { status: "valid", messages: [] } },
    },
  });
  expect(s.getSnapshot()).toHaveProperty("pending", false);
  s.begin({ text: "Again" });
  s.cancel();
  expect(s.getSnapshot()).toHaveProperty("pending", false);
});
describe("loading the form session on first use", () => {
  const fields = [
    { name: "title", label: "Title", tier: "low" as const, value: "Draft" },
  ];
  afterEach(() => {
    vi.doUnmock("../../src/core/form-session");
    vi.resetModules();
  });
  it("loads the session code and creates a working session", async () => {
    const { loadFormSession } = await import("../../src/core/form-fill");
    const session = await loadFormSession({ fields, ids: () => "request-1" });
    expect(session.getSnapshot().fields.title?.value).toBe("Draft");
  });
  it("rejects with the fixed retryable problem when loading fails, then retries", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/form-session", () => {
      throw new Error("chunk unavailable");
    });
    const { loadFormSession, FORM_SESSION_UNAVAILABLE } =
      await import("../../src/core/form-fill");
    await expect(
      loadFormSession({ fields, ids: () => "request-1" }),
    ).rejects.toEqual({ code: "retryable", id: "form-session-load" });
    expect(FORM_SESSION_UNAVAILABLE).toEqual({
      code: "retryable",
      id: "form-session-load",
    });
    vi.doUnmock("../../src/core/form-session");
    const session = await loadFormSession({ fields, ids: () => "request-1" });
    expect(session.getSnapshot().fields.title?.value).toBe("Draft");
  });
});
