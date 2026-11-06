import { vi } from "vitest";
import {
  ConversationReadError,
  createWaypointClient,
  type ClientConfig,
} from "../../src/core/client";
import { config, flush } from "./client";
import { fresh, recordOf } from "./host-plans";

const expired = { code: "agreement-expired", id: "agreement" };
// A host whose agreement can expire and whose next agreement may add or
// drop plan recovery; plan reads can be held.
export function renegotiationHost(start: { recovery: boolean }) {
  let issued = 0;
  let recovery = start.recovery;
  let expire = false;
  const plan = recordOf(fresh());
  const reads = {
    count: 0,
    hold: undefined as Promise<void> | undefined,
    // What the host's plan read returns.
    record: plan,
  };
  // A confirmation is accepted with this execution; its response can be
  // held.
  const confirms = {
    hold: undefined as Promise<void> | undefined,
    acceptance: undefined as
      { planId: string; executionId: string; fence: number } | undefined,
  };
  const sends: string[] = [];
  const base = config({ conversationId: "c" });
  const cfg: ClientConfig = {
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: [
          "plans",
          ...(recovery ? ["plan-recovery", "plan-leave", "plan-keep"] : []),
        ],
        agreementId: `agreement-${++issued}`,
      }),
      read: async (id, context) => {
        if (expire && context?.agreementId === `agreement-${issued}`) {
          expire = false;
          throw new ConversationReadError(id, 409, expired);
        }
        return { protocol: "1.0", id, title: "Chat", messages: [] };
      },
      send: async (reply) => {
        sends.push(reply.kind);
        if (reply.kind !== "confirm") return { id: reply.clientReplyId };
        await confirms.hold;
        return {
          id: reply.clientReplyId,
          ...(confirms.acceptance && { acceptance: confirms.acceptance }),
        };
      },
    },
    plans: {
      read: async () => {
        reads.count++;
        await reads.hold;
        return structuredClone(reads.record);
      },
      request: async () => {},
      heartbeat: async () => {},
      intent: vi.fn(async () => ({}) as never),
    },
  };
  const client = createWaypointClient(cfg);
  return {
    client,
    plan,
    reads,
    sends,
    confirms,
    // The next read is refused for an expired agreement; the client
    // renegotiates under the new capabilities.
    renegotiate: async (next: { recovery: boolean }) => {
      recovery = next.recovery;
      expire = true;
      await client.refresh().catch(() => {});
      await flush(20);
    },
  };
}
