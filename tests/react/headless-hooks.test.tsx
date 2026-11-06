// @vitest-environment jsdom
// The plan presses and the one-answer-per-card lock, used through the
// renderer-neutral entry without a provider, as a React Native host would.
import { it, expect, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { usePlanView, useBlockReply } from "../../src/hooks/index";
import * as react from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Block, PlanRecord } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const card: Block = {
  type: "buttons",
  id: "question-a",
  fallback: "Answer",
  body: { actions: [{ id: "accept", label: "Accept" }] },
};

it("the React entry exports the same hooks", () => {
  expect(react.usePlanView).toBe(usePlanView);
  expect(react.useBlockReply).toBe(useBlockReply);
});

it("usePlanView reads the plan and presses through the client, with no provider", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const confirmed: string[] = [];
  client.confirmPlan = async () => {
    confirmed.push("confirm");
  };
  const { result } = renderHook(() => usePlanView(client));
  expect(result.current.view).toBeNull();
  const record = {
    protocol: "1.0",
    id: "plan-a",
    state: "awaiting-confirmation",
    outcomes: [],
    confirmation: {
      token: "token-a",
      expiresAt: "2999-01-01T00:00:00Z",
      planId: "plan-a",
      conversationId: "conversation-a",
      revision: 1,
      heading: "Update one record",
      items: [],
      irreversible: false,
      undo: "Can be undone.",
      verificationCount: 0,
    },
    plan: {
      kind: "immediate",
      stage: "final",
      id: "plan-a",
      digest: "d",
      stepUpCount: 0,
      steps: [],
    },
  } as unknown as PlanRecord;
  act(() => client.setPlan(record));
  await waitFor(() => expect(result.current.view).not.toBeNull());
  expect(result.current.view!.actions.map((entry) => entry.id)).toContain(
    "confirm",
  );
  act(() => result.current.press("confirm"));
  expect(confirmed).toEqual(["confirm"]);
  client.dispose();
});

it("useBlockReply sends one answer per card and frees a refused one", async () => {
  const base = config();
  let release: (accepted: boolean) => void = () => {};
  const sent: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: (reply) => {
        sent.push(reply.clientReplyId);
        return new Promise((resolve, reject) => {
          release = (accepted) =>
            accepted
              ? resolve({ id: reply.clientReplyId })
              : reject({ id: "p", code: "refused" });
        });
      },
    },
  });
  await client.ready;
  const { result } = renderHook(() => useBlockReply(client));
  act(() => result.current.reply(card, { kind: "action", actionId: "accept" }));
  act(() => result.current.reply(card, { kind: "action", actionId: "accept" }));
  expect(result.current.answered.has("question-a")).toBe(true);
  await waitFor(() => expect(sent).toEqual(["conversation-a:question-a"]));
  await act(async () => release(false));
  await waitFor(() =>
    expect(result.current.answered.has("question-a")).toBe(false),
  );
  act(() => result.current.reply(card, { kind: "action", actionId: "accept" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  // Another answer after a refusal is a new reply, not a replay of it.
  expect(sent[1]).toBe("conversation-a:question-a:2");
  await act(async () => release(true));
  expect(result.current.answered.has("question-a")).toBe(true);
  client.dispose();
});

it("the lock outlives a re-mount while the answer is in flight", async () => {
  const base = config();
  const sent: string[] = [];
  let release: () => void = () => {};
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: (reply) => {
        sent.push(reply.clientReplyId);
        return new Promise((resolve) => {
          release = () => resolve({ id: reply.clientReplyId });
        });
      },
    },
  });
  await client.ready;
  const first = renderHook(() => useBlockReply(client));
  act(() =>
    first.result.current.reply(card, { kind: "action", actionId: "accept" }),
  );
  await waitFor(() => expect(sent).toHaveLength(1));
  first.unmount();
  const again = renderHook(() => useBlockReply(client));
  expect(again.result.current.answered.has("question-a")).toBe(true);
  expect(again.result.current.isAnswered(card)).toBe(true);
  act(() =>
    again.result.current.reply(card, { kind: "action", actionId: "accept" }),
  );
  await act(async () => release());
  expect(sent).toHaveLength(1);
  client.dispose();
});

it("isAnswered counts a card the host already marks answered", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const { result } = renderHook(() => useBlockReply(client));
  expect(result.current.isAnswered(card)).toBe(false);
  expect(result.current.isAnswered({ ...card, answered: true })).toBe(true);
  client.dispose();
});
