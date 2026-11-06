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
} from "../../src/protocol/generated";
export interface FixtureTurn {
  content?: string;
  blocks?: Block[];
  problem?: Problem;
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
  // Each agreement keeps the answer it was issued with.
  const agreements = new Map<string, { protocol: string }>();
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
          ],
          offer,
        );
        protocol = answer.protocol;
        const agreementId = offer ? `agreement-${++issued}` : undefined;
        if (agreementId)
          agreements.set(agreementId, { protocol: answer.protocol });
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
      const stream = { agreement, end: () => res.end() };
      streams.add(stream);
      req.on("close", () => streams.delete(stream));
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
        createdAt: Date.now(),
      };
      conversation.messages.push(message);
      if (turn && options.fault !== "refetch")
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
    if (match?.[2] === "replies") {
      // One answer per card: a replay of the applied request gets its
      // first response; the same id with another body, or another answer
      // to an answered card, is refused and changes nothing.
      const key = JSON.stringify([conversation.id, body.clientReplyId]);
      const text = JSON.stringify(body);
      const seen = replies.get(key);
      const card = conversation.messages
        .flatMap((message) => message.blocks)
        .find((block) => block.id === body.blockId);
      if (
        seen
          ? seen.body !== text
          : card?.answered && options.fault !== "second-answer"
      ) {
        send(409, { id: String(body.clientReplyId), code: "refused" });
        return;
      }
      if (!seen) {
        if (card) card.answered = true;
        replies.set(key, { body: text, result: { id: `reply-${++next}` } });
      }
      send(200, replies.get(key)!.result);
      return;
    }
    send(200, { ...conversation, protocol: answered });
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        endStreams(() => true);
        protectedPlans.dispose();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
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
