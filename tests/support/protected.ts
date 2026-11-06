import { createFixtureServer } from "../../fixtures/server/index";
import { createWaypointClient, type ClientConfig } from "../../src/core/client";
import { createSseTransport } from "../../src/core/transports";
import type { HttpRequest } from "../../src/conformance/index";
import type {
  IntentRequest,
  PlanIntentReply,
  PlanRecord,
} from "../../src/protocol/generated";
import { platform } from "./client";

// A reference host with a protected plan, and clients wired to it over HTTP.
export async function protectedHost(rows: string[] = ["a", "b"]) {
  const host = await createFixtureServer({ testMode: true });
  const session = (await (
    await fetch(host.url + "/__conformance/session", { method: "POST" })
  ).json()) as { session: string; csrf: string };
  const auth = {
    Cookie: `waypoint=${session.session}`,
    "X-CSRF-Token": session.csrf,
  };
  const calls: { path: string; body?: string }[] = [];
  const request: HttpRequest = async (path, init) => {
    calls.push({ path, body: init?.body });
    const response = await fetch(host.url + path, {
      method: init?.method,
      body: init?.body,
      headers: { ...auth, ...init?.headers },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const conversation = (
    (await post("/conversations", { protocol: "1.0", title: "Plan" })) as {
      body: { id: string };
    }
  ).body.id;
  const control = (body: Record<string, unknown>) =>
    post("/__conformance/protected", { planId: "plan-p", ...body });
  await control({ operation: "create", rows, conversationId: conversation });
  const read = async (id = "plan-p") =>
    (await request(`/plans/${id}`)).body as PlanRecord;
  const plans = (
    overrides: Partial<NonNullable<ClientConfig["plans"]>> = {},
  ): NonNullable<ClientConfig["plans"]> => ({
    read: (id) => read(id),
    heartbeat: async (id, acceptance) => {
      const result = await post(`/plans/${id}/heartbeat`, acceptance ?? {});
      if (result.status !== 200) throw new Error("renewal refused");
    },
    request: async (canonical, context) => {
      const result = await request(canonical.path, {
        method: canonical.method,
        headers: {
          "Content-Type": "application/json",
          ...canonical.headers,
          ...context.headers,
        },
        body: canonical.body,
      });
      if (result.status >= 400) throw new Error("step refused");
    },
    intent: async (intent: IntentRequest) =>
      (await post(`/plans/${intent.planId}/safety-control`, intent))
        .body as PlanIntentReply,
    ...overrides,
  });
  const open = async (
    overrides: Partial<NonNullable<ClientConfig["plans"]>> = {},
    options: { stripAcceptance?: boolean } = {},
  ) => {
    // A host that acknowledges a confirmation without its private
    // acceptance, as a replay of the same command does.
    const transportRequest: HttpRequest = options.stripAcceptance
      ? async (path, init) => {
          const result = await request(path, init);
          if (path.endsWith("/replies") && result.body)
            delete (result.body as { acceptance?: unknown }).acceptance;
          return result;
        }
      : request;
    const client = createWaypointClient({
      accountId: "account-a",
      conversationId: conversation,
      platform,
      transport: createSseTransport(transportRequest, {
        subscribe: () => () => {},
      }),
      plans: plans(overrides),
    });
    await client.ready;
    client.setPlan(await read());
    return client;
  };
  return {
    host,
    request,
    post,
    control,
    read,
    open,
    calls,
    conversation,
    close: () => host.close(),
  };
}
export const until = async (
  check: () => boolean | Promise<boolean>,
  ms = 3000,
) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
type Host = Awaited<ReturnType<typeof protectedHost>>;
export const stopBody = (record: PlanRecord) => ({
  kind: "stop",
  planId: record.id,
  target: { type: "execution", id: record.recovery!.executionId },
  capturedRound: record.recovery!.round,
  expectedSlotVersion: record.recovery!.slots.stop,
  correlation: "stop-1",
  cause: "connection-lost",
});
// A two-step run accepted over HTTP: step a commits, then a Stop before
// step b runs, so b is remaining forward work.
export async function acceptedReadback(h: Host) {
  const record = await h.read();
  const accepted = (
    await h.post(`/conversations/${h.conversation}/replies`, {
      kind: "confirm",
      protocol: "1.0",
      clientReplyId: "confirm-keep",
      planId: "plan-p",
      digest: (record.plan as { digest: string }).digest,
      confirmationToken: record.confirmation?.token,
    })
  ).body as { acceptance: { executionId: string; fence: number } };
  await h.request("/protected-items/a", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Waypoint-Step": "plan-p.0",
      "Waypoint-Execution": accepted.acceptance.executionId,
      "Waypoint-Fence": String(accepted.acceptance.fence),
    },
    body: '{"title":"After"}',
  });
  await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
  return h.read();
}
