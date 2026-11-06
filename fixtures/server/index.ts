import { negotiate } from "../../src/protocol/index";
import { createFormFixture, type FormFault } from "./form-fill";
import { createPlanFixture } from "./plans";
import { createProtectedFixture } from "./protected";
import { MAX_INTENT_BODY_BYTES } from "../../src/host/plan-intents";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  Block,
  Conversation,
  Message,
  Problem,
  Source,
  ToolCall,
} from "../../src/protocol/generated";
export interface FixtureTurn {
  content?: string;
  blocks?: Block[];
  problem?: Problem;
  /**
   * The reply streams in: these pieces arrive as text deltas on the
   * conversation's event stream, `interval` ms apart, after the message is
   * accepted. `content` is ignored for a streamed reply.
   */
  chunks?: string[];
  interval?: number;
  /**
   * How a streamed reply ends: `failed` and `unavailable` say so on the
   * conversation, `message-failed` ends the message itself as failed, and
   * `held` leaves it being written.
   */
  ending?: "completed" | "failed" | "unavailable" | "message-failed" | "held";
  /**
   * Reads the reply asks the client for (tool calls) before its text, each
   * `toolTime` ms after the previous.
   */
  tools?: ToolCall[];
  toolTime?: number;
  /** What the reply drew on, which `[n]` in its text cites. */
  sources?: Source[];
  /** Accept the message and never start a reply. */
  silent?: boolean;
  /** The accepted message was asked this many ms ago. */
  askedAgo?: number;
}
export type FixtureFault =
  | "version"
  | "dedupe"
  | "failure"
  | "fallback"
  | "refetch"
  | "binding"
  | "shared-answer"
  | "second-answer"
  // Names another answer than the one it applied in the card's `answer`.
  | "wrong-answer"
  // Names the card's `answer` as something other than an answer object.
  | "malformed-answer"
  // Names the card's `answer` as null.
  | "null-answer"
  // Names the applied answer with its keys in another order (as Postgres
  // `jsonb` stores them): still a conforming host.
  | "reordered-answer"
  // Names the applied answer with a field the schema allows besides its
  // own: still a conforming host.
  | "extended-answer"
  // Answers the same reply id with another body with 422, as the
  // Idempotency-Key draft does: still a conforming host.
  | "changed-422"
  // Accepts a stop and keeps writing the reply.
  | "ignores-stop"
  // Stops the reply and drops the text it had written.
  | "loses-stopped-text"
  // Does not offer reply-stop.
  | "no-stop"
  // Takes one stop per message: a stop with a new id is refused.
  | "stops-once-per-message"
  // Sends `stopped` to clients that did not negotiate reply-stop.
  | "stopped-to-all"
  // Stops the version being written whatever version a stop names.
  | "stops-any-version"
  // Offers reply-stop without issuing agreements.
  | "stops-without-agreements"
  | FormFault;
