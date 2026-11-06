// @vitest-environment jsdom
// The plan presses and the one-answer-per-card lock, used through the
// renderer-neutral entry without a provider, as a React Native host would.
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { usePlanView, useBlockReply, cardReplyId } from "../../src/hooks/index";
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
  await waitFor(() =>
    expect(sent).toEqual(["card:conversation-a::question-a"]),
  );
  await act(async () => release(false));
  await waitFor(() =>
    expect(result.current.answered.has("question-a")).toBe(false),
  );
  act(() => result.current.reply(card, { kind: "action", actionId: "accept" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  // Another answer after a refusal is a new reply, not a replay of it.
  expect(sent[1]).toBe("card:conversation-a::question-a#2");
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

it("an answer sent again after an uncertain failure keeps its reply id", async () => {
  const base = config();
  const sent: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        sent.push(reply.clientReplyId);
        // The host may have applied it; the answer was lost on the way back.
        if (sent.length === 1) throw new TypeError("Failed to fetch");
        return { id: reply.clientReplyId };
      },
    },
  });
  await client.ready;
  const { result } = renderHook(() => useBlockReply(client));
  act(() => result.current.reply(card, { kind: "action", actionId: "accept" }));
  await waitFor(() =>
    expect(result.current.answered.has("question-a")).toBe(false),
  );
  act(() => result.current.reply(card, { kind: "action", actionId: "accept" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  // The same answer, so the host can tell it already has it.
  expect(sent[1]).toBe(sent[0]);
  client.dispose();
});

describe("card reply ids and locks never collide", () => {
  const refusing = () => {
    const base = config();
    const sent: string[] = [];
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        send: async (reply) => {
          sent.push(reply.clientReplyId);
          if ("blockId" in reply && reply.blockId === "q")
            throw { id: "p", code: "refused" };
          return { id: reply.clientReplyId };
        },
      },
    });
    return { client, sent };
  };
  const answer = { kind: "action" as const, actionId: "accept" };

  it("a second attempt at one card and the first answer to another differ", async () => {
    const { client, sent } = refusing();
    await client.ready;
    const { result } = renderHook(() => useBlockReply(client));
    act(() => result.current.reply({ id: "q" }, answer));
    await waitFor(() => expect(result.current.answered.has("q")).toBe(false));
    act(() => result.current.reply({ id: "q" }, answer));
    await waitFor(() => expect(sent).toHaveLength(2));
    act(() => result.current.reply({ id: "q:2" }, answer));
    act(() => result.current.reply({ id: "q#2" }, answer));
    await waitFor(() => expect(sent).toHaveLength(4));
    expect(new Set(sent).size).toBe(4);
    client.dispose();
  });

  it("a card id used again by a later message is not locked by the first", async () => {
    const { client } = refusing();
    await client.ready;
    const { result } = renderHook(() => useBlockReply(client));
    act(() => result.current.reply({ id: "same" }, answer, "message-1"));
    await waitFor(() =>
      expect(result.current.isAnswered({ id: "same" }, "message-1")).toBe(true),
    );
    expect(result.current.isAnswered({ id: "same" }, "message-2")).toBe(false);
    client.dispose();
  });

  it("a reply id stays within the protocol's 128 characters", async () => {
    const { client, sent } = refusing();
    await client.ready;
    const { result } = renderHook(() => useBlockReply(client));
    act(() =>
      result.current.reply({ id: "b".repeat(200) }, answer, "m".repeat(200)),
    );
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.length).toBeLessThanOrEqual(128);
    client.dispose();
  });
});

it("a card id with a lone surrogate gets a reply id and is sent", async () => {
  const base = config();
  const sent: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        sent.push(reply.clientReplyId);
        return { id: reply.clientReplyId };
      },
    },
  });
  await client.ready;
  const { result } = renderHook(() => useBlockReply(client));
  expect(() =>
    act(() =>
      result.current.reply(
        { id: "q\ud800" },
        { kind: "action", actionId: "accept" },
      ),
    ),
  ).not.toThrow();
  await waitFor(() => expect(sent).toHaveLength(1));
  // Unpaired units are escaped on their own, so they never meet another id.
  expect(sent[0]).toBe("card:conversation-a::q%d800");
  expect(cardReplyId("a", "", "\udc00x", 1)).not.toBe(
    cardReplyId("a", "", "\ufffdx", 1),
  );
  client.dispose();
});
