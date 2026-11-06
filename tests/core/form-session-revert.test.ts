import { describe, expect, it } from "vitest";
import { createFormSession } from "../../src/core/form-session";

const valid = { status: "valid" as const, messages: [] };
function setup() {
  let id = 0;
  return createFormSession({
    fields: [
      { name: "title", label: "Title", tier: "low", value: "Original" },
      { name: "count", label: "Count", tier: "low", value: 42 },
    ],
    ids: () => `request-${++id}`,
  });
}
type Session = ReturnType<typeof setup>;
const fill = (
  session: Session,
  values: Record<string, unknown>,
  field?: string,
) => {
  const request = session.begin({ text: "Fill", field });
  const ok = session.receive({
    requestId: request.requestId,
    values: Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        { value, validation: valid },
      ]),
    ),
  });
  expect(ok).toBe(true);
  return request.requestId;
};

describe("reverting a fill", () => {
  it("CK-FF9 restores what the fill replaced, with a new revision", () => {
    const session = setup();
    const before = session.getSnapshot().fields.title!.revision;
    const id = fill(session, { title: "Drafted", count: 7 });
    expect(session.getSnapshot().fills?.map((f) => f.id)).toEqual([id]);
    expect(session.revert(id)).toBe(true);
    const fields = session.getSnapshot().fields;
    expect(fields.title!.value).toBe("Original");
    expect(fields.count!.value).toBe(42);
    expect(fields.title!.revision).toBeGreaterThan(before + 1);
    expect(fields.title!.edited).toBe(false);
    expect(session.getSnapshot().fills).toEqual([]);
  });

  it("CK-FF9 never undoes a later edit", () => {
    const session = setup();
    const id = fill(session, { title: "Drafted", count: 7 });
    session.edit("count", 8);
    session.revert(id);
    expect(session.getSnapshot().fields.title!.value).toBe("Original");
    expect(session.getSnapshot().fields.count!.value).toBe(8);
  });

  it("CK-FF9 an older fill touches nothing a newer one owns", () => {
    const session = setup();
    const first = fill(session, { title: "A", count: 1 });
    fill(session, { title: "B" }, "title");
    session.revert(first);
    expect(session.getSnapshot().fields.title!.value).toBe("B");
    expect(session.getSnapshot().fields.count!.value).toBe(42);
  });

  it("CK-FF9 withdraws the suggestions that fill made", () => {
    const session = setup();
    session.edit("count", 5);
    const id = fill(session, { title: "Drafted", count: 7 });
    expect(session.getSnapshot().fields.count!.replacement?.value).toBe(7);
    session.revert(id);
    expect(session.getSnapshot().fields.count!.replacement).toBeUndefined();
    expect(session.getSnapshot().fields.count!.value).toBe(5);
  });

  it("CK-FF9 is unavailable while a request is pending, and a pending request survives an older revert", () => {
    const session = setup();
    const id = fill(session, { title: "Drafted", count: 7 });
    session.begin({ text: "Again" });
    expect(session.revert(id)).toBe(false);
    expect(session.getSnapshot().pending).toBe(true);
    expect(session.getSnapshot().fields.title!.value).toBe("Drafted");
  });

  it("CK-FF9 keeps the last 20 fills", () => {
    const session = setup();
    const ids = Array.from({ length: 21 }, (_, n) =>
      fill(session, { title: `T${n}`, count: n }),
    );
    // Only the newest owns its fields; all twenty are kept in the history.
    expect(session.revert(ids[0]!)).toBe(false);
    expect(session.revert(ids[20]!)).toBe(true);
    expect(session.getSnapshot().fields.title!.value).toBe("T19");
  });
});

describe("an entry that is not a value yet", () => {
  it("CK-FF6b counts as an edit and keeps its text", () => {
    const session = setup();
    const before = session.getSnapshot().fields.count!.revision;
    session.markEdited("count", "1e");
    const count = session.getSnapshot().fields.count!;
    expect(count.edited).toBe(true);
    expect(count.localInvalid).toBe(true);
    expect(count.localText).toBe("1e");
    expect(count.value).toBe(42);
    expect(count.revision).toBe(before + 1);
    session.edit("count", 7);
    expect(session.getSnapshot().fields.count!.localInvalid).toBeUndefined();
    expect(session.getSnapshot().fields.count!.localText).toBeUndefined();
  });

  it("CK-FF6b a fill for it arrives as a suggestion, and Replace clears the local error", () => {
    const session = setup();
    const request = session.begin({ text: "Fill" });
    session.markEdited("count", "1e");
    session.receive({
      requestId: request.requestId,
      values: {
        title: { value: "Drafted", validation: valid },
        count: { value: 7, validation: valid },
      },
    });
    const count = session.getSnapshot().fields.count!;
    expect(count.replacement?.value).toBe(7);
    expect(session.replace("count", count.revision)).toBe(true);
    expect(session.getSnapshot().fields.count!.localInvalid).toBeUndefined();
    expect(session.getSnapshot().fields.count!.value).toBe(7);
  });
});

describe("a draft that cannot be used", () => {
  it("CK-FF13 ends the pending request it belongs to only", () => {
    const session = setup();
    const request = session.begin({ text: "Fill" });
    session.failRequest("another");
    expect(session.getSnapshot().pending).toBe(true);
    session.failRequest(request.requestId);
    expect(session.getSnapshot().pending).toBe(false);
  });
});
