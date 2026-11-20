import { runFormFillConformance } from "./form-fill";
import { runPlanConformance } from "./plans";
import { namesAppliedAnswer } from "./card-answer";
import { authenticateSession, authFailure } from "./auth";
import type { Conversation, Problem } from "../protocol/generated";
import { SUPPORTED_PROTOCOLS } from "../protocol/index";
import type { ConformanceConfig, ConformanceResult, HttpResult } from "./index";
import {
  CAPABILITY_SCENARIOS,
  CONFORMANCE_CAPABILITIES,
  REPLY_STOP_SCENARIO,
} from "./scenarios";
// Loaded on first use by the conformance entry points, outside the core
// bundle.
export { runFormFillConformance, runPlanConformance };
export async function runConformance(
  config: ConformanceConfig,
): Promise<ConformanceResult> {
  const failures: string[] = [];
  const scenarios: string[] = [];
  const skipped: string[] = [];
  const offered = Object.keys(CAPABILITY_SCENARIOS).filter(
    (capability) =>
      config.profile !== "app-host" ||
      capability !== CONFORMANCE_CAPABILITIES.plans,
  );
  const withoutStop = offered.filter(
    (capability) => capability !== CONFORMANCE_CAPABILITIES.replyStop,
  );
  const enabled = (capability: string, peer: Peer) =>
    offered.includes(capability) && peer.capabilities.includes(capability);

  const session = await authenticateSession(config.request, config);
  if (!session) return authFailure();
  const { request, headers } = session;
  const post = (path: string, value: unknown) =>
    request(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ protocol: "1.0", ...(value as object) }),
    });
  const check = async (name: string, run: () => Promise<boolean>) => {
    scenarios.push(name);
    try {
      if (!(await run())) failures.push(name);
    } catch {
      failures.push(name);
    }
  };
  let peer: Peer | undefined;
  await check("negotiation", async () => {
    peer = negotiatedPeer(
      await post("/negotiate", {
        supported: SUPPORTED_PROTOCOLS,
        offer: { capabilities: offered },
      }),
    );
    return peer !== undefined;
  });
  if (!peer)
    return {
      passed: false,
      failures,
      scenarios,
      skipped: Object.values(CAPABILITY_SCENARIOS).flat(),
    };
  if (
    peer.protocol === "1.1" &&
    enabled(CONFORMANCE_CAPABILITIES.forms, peer)
  ) {
    const forms = await runFormFillConformance(config.request, config);
    failures.push(...forms.failures);
    scenarios.push(...forms.scenarios);
  } else skipped.push(...CAPABILITY_SCENARIOS[CONFORMANCE_CAPABILITIES.forms]);
  const created = await post("/conversations", { title: "Fixture" }).catch(
    () => undefined,
  );
  if (!created)
    return {
      passed: false,
      failures: [...failures, "conversation creation"],
      scenarios,
      skipped,
    };
  const id = (created.body as { id: string }).id;
  await check("optimistic replay", async () => {
    const value = { clientMessageId: "replay-a", content: "Request" };
    const first = await post(`/conversations/${id}/messages`, value);
    const next = await post(`/conversations/${id}/messages`, value);
    return (
      (first.body as { id: string }).id === (next.body as { id: string }).id
    );
  });
  await check("closed failures", async () => {
    for (const code of [
      "in-doubt",
      "replaced",
      "retryable",
      "refused",
      "closed",
      "full",
      "declined",
      "unavailable",
    ]) {
      await post("/__conformance/script", {
        turns: [{ problem: { id: "failure-a", code } }],
      });
      const r = await post(`/conversations/${id}/messages`, {
        clientMessageId: `failure-${code}`,
        content: "Request",
      });
      if (r.status < 400 || (r.body as Problem).code !== code) return false;
    }
    return true;
  });
  await check("blocks and fallback", async () => {
    const types = [
      "markdown",
      "card",
      "details",
      "list",
      "table",
      "form",
      "choice",
      "buttons",
      "diff",
      "plan",
      "route-link",
      "notice",
      "example/future",
    ];
    const blocks = types.map((type) => ({
      type,
      id: type,
      fallback: "Readable",
      body: bodyFor(type),
    }));
    await post("/__conformance/script", { turns: [{ blocks }] });
    await post(`/conversations/${id}/messages`, {
      clientMessageId: "blocks-a",
      content: "Request",
    });
    const read = await request(`/conversations/${id}`, { headers });
    const conversation = read.body as Conversation;
    return types.every((type) =>
      conversation.messages.some((message) =>
        message.blocks.some(
          (block) => block.type === type && block.fallback === "Readable",
        ),
      ),
    );
  });
  await check("drop then refetch", async () => {
    await post("/__conformance/script", {
      turns: [{ content: "Authoritative after drop" }],
    });
    await post(`/conversations/${id}/messages`, {
      clientMessageId: "drop-a",
      content: "Request",
    });
    await request(`/conversations/${id}/stream`, { headers });
    const read = await request(`/conversations/${id}`, { headers });
    return (read.body as Conversation).messages.some(
      (message) => message.content === "Authoritative after drop",
    );
  });
  await check("one answer per card", async () => {
    await post("/__conformance/script", {
      turns: [
        {
          // A card: the answer goes to a block nested in it.
          blocks: [
            {
              type: "card",
              id: "card-answer",
              fallback: "Answer",
              body: {
                title: "Question",
                blocks: [
                  {
                    type: "buttons",
                    id: "card-answer-choice",
                    fallback: "Answer",
                    body: {
                      actions: [
                        { id: "accept", label: "Accept" },
                        { id: "decline", label: "Decline" },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await post(`/conversations/${id}/messages`, {
      clientMessageId: "card-answer",
      content: "Request",
    });
    const answer = (clientReplyId: string, actionId: string) =>
      post(`/conversations/${id}/replies`, {
        kind: "action",
        clientReplyId,
        blockId: "card-answer-choice",
        actionId,
      });
    const refused = (r: { status: number; body: unknown }) =>
      r.status === 409 && (r.body as Problem).code === "refused";
    const first = await answer("card-answer-a", "accept");
    const replay = await answer("card-answer-a", "accept");
    // The same id with another body, and another answer under a new id.
    const changed = await answer("card-answer-a", "decline");
    const other = await answer("card-answer-b", "decline");
    const read = await request(`/conversations/${id}`, { headers });
    const card = (read.body as Conversation).messages
      .flatMap((message) => message.blocks)
      .find((block) => block.id === "card-answer");
    return (
      first.status >= 200 &&
      first.status < 300 &&
      replay.status === first.status &&
      JSON.stringify(replay.body) === JSON.stringify(first.body) &&
      // The Idempotency-Key draft's 422 for a changed body also holds.
      (refused(changed) || changed.status === 422) &&
      refused(other) &&
      card?.answered === true &&
      // An answer the host names is optional, and the one it applied: the
      // fields `CardAnswer` requires of an action, in any key order, beside
      // any others the schema allows.
      namesAppliedAnswer(card.answer)
    );
  });
  await check("agreement binding", async () => {
    const bound = await post("/negotiate", {
      supported: SUPPORTED_PROTOCOLS,
      offer: { capabilities: withoutStop },
    });
    const answer = bound.body as { agreementId?: unknown };
    // A host that issues no agreement is a legacy host for this check.
    if (bound.status === 200 && answer.agreementId === undefined) return true;
    if (bound.status !== 200 || typeof answer.agreementId !== "string")
      return false;
    const unknown = { ...headers, "Waypoint-Agreement": "conformance-unknown" };
    const read = await request(`/conversations/${id}`, {
      headers: unknown,
    });
    const refused = await request(`/conversations/${id}/messages`, {
      method: "POST",
      headers: unknown,
      body: JSON.stringify({
        protocol: "1.0",
        clientMessageId: "binding-a",
        content: "Request",
      }),
    });
    const after = await request(`/conversations/${id}`, { headers });
    const valid = await request(`/conversations/${id}`, {
      headers: { ...headers, "Waypoint-Agreement": answer.agreementId },
    });
    return (
      read.status === 409 &&
      (read.body as Problem).code === "agreement-expired" &&
      refused.status === 409 &&
      (refused.body as Problem).code === "agreement-expired" &&
      !(after.body as Conversation).messages.some(
        (message) => message.clientMessageId === "binding-a",
      ) &&
      valid.status === 200
    );
  });
  await check("agreement keeps its answer", async () => {
    const first = await post("/negotiate", {
      supported: ["1.0"],
      offer: { capabilities: withoutStop },
    });
    const second = await post("/negotiate", {
      supported: SUPPORTED_PROTOCOLS,
      offer: { capabilities: withoutStop },
    });
    const a = first.body as { agreementId?: string; protocol?: string };
    const b = second.body as { agreementId?: string; protocol?: string };
    // Legacy hosts, and hosts whose answers cannot differ, have nothing to
    // compare.
    if (!a.agreementId || !b.agreementId || a.protocol === b.protocol)
      return true;
    const read = await request(`/conversations/${id}`, {
      headers: { ...headers, "Waypoint-Agreement": a.agreementId },
    });
    return (
      read.status === 200 && (read.body as Conversation).protocol === a.protocol
    );
  });
  const stopPeer = await post("/negotiate", {
    supported: SUPPORTED_PROTOCOLS,
    offer: { capabilities: [CONFORMANCE_CAPABILITIES.replyStop] },
  });
  const stopAnswer = negotiatedPeer(stopPeer);
  if (stopAnswer && enabled(CONFORMANCE_CAPABILITIES.replyStop, stopAnswer))
    await check(REPLY_STOP_SCENARIO, async () => {
      // A reply left being written, as the script asks.
      await post("/__conformance/script", {
        turns: [{ chunks: ["Partial answer"], interval: 0, ending: "held" }],
      });
      await post(`/conversations/${id}/messages`, {
        clientMessageId: "stop-a",
        content: "Request",
      });
      // Read as the client that negotiated reply-stop, or as one that did
      // not.
      const as = (agreementId?: string) =>
        agreementId
          ? { ...headers, "Waypoint-Agreement": agreementId }
          : headers;
      const stopAgreement = (stopPeer.body as { agreementId?: string })
        .agreementId;
      const read = async (agreementId = stopAgreement) =>
        (
          (
            await request(`/conversations/${id}`, {
              headers: as(agreementId),
            })
          ).body as Conversation
        ).messages.at(-1);
      // Read again, a bounded number of times, until the pieces arrived.
      let reply = await read();
      for (
        let tries = 0;
        reply?.content !== "Partial answer" && tries < 100;
        tries++
      )
        reply = await read();
      // Only a host that issues agreements can tell which clients
      // negotiated reply-stop.
      if (
        !stopAgreement ||
        reply?.role !== "assistant" ||
        reply.status !== "writing"
      )
        return false;
      const version = reply.versionIndex ?? 1;
      // A stop of another version, as one that arrives late does, leaves
      // the version being written alone.
      const other = await post(`/conversations/${id}/replies`, {
        kind: "stop",
        clientReplyId: "stop-a-other-version",
        messageId: reply.id,
        versionIndex: version + 1,
      });
      const untouched = await read();
      const stop = {
        kind: "stop",
        clientReplyId: "stop-a-reply",
        messageId: reply.id,
        versionIndex: version,
      };
      const first = await post(`/conversations/${id}/replies`, stop);
      const replay = await post(`/conversations/${id}/replies`, stop);
      // Each version of a reply is stopped with its own id: a new stop of
      // the same message is a new request, accepted, changing nothing once
      // the message has ended. This one names no version: it is for the
      // version being written when it arrives.
      const again = await post(`/conversations/${id}/replies`, {
        kind: "stop",
        clientReplyId: "stop-a-reply-2",
        messageId: reply.id,
      });
      const after = await read();
      // A client that did not negotiate reply-stop never sees `stopped`: it
      // sees `failed`, with the text kept. Told apart only by agreement.
      const plain = (
        (await post("/negotiate", {
          supported: SUPPORTED_PROTOCOLS,
          offer: { capabilities: withoutStop },
        })) as { body: { agreementId?: string } }
      ).body.agreementId;
      const older = plain ? await read(plain) : undefined;
      return (
        other.status < 500 &&
        untouched?.status === "writing" &&
        (!older ||
          (older.status === "failed" && older.content === "Partial answer")) &&
        first.status >= 200 &&
        first.status < 300 &&
        replay.status === first.status &&
        JSON.stringify(replay.body) === JSON.stringify(first.body) &&
        again.status >= 200 &&
        again.status < 300 &&
        after?.id === reply.id &&
        after.status === "stopped" &&
        after.content === "Partial answer"
      );
    });
  else
    skipped.push(...CAPABILITY_SCENARIOS[CONFORMANCE_CAPABILITIES.replyStop]);
  if (enabled(CONFORMANCE_CAPABILITIES.plans, peer)) {
    const plans = await runPlanConformance(config.request, config);
    failures.push(...plans.failures);
    scenarios.push(...plans.scenarios);
  } else skipped.push(...CAPABILITY_SCENARIOS[CONFORMANCE_CAPABILITIES.plans]);
  return { passed: failures.length === 0, failures, scenarios, skipped };
}
function bodyFor(type: string): unknown {
  const bodies: Record<string, unknown> = {
    markdown: { text: "Readable" },
    card: { title: "Card", blocks: [] },
    details: { summary: "Details", blocks: [] },
    list: { items: [] },
    table: { columns: [], rows: [] },
    form: { fields: [] },
    choice: { mode: "single", options: [] },
    buttons: { actions: [] },
    diff: { before: "Before", after: "After" },
    plan: { planId: "plan-a" },
    "route-link": { label: "View", route: "/items/a" },
    notice: { text: "Ready" },
  };
  return bodies[type] ?? {};
}

interface Peer {
  protocol: string;
  capabilities: string[];
}
function negotiatedPeer(result: HttpResult): Peer | undefined {
  if (result.status !== 200 || !result.body || typeof result.body !== "object")
    return;
  const peer = result.body as Partial<Peer>;
  if (
    !SUPPORTED_PROTOCOLS.some((protocol) => protocol === peer.protocol) ||
    !Array.isArray(peer.capabilities) ||
    !peer.capabilities.every((capability) => typeof capability === "string")
  )
    return;
  return { protocol: peer.protocol!, capabilities: peer.capabilities };
}
