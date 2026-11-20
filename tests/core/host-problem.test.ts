import { expect, it, vi } from "vitest";
import {
  asProblem,
  readProblem,
  createWaypointClient,
} from "../../src/core/client";
import type { TransportEvent } from "../../src/core/client";
import { config } from "../support/client";

it("an incoming host id cannot replace the local problem id", () => {
  const host = { code: "availability", qualifier: "temporary" };
  const problem = asProblem(
    { code: "refused", id: "host-id", host },
    "local-id",
  );
  expect(problem).toEqual({ code: "refused", id: "local-id", host });
  expect(problem).toHaveProperty("host", host);
  expect(Reflect.get(problem, "host")).not.toBe(host);
  host.qualifier = "permanent";
  expect(problem).toHaveProperty("host.qualifier", "temporary");
});

it("read failures keep host detail with existing behavioral codes", () => {
  expect(
    readProblem(
      { code: "refused", host: { code: "availability" } },
      "conversation-read",
    ),
  ).toEqual({
    code: "unavailable",
    id: "conversation-read",
    host: { code: "availability" },
  });
  expect(
    readProblem(
      { code: "rate-limited", retryAfter: 7, host: null },
      "conversation-read",
    ),
  ).toEqual({
    code: "rate-limited",
    id: "conversation-read",
    retryAfter: 7,
    host: null,
  });
});

it.each([
  undefined,
  null,
  {},
  { code: 5 },
  { code: "" },
  { code: "x".repeat(129) },
  { code: "availability", qualifier: 5 },
  { code: "availability", qualifier: "" },
  { code: "availability", qualifier: "x".repeat(129) },
])(
  "malformed host detail is absent without changing the behavioral code (%j)",
  (host) => {
    const result = asProblem({ code: "refused", host }, "local-id");
    expect(result).toEqual({
      code: "refused",
      id: "local-id",
      ...(host === null ? { host: null } : {}),
    });
  },
);

it("legacy problems without host detail keep their actions and error placement", () => {
  expect(
    asProblem(
      { code: "refused", confirmation: { reason: "used" } },
      "local-id",
    ),
  ).toEqual({
    code: "refused",
    id: "local-id",
    confirmation: { reason: "used" },
  });
  expect(asProblem(new Error("untrusted text"), "local-id")).toEqual({
    code: "in-doubt",
    id: "local-id",
  });
});

it("stream problem frames preserve host ids except pending-message collisions", async () => {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  let finish!: (value: { id: string }) => void;
  const send = vi.fn(
    () =>
      new Promise<{ id: string }>((resolve) => {
        finish = resolve;
      }),
  );
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send,
      subscribe: (_id, receive) => {
        listener = receive;
        return () => {};
      },
    },
  });
  await client.ready;
  await client.setDraft("Pending message");
  const sending = client.send();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  const id = client.getSnapshot().pending[0]!.id;
  listener({
    type: "frame",
    frame: {
      protocol: "1.0",
      sequence: 1,
      type: "problem",
      problem: { code: "refused", id, host: { code: "availability" } },
    },
  });
  const remapped = client.getSnapshot().problem!;
  expect(remapped.id).not.toBe(id);
  expect(remapped).toHaveProperty("host.code", "availability");
  for (const hostId of ["host-plan", "settled-message"]) {
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: hostId === "host-plan" ? 2 : 3,
        type: "problem",
        problem: { code: "plan-changed", id: hostId },
      },
    });
    expect(client.getSnapshot().problem?.id).toBe(hostId);
  }
  finish({ id: "accepted" });
  await sending;
  expect(client.getSnapshot().problem).toBeNull();
  client.report(remapped);
  expect(client.getSnapshot().problem?.id).toBe(remapped.id);
  client.dispose();
});

it("a stream problem naming a failed send stays on that send", async () => {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        throw { code: "refused" };
      },
      subscribe: (_id, receive) => {
        listener = receive;
        return () => {};
      },
    },
  });
  await client.ready;
  await client.setDraft("Refused message");
  await client.send();
  const row = client.getSnapshot().pending[0]!;
  listener({
    type: "frame",
    frame: {
      protocol: "1.0",
      sequence: 1,
      type: "problem",
      problem: { code: "retryable", id: row.id },
    },
  });
  expect(client.getSnapshot().problem).toEqual({
    code: "retryable",
    id: row.id,
  });
  expect(client.getSnapshot().pending[0]!.failure).toEqual(row.failure);
  client.dispose();
});
