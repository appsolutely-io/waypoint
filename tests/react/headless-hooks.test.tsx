// @vitest-environment jsdom
// The plan presses and the one-answer-per-card lock, used through the
// renderer-neutral entry without a provider, as a React Native host would.
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { usePlanView, useBlockReply, cardReplyId } from "../../src/hooks/index";
import * as react from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Block, PlanRecord } from "../../src/protocol/generated";
import { config, createManualClock, flush, platform } from "../support/client";
import {
  accept,
  createCardHost,
  decline,
  question,
  shownCard,
} from "../support/card-host";
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

it("useBlockReply sends one answer per card at a time and frees the card once settled", async () => {
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
  act(
    () =>
      void result.current.reply(card, { kind: "action", actionId: "accept" }),
  );
  act(
    () =>
      void result.current.reply(card, { kind: "action", actionId: "accept" }),
  );
  expect(result.current.answered.has("question-a")).toBe(true);
  const id = cardReplyId("conversation-a", "", "question-a", accept);
  await waitFor(() => expect(sent).toEqual([id]));
  await act(async () => release(false));
  await waitFor(() =>
    expect(result.current.answered.has("question-a")).toBe(false),
  );
  act(() => void result.current.reply(card, decline));
  await waitFor(() => expect(sent).toHaveLength(2));
  // Another answer is another request; the host decides whether it fits.
  expect(sent[1]).toBe(
    cardReplyId("conversation-a", "", "question-a", decline),
  );
  await act(async () => release(true));
  // Nothing is held here once the host answered: the read shows the card.
  await waitFor(() =>
    expect(result.current.answered.has("question-a")).toBe(false),
  );
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
  act(
    () =>
      void first.result.current.reply(card, {
        kind: "action",
        actionId: "accept",
      }),
  );
  await waitFor(() => expect(sent).toHaveLength(1));
  first.unmount();
  const again = renderHook(() => useBlockReply(client));
  expect(again.result.current.answered.has("question-a")).toBe(true);
  expect(again.result.current.isAnswered(card)).toBe(true);
  act(
    () =>
      void again.result.current.reply(card, {
        kind: "action",
        actionId: "accept",
      }),
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
  act(
    () =>
      void result.current.reply(card, { kind: "action", actionId: "accept" }),
  );
  await waitFor(() =>
    expect(result.current.answered.has("question-a")).toBe(false),
  );
  act(
    () =>
      void result.current.reply(card, { kind: "action", actionId: "accept" }),
  );
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

  it("the same answer to one card keeps its id, and answers to other cards differ", async () => {
    const { client, sent } = refusing();
    await client.ready;
    const { result } = renderHook(() => useBlockReply(client));
    act(() => void result.current.reply({ id: "q" }, answer));
    await waitFor(() => expect(result.current.answered.has("q")).toBe(false));
    act(() => void result.current.reply({ id: "q" }, answer));
    await waitFor(() => expect(sent).toHaveLength(2));
    act(() => void result.current.reply({ id: "q:2" }, answer));
    act(() => void result.current.reply({ id: "q#2" }, answer));
    await waitFor(() => expect(sent).toHaveLength(4));
    // The same answer to one card is one request; other cards differ.
    expect(sent[1]).toBe(sent[0]);
    expect(new Set(sent).size).toBe(3);
    client.dispose();
  });

  it("a card id used again by a later message is not locked by the first", async () => {
    const { client } = refusing();
    await client.ready;
    const { result } = renderHook(() => useBlockReply(client));
    act(() => void result.current.reply({ id: "same" }, answer, "message-1"));
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
    act(
      () =>
        void result.current.reply(
          { id: "b".repeat(200) },
          answer,
          "m".repeat(200),
        ),
    );
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.length).toBeLessThanOrEqual(128);
    client.dispose();
  });
});