export async function createFixtureServer(options: {
  testMode: boolean;
  protocol?: "1.0" | "1.1";
  fault?: FixtureFault;
}) {
  let turns: FixtureTurn[] = [];
  let next = 0;
  let protocol = "1.0";
  const plans = createPlanFixture();
  const protectedPlans = createProtectedFixture();
  const forms = createFormFixture(options.fault);
  const conversations = new Map<string, Conversation>();
  // Applied card answers by conversation and reply id, with their body.
  const replies = new Map<string, { body: string; result: { id: string } }>();
  // Messages a stop has reached, for the one-stop-per-message fault.
  const stoppedMessages = new Set<string>();
  // Each agreement keeps the answer it was issued with.
  const agreements = new Map<string, { protocol: string; stops: boolean }>();
  // What a client that did not negotiate reply-stop is sent for a stopped
  // message: `failed`, a status it knows and never shows as finished.
  const asStopped = (stops: boolean | undefined) =>
    stops === false && options.fault !== "stopped-to-all"
      ? (status: string | undefined) =>
          status === "stopped" ? "failed" : status
      : (status: string | undefined) => status;
  // Live event streams and the agreement each was opened under; ending an
  // agreement ends its streams without waiting for another request.
  const streams = new Set<{ agreement: string | undefined; end(): void }>();
  const endStreams = (ended: (agreement: string | undefined) => boolean) => {
    for (const stream of [...streams])
      if (ended(stream.agreement)) {
        streams.delete(stream);
        stream.end();
      }
  };
  let issued = 0;
  // Live event streams by conversation, and the timers of replies still
  // streaming in, so closing the server stops them.
  const live = new Map<string, Set<(frame: object) => void>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // Replies still streaming in, by message id: each stops its own stream.
  const writing = new Map<string, () => void>();
  let sequence = 1;
  const publish = (conversationId: string, frame: object) => {
    const body = { protocol: protocol, sequence: ++sequence, ...frame };
    for (const write of live.get(conversationId) ?? []) write(body);
  };
  // Streams a scripted reply into a stored assistant message.
  const stream = (
    conversation: Conversation,
    message: Message,
    turn: FixtureTurn,
  ) => {
    const pieces = [...(turn.chunks ?? [])];
    const tools = [...(turn.tools ?? [])];
    let timer: ReturnType<typeof setTimeout> | undefined;
    writing.set(message.id, () => {
      if (timer) {
        clearTimeout(timer);
        timers.delete(timer);
      }
      writing.delete(message.id);
    });
    const step = (at: number, delay = turn.interval ?? 120) => {
      timer = setTimeout(() => {
        timers.delete(timer!);
        if (at === 0)
          publish(conversation.id, {
            type: "message.start",
            messageId: message.id,
            role: "assistant",
          });
        const call = tools.shift();
        if (call) {
          publish(conversation.id, { type: "tool.call", call });
          return step(at + 1, turn.toolTime ?? 900);
        }
        const text = pieces.shift();
        if (text !== undefined) {
          message.content += text;
          publish(conversation.id, {
            type: "text.delta",
            messageId: message.id,
            text,
          });
          return step(at + 1);
        }
        if (turn.ending === "held") return;
        writing.delete(message.id);
        // A host that loses a reply says so on the conversation, which the
        // next read carries; the reply itself is never finished.
        if (turn.ending === "failed" || turn.ending === "unavailable") {
          conversation.replyStatus = turn.ending;
          publish(conversation.id, { type: "stale", reads: ["conversation"] });
          return;
        }
        const status =
          turn.ending === "message-failed" ? "failed" : "completed";
        message.status = status;
        publish(conversation.id, {
          type: "message.end",
          messageId: message.id,
          status,
        });
      }, delay);
      timers.add(timer);
    };
    step(0);
  };
  const server = createServer((req, res) => {
    // A rejected handler answers a fixed error instead of escaping.
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ code: "unavailable", id: "host" }));
      }
    });
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Content-Type", "application/json");
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://fixture.invalid");
    const queryAgreement = url.searchParams.get("waypointAgreement");
    url.searchParams.delete("waypointAgreement");
    const path = url.pathname + url.search;
    if (path.startsWith("/__conformance/") && !options.testMode) {
      send(404, {});
      return;
    }
    if (url.pathname === "/__conformance/session") {
      // Test mode can issue a session for another principal.
      const other = url.searchParams.get("principal");
      const session =
        other && /^[a-z0-9-]{1,32}$/.test(other)
          ? `fixture-session.${other}`
          : "fixture-session";
      res.setHeader(
        "Set-Cookie",
        `waypoint=${session}; Path=/; HttpOnly; SameSite=Strict`,
      );
      send(200, {
        session,
        csrf: "fixture-csrf",
        factor: "fixture-only",
      });
      return;
    }
    const cookie = /^waypoint=fixture-session(?:\.([a-z0-9-]{1,32}))?$/.exec(
      req.headers.cookie ?? "",
    );
    if (!cookie || (cookie[1] && !options.testMode)) {
      send(401, { protocol: "1.0", id: "sign-in", code: "sign-in" });
      return;
    }
    const principal = cookie[1] ?? "owner";
    if (
      req.method !== "GET" &&
      req.headers["x-csrf-token"] !== "fixture-csrf"
    ) {
      send(403, {});
      return;
    }
    let body: Record<string, unknown>;
    try {
      // The bound applies while the body streams in, before any parsing.
      body = await readBody(
        req,
        /^\/plans\/[^/]+\/safety-control$/.test(url.pathname)
          ? MAX_INTENT_BODY_BYTES
          : MAX_BODY_BYTES,
      );
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        res.setHeader("Connection", "close");
        send(413, { code: "refused", id: "body-too-large" });
        return;
      }
      send(400, { code: "refused", id: "invalid-json" });
      return;
    }
    if (path === "/__conformance/agreements") {
      if (body.operation === "reset") {
        agreements.clear();
        endStreams((agreement) => agreement !== undefined);
      }
      send(body.operation === "reset" ? 200 : 400, {});
      return;
    }
    let answered = protocol;
    // Whether the presented agreement includes reply-stop; a request under
    // no agreement is not told apart.
    let stops: boolean | undefined;
    // Terminal intents never depend on an agreement: an expired one cannot
    // block a Stop or Cancel of an already provisioned protected plan.
    const safetyControl = /^\/plans\/[^/]+\/safety-control$/.test(path);
    if (
      !path.startsWith("/__conformance/") &&
      path !== "/negotiate" &&
      !safetyControl
    ) {
      const header = req.headers["waypoint-agreement"];
      const presented =
        (Array.isArray(header) ? header[0] : header) ?? queryAgreement;
      if (
        presented !== null &&
        presented !== undefined &&
        (!/^[A-Za-z0-9._~-]{1,128}$/.test(presented) ||
          (queryAgreement !== null &&
            header !== undefined &&
            queryAgreement !== presented))
      ) {
        send(400, { protocol, code: "refused", id: "agreement" });
        return;
      }
      if (
        presented !== null &&
        presented !== undefined &&
        !agreements.has(presented) &&
        options.fault !== "binding"
      ) {
        send(409, { protocol, code: "agreement-expired", id: "agreement" });
        return;
      }
      const bound = presented ? agreements.get(presented) : undefined;
      if (bound && options.fault !== "shared-answer") answered = bound.protocol;
      stops = bound?.stops;
    }
    if (path === "/__conformance/script") {
      turns = (body.turns as FixtureTurn[] | undefined) ?? [];
      if (body.planScenario)
        plans.reset(
          body.planScenario === "refuse",
          body.planScenario === "timed",
        );
      send(200, {});
      return;
    }
    const protectedReply = await protectedPlans.handle(
      path,
      req.method ?? "GET",
      body,
      { principal },
      Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value[0] : value,
        ]),
      ),
    );
    if (protectedReply) {
      if (protectedReply.raw !== undefined) {
        res.statusCode = protectedReply.status;
        res.end(protectedReply.raw);
      } else send(protectedReply.status, protectedReply.body);
      return;
    }
    const formReply = forms.handle(path, req.method ?? "GET", body);
    if (formReply) {
      send(formReply.status, formReply.body);
      return;
    }
    const planReply = plans.handle(
      path,
      req.method ?? "GET",
      body,
      Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value[0] : value,
        ]),
      ),
    );
    if (planReply) {
      send(planReply.status, planReply.body);
      return;
    }
    if (path === "/negotiate") {
      const supported = Array.isArray(body.supported)
        ? (body.supported as string[])
        : [];
      try {
        const offer =
          typeof body.offer === "object" &&
          body.offer !== null &&
          Array.isArray((body.offer as { capabilities?: unknown }).capabilities)
            ? (body.offer as { capabilities: string[] })
            : undefined;
        const answer = negotiate(
          options.protocol === "1.0"
            ? supported.filter((value) => value === "1.0")
            : supported,
          [
            "plans",
            "flows",
            "widgets",
            "form-fill",
            "plan-recovery",
            "plan-leave",
            "plan-keep",
            ...(options.fault === "no-stop" ? [] : ["reply-stop"]),
          ],
          offer,
        );
        protocol = answer.protocol;
        const agreementId =
          offer && options.fault !== "stops-without-agreements"
            ? `agreement-${++issued}`
            : undefined;
        if (agreementId)
          agreements.set(agreementId, {
            protocol: answer.protocol,
            stops: answer.capabilities.includes("reply-stop"),
          });
        send(200, {
          ...answer,
          ...(agreementId ? { agreementId } : {}),
          protocol: options.fault === "version" ? "9.0" : protocol,
        });
      } catch {
        send(409, { protocol, code: "update-required", id: "version" });
      }
      return;
    }
    if (path === "/conversations" && req.method === "POST") {
      const id = `conversation-${++next}`;
      const conversation: Conversation = {
        protocol: answered,
        id,
        title: String(body.title ?? ""),
        messages: [],
      };
      conversations.set(id, conversation);
      send(201, conversation);
      return;
    }
    if (path === "/conversations") {
      send(200, [...conversations.values(), ...forms.list()]);
      return;
    }
    const match =
      /^\/conversations\/([^/]+)(?:\/(messages|stream|replies))?$/.exec(path);
    const conversation = match?.[1] ? conversations.get(match[1]) : undefined;
    if (!conversation) {
      send(404, {});
      return;
    }
    if (match?.[2] === "stream" && req.headers.accept === "text/event-stream") {
      const header = req.headers["waypoint-agreement"];
      const agreement =
        (Array.isArray(header) ? header[0] : header) ??
        queryAgreement ??
        undefined;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      res.write(
        `data: ${JSON.stringify({ protocol: answered, sequence: 1, type: "stale", reads: ["conversation"] })}\n\n`,
      );
      const status = asStopped(
        agreement ? agreements.get(agreement)?.stops : undefined,
      );
      const write = (frame: object) =>
        res.write(
          `data: ${JSON.stringify(
            (frame as { type?: string }).type === "message.end"
              ? {
                  ...frame,
                  status: status((frame as { status?: string }).status),
                }
              : frame,
          )}\n\n`,
        );
      let writers = live.get(conversation.id);
      if (!writers) live.set(conversation.id, (writers = new Set()));
      writers.add(write);
      const stream = { agreement, end: () => res.end() };
      streams.add(stream);
      req.on("close", () => {
        streams.delete(stream);
        writers.delete(write);
      });
      return;
    }
    if (match?.[2] === "stream") {
      send(200, {
        protocol: answered,
        sequence: 1,
        type: "stale",
        reads: ["conversation"],
      });
      return;
    }
    if (match?.[2] === "messages") {
      const stored = conversation.messages.find(
        (m) => m.clientMessageId === body.clientMessageId,
      );
      if (stored && options.fault !== "dedupe") {
        send(200, stored);
        return;
      }
      const turn = turns.shift();
      if (turn?.problem) {
        send(
          409,
          options.fault === "failure"
            ? { ...turn.problem, code: "other" }
            : turn.problem,
        );
        return;
      }
      const message: Message = {
        id: `message-${++next}`,
        role: "user",
        clientMessageId: String(body.clientMessageId),
        content: String(body.content),
        blocks: [],
        createdAt: Date.now() - (turn?.askedAgo ?? 0),
      };
      conversation.messages.push(message);
      if (turn?.chunks && options.fault !== "refetch") {
        const answer: Message = {
          id: `message-${++next}`,
          role: "assistant",
          content: "",
          blocks: turn.blocks ?? [],
          createdAt: Date.now(),
          status: "writing",
          ...(turn.sources && { sources: turn.sources }),
        };
        conversation.messages.push(answer);
        delete conversation.replyStatus;
        stream(conversation, answer, turn);
      } else if (turn && !turn.silent && options.fault !== "refetch")
        conversation.messages.push({
          id: `message-${++next}`,
          role: "assistant",
          content: turn.content ?? "",
          blocks:
            options.fault === "fallback"
              ? (turn.blocks ?? []).map((b) => ({ ...b, fallback: "" }))
              : (turn.blocks ?? []),
          createdAt: Date.now(),
        });
      send(200, message);
      return;
    }
    if (match?.[2] === "replies" && body.kind === "stop") {
      // A stop ends the reply being written as stopped and keeps its text;
      // a replay, a stop of a reply that already ended, or a stop of
      // another version of it, changes nothing.
      const key = JSON.stringify([conversation.id, body.clientReplyId]);
      const seen = replies.get(key);
      if (seen) {
        send(200, seen.result);
        return;
      }
      if (
        options.fault === "stops-once-per-message" &&
        stoppedMessages.has(String(body.messageId))
      ) {
        send(409, { id: String(body.clientReplyId), code: "refused" });
        return;
      }
      stoppedMessages.add(String(body.messageId));
      const message = conversation.messages.find(
        (item) => item.id === body.messageId && item.role === "assistant",
      );
      if (!message || options.fault === "no-stop") {
        send(409, { id: String(body.clientReplyId), code: "refused" });
        return;
      }
      const named =
        body.versionIndex === undefined ||
        body.versionIndex === (message.versionIndex ?? 1) ||
        options.fault === "stops-any-version";
      if (
        message.status === "writing" &&
        named &&
        options.fault !== "ignores-stop"
      ) {
        writing.get(message.id)?.();
        message.status = "stopped";
        if (options.fault === "loses-stopped-text") message.content = "";
        publish(conversation.id, {
          type: "message.end",
          messageId: message.id,
          status: "stopped",
        });
      }
      replies.set(key, {
        body: JSON.stringify(body),
        result: { id: `reply-${++next}` },
      });
      send(200, replies.get(key)!.result);
      return;
    }
    if (match?.[2] === "replies") {
      // One answer per card, a message's block with the blocks nested in
      // it: a replay of the applied request gets its first response; the
      // same id with another body, or another answer to an answered card,
      // is refused and changes nothing.
      const key = JSON.stringify([conversation.id, body.clientReplyId]);
      const text = JSON.stringify(body);
      const seen = replies.get(key);
      const card = conversation.messages
        .flatMap((message) => message.blocks)
        .find((block) => holds(block, String(body.blockId)));
      if (seen && seen.body !== text && options.fault === "changed-422") {
        send(422, { id: String(body.clientReplyId), code: "invalid" });
        return;
      }
      if (
        seen
          ? seen.body !== text
          : card?.answered && options.fault !== "second-answer"
      ) {
        send(409, { id: String(body.clientReplyId), code: "refused" });
        return;
      }
      if (!seen) {
        if (card) {
          const answer = { ...body };
          delete answer.protocol;
          // Every reader sees `answer`: a form's values stay out of it.
          delete answer.values;
          card.answered = true;
          const faults: Record<string, unknown> = {
            "wrong-answer": { ...answer, actionId: "other" },
            "malformed-answer": "accept",
            "null-answer": null,
            "reordered-answer": Object.fromEntries(
              Object.entries(answer).reverse(),
            ),
            "extended-answer": { ...answer, appliedAt: 1 },
          };
          // A fault's answer may be null, so it is looked up by key.
          card.answer = (
            options.fault && options.fault in faults
              ? faults[options.fault]
              : answer
          ) as Block["answer"];
        }
        replies.set(key, { body: text, result: { id: `reply-${++next}` } });
      }
      send(200, replies.get(key)!.result);
      return;
    }
    const status = asStopped(stops);
    send(200, {
      ...conversation,
      protocol: answered,
      messages: conversation.messages.map((message) =>
        message.status === "stopped"
          ? { ...message, status: status(message.status) }
          : message,
      ),
    });
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        endStreams(() => true);
        protectedPlans.dispose();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
// Whether a message's block is, or holds, the block a reply answers.
const holds = (block: Block, id: string): boolean =>
  block.id === id ||
  ((block.body as { blocks?: Block[] } | null)?.blocks ?? []).some((child) =>
    holds(child, id),
  );
// Any other route's body limit in the reference host.
const MAX_BODY_BYTES = 1048576;
class BodyTooLarge extends Error {}
// Reads a body up to `limit` bytes. A declared length over the limit is
// refused before reading; a streamed body is refused as soon as it crosses
// the limit, without waiting for its end or keeping the excess.
function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.pause();
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.off("data", onData);
        req.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("error", reject);
    req.on("end", () => {
      if (size > limit) return;
      try {
        // Decoded once, so a character split across chunks stays whole.
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}
