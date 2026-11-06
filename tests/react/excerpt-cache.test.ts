// The excerpt cache keeps only what the chat shows now: entries of the
// current client and conversation, for shown messages with their current
// source, under the current policy. It stays lazy: nothing is projected
// until asked for.
import { describe, expect, it } from "vitest";
import { ExcerptCache } from "../../src/react/excerpt-cache";

// A shown message and the source its excerpt is made from.
const message = (id: string, content: string) => ({ id, source: content });
describe("CK-FU4 the excerpt cache's membership", () => {
  const project = (calls: string[]) => (source: string) => {
    calls.push(source);
    return source.toUpperCase();
  };
  it("asks for nothing until a message is projected, and reuses a projection", () => {
    const cache = new ExcerptCache();
    const calls: string[] = [];
    cache.begin("1:a", ["p"], [message("m1", "one"), message("m2", "two")]);
    expect(cache.entries()).toEqual([]);
    expect(cache.get("m1", "one", project(calls))).toBe("ONE");
    expect(cache.get("m1", "one", project(calls))).toBe("ONE");
    expect(calls).toEqual(["one"]);
  });
  it("keeps only the current source of a revised message", () => {
    const cache = new ExcerptCache();
    const calls: string[] = [];
    for (let revision = 1; revision <= 31; revision++) {
      const content = "x".repeat(revision);
      cache.begin("1:a", ["p"], [message("m1", content)]);
      cache.get("m1", content, project(calls));
    }
    expect(cache.entries()).toEqual([{ id: "m1", source: "x".repeat(31) }]);
  });
  it("drops a replaced message's old source at the next render, though nothing asks for its excerpt", () => {
    const cache = new ExcerptCache();
    cache.begin("1:a", ["p"], [message("m1", "old private source")]);
    cache.get("m1", "old private source", project([]));
    // The outline is collapsed: no get follows the render.
    cache.begin("1:a", ["p"], [message("m1", "new source")]);
    expect(cache.entries()).toEqual([]);
  });
  it("drops a removed message's entry at the next render", () => {
    const cache = new ExcerptCache();
    cache.begin("1:a", ["p"], [message("m1", "one"), message("m2", "two")]);
    cache.get("m1", "one", project([]));
    cache.get("m2", "two", project([]));
    cache.begin("1:a", ["p"], [message("m2", "two")]);
    expect(cache.entries()).toEqual([{ id: "m2", source: "two" }]);
  });
  it.each([
    ["a conversation switch", "1:b", ["p"]],
    ["a client replacement", "2:a", ["p"]],
    ["a policy change", "1:a", ["q"]],
  ])("is emptied by %s", (_, owner, policy) => {
    const cache = new ExcerptCache();
    cache.begin("1:a", ["p"], [message("m1", "one")]);
    cache.get("m1", "one", project([]));
    cache.begin(owner, policy, [message("m1", "one")]);
    expect(cache.entries()).toEqual([]);
  });
  it("never holds more entries than shown messages", () => {
    const cache = new ExcerptCache();
    const shown = Array.from({ length: 5 }, (_, i) =>
      message(`m${i}`, `c${i}`),
    );
    cache.begin("1:a", ["p"], shown);
    for (const each of shown) cache.get(each.id, each.source, project([]));
    cache.begin("1:a", ["p"], shown.slice(0, 2));
    expect(cache.entries().length).toBeLessThanOrEqual(2);
  });
});