describe("the host holds one answer per card; the client shows what it reads", () => {
  // Presses an answer and waits until the card has settled.
  const press = async (
    result: { current: ReturnType<typeof useBlockReply> },
    answer: typeof accept,
  ) => {
    await act(async () => {
      await result.current.reply(question, answer, "m");
    });
  };

  it("after a reload mid-send, another answer is refused and the applied one shown", async () => {
    const host = createCardHost({ lose: (send) => send === 1 });
    const first = host.client();
    await first.ready;
    const page = renderHook(() => useBlockReply(first));
    await press(page.result, accept);
    // The page goes away with the response lost; a new page answers again.
    page.unmount();
    first.dispose();
    const second = host.client();
    await second.ready;
    const { result } = renderHook(() => useBlockReply(second));
    await press(result, decline);
    await press(result, decline);
    expect(host.applied).toEqual(["accept"]);
    expect(result.current.isAnswered(shownCard(second), "m")).toBe(true);
    second.dispose();
  });

  it("in a second tab, another answer is refused and both tabs show the card answered", async () => {
    const host = createCardHost({ lose: (send) => send === 1 });
    const one = host.client();
    const two = host.client();
    await Promise.all([one.ready, two.ready]);
    const tab1 = renderHook(() => useBlockReply(one));
    const tab2 = renderHook(() => useBlockReply(two));
    await press(tab1.result, accept);
    await press(tab2.result, decline);
    await press(tab2.result, decline);
    expect(host.applied).toEqual(["accept"]);
    expect(tab1.result.current.isAnswered(shownCard(one), "m")).toBe(true);
    expect(tab2.result.current.isAnswered(shownCard(two), "m")).toBe(true);
    one.dispose();
    two.dispose();
  });

  it("the same answer after a reload is the same request, so the host deduplicates it", async () => {
    const host = createCardHost({ lose: (send) => send === 1 });
    const first = host.client();
    await first.ready;
    await press(renderHook(() => useBlockReply(first)).result, accept);
    first.dispose();
    const second = host.client();
    await second.ready;
    const { result } = renderHook(() => useBlockReply(second));
    await press(result, accept);
    expect(host.applied).toEqual(["accept"]);
    expect(second.getSnapshot().problem).toBeNull();
    second.dispose();
  });

  for (const [kind, error, closes] of [
    ["declined", { id: "p", code: "declined" }, false],
    ["closed", { id: "p", code: "closed" }, true],
    ["a plain 409", { status: 409 }, false],
    ["a 422", { title: "Unprocessable Content" }, false],
  ] as const)
    it(`after ${kind}, the card shows what the host reads and is never stuck`, async () => {
      const host = createCardHost({
        refuse: (send) =>
          send === 1 ? { error, answered: closes } : undefined,
      });
      const client = host.client();
      await client.ready;
      const { result } = renderHook(() => useBlockReply(client));
      const reads = host.reads();
      await press(result, accept);
      expect(host.reads()).toBeGreaterThan(reads);
      expect(result.current.answered.size).toBe(0);
      expect(result.current.isAnswered(shownCard(client), "m")).toBe(closes);
      // An open card takes the user's next choice.
      await press(result, decline);
      expect(host.applied).toEqual(closes ? [] : ["decline"]);
      client.dispose();
    });

  it("a read that never returns ends in the read error with a retry, and the card is not held", async () => {
    let hanging = false;
    const host = createCardHost({
      lose: (send) => send === 1,
      hang: () => hanging,
    });
    const manual = createManualClock();
    const client = host.client({
      platform: { ...platform, clock: manual.clock },
    });
    await client.ready;
    const { result } = renderHook(() => useBlockReply(client));
    hanging = true;
    let settled = false;
    act(() => {
      void result.current.reply(question, accept, "m").then(() => {
        settled = true;
      });
    });
    await act(() => flush());
    // The send's problem is shown at once, before the read answers.
    expect(client.getSnapshot().problem?.code).toBe("in-doubt");
    expect(settled).toBe(false);
    await act(() => manual.advance(10000));
    expect(settled).toBe(true);
    expect(client.getSnapshot().problem).toMatchObject({
      code: "unavailable",
      id: "conversation-read",
    });
    expect(result.current.answered.size).toBe(0);
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
    act(
      () =>
        void result.current.reply(
          { id: "q\ud800" },
          { kind: "action", actionId: "accept" },
        ),
    ),
  ).not.toThrow();
  await waitFor(() => expect(sent).toHaveLength(1));
  // Unpaired units are escaped on their own, so they never meet another id.
  expect(sent[0]).toMatch(/^card:conversation-a::q%d800:[0-9a-f]{16}$/);
  expect(cardReplyId("a", "", "\udc00x", accept)).not.toBe(
    cardReplyId("a", "", "\ufffdx", accept),
  );
  client.dispose();
});
