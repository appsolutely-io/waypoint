import {
  createWaypointClient,
  createHttpTransport,
  createHttpConversationSource,
  type FlowTab,
} from "../src/index";
import { createFormSession } from "../src/core/form-session";
import type { HttpRequest } from "../src/conformance/index";
import type { Flow } from "../src/protocol/generated";
import type { View } from "./state";

import { translatePreview } from "./copy";
import { localizeConversation, localizeForm } from "./localize";

export async function createPreview(
  scenario: View["scenario"],
  language: View["lang"] = "en",
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
  const source = {
    list: async (key?: string) =>
      (await baseSource.list(key)).map((item) => ({
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
  const transport = createHttpTransport(
    request,
    {
      subscribe: (path, onChunk, onStatus) => {
        const controller = new AbortController();
        onStatus("open");
        void fetch("/api" + path, { signal: controller.signal })
          .then(async (result) => {
            if (!result.ok) throw new Error("Stream unavailable");
            const body = await result.text();
            if (!controller.signal.aborted) onChunk(body + "\n");
          })
          .catch(() => {
            if (!controller.signal.aborted) onStatus("unavailable");
          });
        return () => controller.abort();
      },
    },
    "signals",
  );
  const client = createWaypointClient({
    accountId: "playground",
    conversationId: conversation.id,
    transport: {
      ...transport,
      read: async (...args) =>
        localizeConversation(await transport.read(...args), locale),
    },
    formSession: form,
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
