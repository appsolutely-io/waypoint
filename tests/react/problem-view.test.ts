// A UI drawn from /hooks (React Native included) words a problem and the
// reply row the way the web chat does: message keys and the one action,
// never strings.
import { it, expect } from "vitest";
import { problemView, replyRowView } from "../../src/hooks/index";
import { createFormatter } from "../../src/messages/index";
import en from "../../src/messages/en";
import zhHans from "../../src/messages/zh-Hans";

it("names a problem's words, its action and its details", () => {
  expect(problemView({ code: "retryable", id: "sending" })).toEqual({
    key: "chat.problem.retryable",
    action: "retry",
    code: "retryable",
    id: "sending",
  });
  expect(problemView({ code: "replaced", id: "x" })).toMatchObject({
    key: "chat.problem.replaced",
    action: "refresh",
  });
  expect(problemView({ code: "refused", id: "x" })).toEqual({
    key: "chat.problem.refused",
    code: "refused",
    id: "x",
  });
  expect(
    problemView({ code: "unavailable", id: "conversation-read" }).key,
  ).toBe("chat.conversationReadFailed");
  expect(
    problemView({ code: "unavailable", id: "conversation-unavailable" }).key,
  ).toBe("chat.conversationUnavailable");
  expect(
    problemView({ code: "refused", id: "card" }, { answeredElsewhere: true })
      .key,
  ).toBe("chat.problem.answered");
});

it("names the reply row's words and its buttons", () => {
  expect(replyRowView("none")).toEqual({ actions: [] });
  expect(replyRowView("writing")).toEqual({
    key: "reply.writing",
    actions: [],
  });
  expect(replyRowView("writing", { canStop: true }).actions).toEqual([
    { id: "stop", labelKey: "chat.reply.stop" },
  ]);
  expect(replyRowView("overdue").actions).toEqual([
    { id: "keepWaiting", labelKey: "chat.reply.keepWaiting" },
    { id: "retry", labelKey: "chat.retry" },
  ]);
  for (const state of ["failed", "unavailable"] as const)
    expect(replyRowView(state)).toEqual({
      key: `reply.${state}`,
      actions: [{ id: "retry", labelKey: "chat.retry" }],
    });
});

it("every key they name has text in each locale entry", () => {
  for (const catalogue of [en, zhHans]) {
    const t = createFormatter("en", catalogue);
    for (const state of [
      "writing",
      "overdue",
      "failed",
      "unavailable",
    ] as const) {
      const view = replyRowView(state, { canStop: true });
      expect(t(view.key!)).not.toBe("");
      for (const action of view.actions)
        expect(t(action.labelKey)).not.toBe("");
    }
    expect(t(problemView({ code: "full", id: "x" }).key)).not.toBe("");
  }
});
