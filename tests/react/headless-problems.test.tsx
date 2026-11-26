// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createWaypointClient } from "../../src/core/client";
import type { TransportEvent } from "../../src/core/client";
import {
  pendingProblem,
  useWaypointSnapshot,
  visibleProblem,
} from "../../src/hooks";
import { config, flush } from "../support/client";
afterEach(cleanup);

it("a headless failed row falls back to its own failure when the matching problem clears", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        throw {
          code: "refused",
          host: { code: "availability", qualifier: "temporary" },
        };
      },
    },
  });
  await client.ready;
  await client.setDraft("Refused");
  await client.send();
  // The refusal settles after the send resolves; the hook reads the
  // settled row.
  await flush();
  const row = client.getSnapshot().pending[0]!;
  const { result } = renderHook(() => {
    const snapshot = useWaypointSnapshot(client);
    return pendingProblem(
      snapshot.pending[0]!,
      visibleProblem(snapshot.problem),
    );
  });
  expect(result.current).toEqual(row.failure);
  act(() =>
    client.report({
      code: "rate-limited",
      id: row.id,
      retryAfter: 7,
      host: { code: "quota" },
    }),
  );
  expect(result.current).toHaveProperty("host.code", "quota");
  act(() =>
    client.report({ code: "unavailable", id: "unrelated-host-problem" }),
  );
  expect(result.current).toEqual(row.failure);
  expect(client.getSnapshot().pending[0]!.failure).toEqual(row.failure);
  client.dispose();
});

it.each([false, true])(
  "a problem naming a failed send moves below the composer while it is retried (headless, accepted=%s)",
  async (accepted) => {
    const base = config();
    let receive!: (event: TransportEvent) => void;
    let resolve!: (result: { id: string }) => void;
    let reject!: (failure: unknown) => void;
    const send = vi
      .fn<typeof base.transport.send>()
      .mockRejectedValueOnce({ code: "refused" })
      .mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        send,
        subscribe: (_id, listener) => {
          receive = listener;
          return () => {};
        },
      },
    });
    await client.ready;
    await client.setDraft("Retry");
    await client.send();
    // The refusal settles after the send resolves; an override only names
    // a failed row.
    await flush();
    const row = client.getSnapshot().pending[0]!;
    receive({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 1,
        type: "problem",
        problem: { code: "retryable", id: row.id },
      },
    });
    const override = client.getSnapshot().problem!;
    expect(
      pendingProblem(
        client.getSnapshot().pending[0]!,
        visibleProblem(override),
      ),
    ).toEqual(override);
    const retrying = client.retry(row.id);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const snapshot = client.getSnapshot();
    const shown = visibleProblem(snapshot.problem);
    expect(snapshot.pending[0]!.failure).toBeNull();
    expect(pendingProblem(snapshot.pending[0]!, shown)).toBeNull();
    expect(shown?.id).toBe(row.id);
    expect(
      snapshot.pending.some(
        (pending) => pending.failure && pending.id === shown?.id,
      ),
    ).toBe(false);
    if (accepted) resolve({ id: "accepted" });
    else reject({ code: "refused", host: { code: "settings" } });
    await retrying;
    if (accepted) expect(client.getSnapshot().problem).toBeNull();
    else
      expect(client.getSnapshot().pending[0]!.failure).toEqual(
        client.getSnapshot().problem,
      );
    client.dispose();
  },
);

it("headless and web exclude the same ineligible pending overrides", () => {
  const row = {
    id: "row",
    failure: {
      code: "refused" as const,
      id: "row",
      host: { code: "availability" },
    },
  };
  const cases = [
    [{ code: "refused", id: "row", confirmation: { reason: "used" } }, {}],
    [{ code: "stopped", id: "row" }, { planStopped: true }],
    [{ code: "retryable", id: "row" }, { checking: true }],
  ] as const;
  for (const [problem, options] of cases) {
    expect(visibleProblem(problem, options)).toBeUndefined();
    expect(pendingProblem(row, visibleProblem(problem, options))).toEqual(
      row.failure,
    );
  }
  expect(
    visibleProblem(
      { code: "unavailable", id: "conversation-read" },
      { conversationUnavailable: true },
    ),
  ).toBeUndefined();
  expect(
    visibleProblem({ code: "unavailable", id: "conversation-unavailable" }),
  ).toBeUndefined();
});
