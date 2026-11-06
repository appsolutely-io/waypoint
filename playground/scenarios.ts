import {
  createWaypointClient,
  createHttpTransport,
  createHttpConversationSource,
  type FlowTab,
} from "../src/index";
import { createFormSession } from "../src/core/form-session";
import type { HttpRequest } from "../src/conformance/index";
import type { Conversation, Flow } from "../src/protocol/generated";
import type { View } from "./state";
import type { FixtureTurn } from "../fixtures/server/index";

import { translatePreview } from "./copy";
import { localizeConversation, localizeForm } from "./localize";
import {
  STATE_TITLE,
  defaultTurn,
  manifest,
  stateQuestion,
  statePlan,
  stateFailedPlan,
  stateTurn,
} from "./reply-states";

export async function createPreview(
  scenario: View["scenario"],
  language: View["lang"] = "en",
  replyState: View["state"] = "idle",
) {
  let locale = language;
  const response = await fetch("/api/__conformance/session", {
    method: "POST",
  });
  if (!response.ok) throw new Error("Preview unavailable");
  const session = (await response.json()) as { csrf: string };
  const request: HttpRequest = async (path, init = {}) => {
    const result = await fetch("/api" + path, {
      ...init,
      headers: { ...init.headers, "X-CSRF-Token": session.csrf },
    });
    return { status: result.status, body: await result.json() };
  };
  const baseSource = createHttpConversationSource(request);
  // A reply state opens a conversation of its own on every load; only the
  // one shown is listed.
  const staged = scenario === "chat" && replyState !== "idle";
  const source = {
    list: async (key?: string) =>
      (await baseSource.list(key))
        .filter(
          (item) => item.title !== STATE_TITLE || item.id === conversation.id,
        )
        .map((item) => ({
          ...item,
          title: translatePreview(item.title, locale),
        })),
    create: baseSource.create,
  };
  const form =
    scenario === "form-fill"
      ? localizeForm(
          createFormSession({
            fields: [
              { name: "title", label: "Title", tier: "low", value: "" },
              { name: "summary", label: "Summary", tier: "low", value: "" },
            ],
            ids: () => crypto.randomUUID(),
          }),
          () => locale,
        )
      : undefined;
  const subject = {
    key: "playground-form",
    resource: "items",
    label: "Item",
    route: "/",
    state: "pending" as const,
  };
  const titles = {
    chat: "Local preview",
    flows: "Saved requests",
    transcript: "A longer conversation",
    "form-fill": "Draft an item",
  };
  let conversation: { id: string };
  if (form) {
    conversation = await source.create({
      protocol: "1.1",
      clientCreationId: "playground-form",
      title: titles[scenario],
      mode: "form-fill",
      subject,
    });
  } else if (staged) {
    const created = await request("/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol: "1.1", title: STATE_TITLE }),
    });
    if (created.status !== 201) throw new Error("Preview unavailable");
    conversation = created.body as { id: string };
  } else {
    const list = await baseSource.list();
    const found = list.find((item) => item.title === titles[scenario]);
    if (!found) throw new Error("Preview unavailable");
    conversation = found;
  }
  const favourites = new Set(["weekly-report"]);
  const documents: Flow[] = [
    {
      format: "1.0",
      id: "rename-item",
      title: "Rename item",
      kind: "prompt",
      tags: [],
      parameters: [
        { name: "title", label: "Title", type: "string", required: true },
      ],
      body: "Rename item",
    },
    {
      format: "1.0",
      id: "weekly-report",
      title: "Weekly report",
      kind: "prompt",
      tags: [],
      parameters: [],
      body: "Prepare a weekly report",
    },
  ];
  // The mock host's event stream, read as it arrives: replies stream in
  // a piece at a time, as from a real host. A form-bound conversation's
  // mock only signals that it changed.
  const transport = createHttpTransport(
    request,
    {
      subscribe: (path, onChunk, onStatus) => {
        const controller = new AbortController();
        onStatus("connecting");
        void fetch("/api" + path, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        })
          .then(async (result) => {
            if (!result.ok || !result.body)
              throw new Error("Stream unavailable");
            onStatus("open");
            const reader = result.body
              .pipeThrough(new TextDecoderStream())
              .getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done || controller.signal.aborted) break;
              onChunk(value);
            }
            // A body that ends without a line break still ends its line.
            if (!controller.signal.aborted) onChunk("\n");
          })
          .catch(() => {
            if (!controller.signal.aborted) onStatus("unavailable");
          });
        return () => controller.abort();
      },
    },
    form ? "signals" : "sse",
  );
  // The mock host answers every message: a reply state's own turn when one
  // was just scripted, otherwise a short streamed answer.
  let scripted = false;
  let version = 2;
  const withVersions = (value: Conversation): Conversation =>
    replyState !== "versions"
      ? value
      : {
          ...value,
          messages: value.messages.map((message, at) =>
            at === value.messages.length - 1 && message.role === "assistant"
              ? { ...message, versionIndex: version, versionCount: 3 }
              : message,
          ),
        };
  const script = async (turn: FixtureTurn) => {
    const result = await request("/__conformance/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: [turn] }),
    });
    if (result.status !== 200) throw new Error("Preview unavailable");
  };
  const client = createWaypointClient({
    accountId: "playground",
    conversationId: conversation.id,
    transport: {
      ...transport,
      send: async (reply, ...rest) => {
        if (reply.kind === "message" && !form && !scripted)
          await script(defaultTurn(locale));
        scripted = false;
        return transport.send(reply, ...rest);
      },
      read: async (...args) =>
        withVersions(
          localizeConversation(await transport.read(...args), locale),
        ),
    },
    formSession: form,
    // The mock host keeps every rating and three versions of the reply in
    // the versions state; choosing one only changes which is shown.
    feedback: { send: () => {} },
    // The playground's own data, which the mock host's reads ask for.
    reads: {
      manifest,
      request: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([{ title: "Order 1042" }]), 700),
        ),
    },
    ...(replyState === "versions"
      ? {
          versions: {
            edit: () => {},
            regenerate: () => {},
            select: ({ index }: { index: number }) => {
              version = index;
            },
          },
        }
      : {}),
    platform: {
      clock: {
        now: Date.now,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      online: () => navigator.onLine,
      visibility: () => document.visibilityState === "visible",
      ids: () => crypto.randomUUID(),
    },
    ...(scenario === "flows"
      ? {
          tabs: ["presets", "favourites"] as const,
          flowSource: {
            list: (tab: FlowTab) =>
              documents
                .filter(
                  (flow) => tab !== "favourites" || favourites.has(flow.id),
                )
                .map((flow) => ({
                  id: flow.id,
                  title: translatePreview(flow.title, locale),
                  favourite: favourites.has(flow.id),
                })),
            load: (id: string) => {
              const document = documents.find((flow) => flow.id === id);
              if (!document) throw new Error("Request unavailable");
              return {
                ...document,
                title: translatePreview(document.title, locale),
                body: translatePreview(document.body, locale),
                parameters: document.parameters.map((parameter) => ({
                  ...parameter,
                  label: translatePreview(parameter.label, locale),
                })),
              };
            },
            setFavourite: (id: string, value: boolean) => {
              if (value) favourites.add(id);
              else favourites.delete(id);
            },
            run: async (id: string, values: Record<string, unknown>) => {
              const document = documents.find((flow) => flow.id === id);
              if (!document) throw new Error("Request unavailable");
              const content =
                translatePreview(document.body, locale) +
                (values.title ? `: ${String(values.title)}` : "");
              const result = await request(
                `/conversations/${conversation.id}/messages`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    protocol: "1.1",
                    clientMessageId: crypto.randomUUID(),
                    content,
                  }),
                },
              );
              if (result.status !== 200) throw new Error("Request unavailable");
              return { conversationId: conversation.id };
            },
          },
        }
      : {}),
  });
  await client.ready;
  if (!client.getSnapshot().conversation) {
    client.dispose();
    form?.dispose();
    throw new Error("Preview unavailable");
  }
  if (staged) {
    // The host is told what to do with the next message, then it is asked.
    await script(stateTurn(replyState, language));
    scripted = true;
    await client.setDraft(stateQuestion(language));
    await client.send();
    if (replyState === "plan") client.setPlan(statePlan(conversation.id));
    if (replyState === "plan-step-failed")
      client.setPlan(stateFailedPlan(conversation.id, language));
    // Stopped once the reply has written a few lines.
    if (replyState === "stopped") {
      const stopWhenWritten = () => {
        const last = client.getSnapshot().conversation?.messages.at(-1);
        if (last?.status === "writing" && last.content.length > 160) {
          unsubscribe();
          void client.stopReply();
        }
      };
      const unsubscribe = client.subscribe(stopWhenWritten);
    }
  }
  return {
    client,
    form,
    source,
    async setLanguage(next: View["lang"]) {
      if (next === locale) return;
      locale = next;
      form?.refreshLabels();
      await client.refresh();
      if (scenario === "flows") await client.loadFlows();
    },
    dispose: () => {
      client.dispose();
      form?.dispose();
    },
  };
}
export type Preview = Awaited<ReturnType<typeof createPreview>>;
