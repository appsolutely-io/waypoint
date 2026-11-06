import type { ConversationSource, ConversationSummary } from "./form-fill";
import type { Frame, Conversation, Reply } from "../protocol/generated";
import type { HttpRequest } from "../conformance/index";
import {
  ConversationReadError,
  type ReaderRequestContext,
  type TransportPort,
  type TransportEvent,
} from "./client";
/**
 * Decodes SSE or NDJSON text chunks into frames. Its code is loaded on
 * first use, outside the core bundle.
 */
export async function* decodeFrames(
  chunks: AsyncIterable<string>,
  format: "sse" | "ndjson",
): AsyncGenerator<Frame> {
  yield* (await import("./frame-decoder")).decodeFrames(chunks, format);
}
export interface StreamPort {
  subscribe(
    path: string,
    onChunk: (chunk: string) => void,
    onStatus: (
      status: "connecting" | "open" | "reconnecting" | "unavailable",
    ) => void,
  ): () => void;
}
export function createHttpTransport(
  request: HttpRequest,
  stream: StreamPort,
  format: "sse" | "ndjson" | "signals" = "sse",
): TransportPort {
  const binding = (context?: ReaderRequestContext): Record<string, string> =>
    context ? { "Waypoint-Agreement": context.agreementId } : {};
  const post = async (
    path: string,
    body: unknown,
    context?: ReaderRequestContext,
  ) => {
    const r = await request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...binding(context) },
      body: JSON.stringify(body),
    });
    if (r.status < 200 || r.status >= 300) throw r.body;
    return r.body;
  };
  return {
    // Negotiation never carries an old agreement.
    negotiate: async (supported, offer) => {
      const r = await request("/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "1.0",
          supported,
          ...(offer
            ? { offer: { capabilities: [...offer.capabilities] } }
            : {}),
        }),
      });
      if (r.status === 401) throw { code: "sign-in", id: "negotiation" };
      if (r.status < 200 || r.status >= 300) throw r.body;
      return r.body as {
        protocol: string;
        capabilities: string[];
        agreementId?: string;
      };
    },
    read: async (id, context) => {
      const r = await request(
        `/conversations/${encodeURIComponent(id)}`,
        context ? { headers: binding(context) } : undefined,
      );
      if (r.status !== 200)
        throw new ConversationReadError(id, r.status, r.body);
      return r.body as Conversation;
    },
    send: async (reply: Reply, id: string, context) =>
      (await post(
        `/conversations/${encodeURIComponent(id)}/${reply.kind === "message" ? "messages" : "replies"}`,
        reply,
        context,
      )) as { id: string },
    subscribe(id, listener, context) {
      let buffer = "";
      let data: string[] = [];
      const deliver = (text: string) => {
        try {
          const frame: Frame = JSON.parse(text);
          listener({ type: "frame", frame });
        } catch {
          listener({ type: "status", status: "unavailable" });
        }
      };
      // The agreement id is not a secret; the stream query carries it because
      // an EventSource cannot set request headers.
      return stream.subscribe(
        `/conversations/${encodeURIComponent(id)}/stream${
          context
            ? `?waypointAgreement=${encodeURIComponent(context.agreementId)}`
            : ""
        }`,
        (chunk) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end).replace(/\r$/, "");
            buffer = buffer.slice(end + 1);
            // A signal line only says something changed; its content is
            // never trusted or applied.
            if (format === "signals") {
              if (line.trim()) listener({ type: "invalidate" });
            } else if (format !== "sse") {
              if (line.trim()) deliver(line);
            } else if (line === "") {
              if (data.length) deliver(data.join("\n"));
              data = [];
            } else if (line.startsWith("data:"))
              data.push(line.slice(5).replace(/^ /, ""));
          }
        },
        (status) => {
          if (status === "reconnecting" || status === "open") {
            buffer = "";
            data = [];
          }
          listener({ type: "status", status });
        },
      );
    },
  };
}
export function createSignalTransport(
  request: HttpRequest,
  stream: StreamPort,
): TransportPort {
  return createHttpTransport(request, stream, "signals");
}
export function createSseTransport(
  request: HttpRequest,
  stream: StreamPort,
): TransportPort {
  return createHttpTransport(request, stream, "sse");
}
export function createFetchStreamTransport(
  request: HttpRequest,
  stream: StreamPort,
): TransportPort {
  return createHttpTransport(request, stream, "ndjson");
}
export type TransportListener = (event: TransportEvent) => void;
export function createHttpConversationSource(
  request: HttpRequest,
): ConversationSource {
  return {
    async list(subjectKey) {
      const result = await request(
        `/conversations${subjectKey ? `?subject=${encodeURIComponent(subjectKey)}` : ""}`,
      );
      if (result.status !== 200 || !Array.isArray(result.body))
        throw new Error("Conversation list unavailable");
      return result.body as ConversationSummary[];
    },
    async create(input) {
      const result = await request("/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (result.status < 200 || result.status >= 300) throw result.body;
      return result.body as Conversation;
    },
  };
}
