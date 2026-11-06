import type {
  Conversation,
  CreateConversation,
  ReplyFormFill,
  FormFillValue,
} from "../../src/protocol/generated";
import type { HttpResult } from "../../src/conformance/index";
export type FormFault =
  | "form-mode"
  | "form-fields"
  | "form-parent"
  | "form-dedupe"
  | "form-filter"
  | "form-general";
export function createFormFixture(fault?: string) {
  const records = new Map<string, Conversation>();
  const created = new Map<string, string>();
  const replies = new Map<string, string>();
  let serial = 0;
  return {
    list: () => [...records.values()],
    handle(
      path: string,
      method: string,
      body: Record<string, unknown>,
    ): HttpResult | undefined {
      const url = new URL(path, "https://example.test");
      if (
        url.pathname === "/conversations" &&
        method === "GET" &&
        url.searchParams.has("subject")
      ) {
        const key = url.searchParams.get("subject");
        return {
          status: 200,
          body: [...records.values()].filter(
            (item) => fault === "form-filter" || item.subject?.key === key,
          ),
        };
      }
      if (
        path === "/conversations" &&
        method === "POST" &&
        body.mode === "form-fill"
      ) {
        const input = body as unknown as CreateConversation;
        if (
          input.protocol !== "1.1" ||
          !input.subject ||
          !input.clientCreationId
        )
          return { status: 400, body: {} };
        const parent = input.parentConversationId
          ? records.get(input.parentConversationId)
          : undefined;
        if (
          input.parentConversationId &&
          fault !== "form-parent" &&
          (!parent ||
            parent.subject?.key !== input.subject.key ||
            parent.mode !== "form-fill" ||
            !input.field)
        )
          return { status: 400, body: {} };
        const prior = created.get(input.clientCreationId);
        if (prior && fault !== "form-dedupe")
          return { status: 200, body: records.get(prior) };
        const id = `form-${++serial}`;
        const value: Conversation = {
          protocol: "1.1",
          id,
          title: input.title,
          messages: [],
          mode: "form-fill",
          subject: parent?.subject ?? input.subject,
          ...(input.parentConversationId
            ? {
                parentConversationId: input.parentConversationId,
                field: input.field,
              }
            : {}),
        };
        records.set(id, value);
        created.set(input.clientCreationId, id);
        return { status: 201, body: value };
      }
      const match =
        /^\/conversations\/([^/]+)(?:\/(replies|messages|stream))?$/.exec(path);
      const conversation = match && records.get(decodeURIComponent(match[1]!));
      if (!conversation) return;
      if (
        fault === "form-general" &&
        match?.[2] === "messages" &&
        body.kind === "message"
      )
        return { status: 200, body: { id: "accepted-general" } };
      if (method === "GET")
        return {
          status: 200,
          body:
            fault === "form-mode"
              ? { ...conversation, mode: undefined }
              : conversation,
        };
      if (match?.[2] !== "replies" || body.kind !== "form-fill")
        return { status: 400, body: { code: "refused", id: "form-reply" } };
      const reply = body as unknown as ReplyFormFill;
      if (
        !reply.request ||
        !Array.isArray(reply.request.fields) ||
        !reply.request.fields.length ||
        reply.request.fields.some((field) => field.tier !== "low") ||
        (conversation.field &&
          reply.request.fields.some(
            (field) => field.name !== conversation.field,
          ))
      )
        return { status: 400, body: {} };
      const key = JSON.stringify([conversation.id, reply.clientReplyId]);
      if (replies.has(key))
        return { status: 200, body: { id: replies.get(key) } };
      const values: Record<string, FormFillValue> = Object.fromEntries(
        reply.request.fields.map((field) => [
          field.name,
          {
            label: field.label,
            value: `Draft ${field.label}`,
            validation: {
              status: "invalid",
              messages: ["Review the draft"],
              guidance: "Keep the complete value",
            },
          },
        ]),
      );
      if (fault === "form-fields")
        values.undeclared = {
          value: "Unexpected",
          validation: { status: "valid", messages: [] },
        };
      const id = `form-reply-${++serial}`;
      conversation.messages.push({
        id,
        role: "assistant",
        content: "Draft",
        createdAt: 0,
        blocks: [
          {
            type: "form.fill",
            id,
            fallback: "Draft values",
            body: { requestId: reply.request.requestId, values },
          },
        ],
      });
      replies.set(key, id);
      return { status: 200, body: { id } };
    },
  };
}
