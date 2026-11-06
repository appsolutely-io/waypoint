import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createWaypointClient, type Conversation } from "../../src/index";
import { createFormSession } from "../../src/core/form-session";
import {
  WaypointProvider,
  FormFillFields,
  FormFillPopup,
  useFormFill,
  themeProperties,
  lightTheme,
  darkTheme,
} from "../../src/react/index";
import { createTestPlatform } from "../../src/testing/transport";
import { antdSkin } from "../../src/skin-antd/index";
import "../../src/react/styles.css";
const subject = {
  key: "draft-a",
  resource: "items",
  label: "Item",
  route: "/items/new",
  state: "pending" as const,
};
const records = new Map<string, Conversation>([
  [
    "form-root",
    {
      protocol: "1.1",
      id: "form-root",
      mode: "form-fill",
      subject,
      title: "Form",
      messages: [],
    },
  ],
]);
let serial = 0;
// Query parameters: skin=antd, scheme=light|dark, fields=all (a number and
// a boolean field too), attach=1 (an attachment port), attach=held (one
// whose uploads wait for `finishUpload()`).
const params = new URLSearchParams(location.search);
const session = createFormSession({
  fields: [
    { name: "title", label: "Title", tier: "low", value: "" },
    ...(params.get("fields") === "all"
      ? [
          { name: "count", label: "Count", tier: "low" as const, value: 3 },
          {
            name: "public",
            label: "Public",
            tier: "low" as const,
            value: false,
          },
        ]
      : []),
  ],
  ids: () => `request-${++serial}`,
});
const draftAttempts: unknown[] = [];
if (params.get("draft") === "retry")
  (window as unknown as { draftAttempts: unknown[] }).draftAttempts =
    draftAttempts;
let uploads = 0;
const attachments =
  params.get("attach") === "1" || params.get("attach") === "held"
    ? {
        upload: async () => {
          if (params.get("attach") === "held")
            await new Promise<void>((resolve) => {
              (window as unknown as { finishUpload(): void }).finishUpload =
                resolve;
            });
          return `private-${++uploads}`;
        },
        remove: async () => {},
      }
    : undefined;
const client = createWaypointClient({
  accountId: "form-account",
  conversationId: "form-root",
  platform: createTestPlatform(),
  formSession: session,
  transport: {
    negotiate: async () => ({ protocol: "1.1", capabilities: ["form-fill"] }),
    read: async (id) => structuredClone(records.get(id)!),
    subscribe: () => () => {},
    send: async (reply, id) => {
      if (reply.kind !== "form-fill") throw new Error("Form requests only");
      const retry = params.get("draft") === "retry";
      if (retry) draftAttempts.push(structuredClone(reply));
      if (
        params.get("draft") === "held" ||
        (retry && draftAttempts.length === 1)
      )
        await new Promise<void>((resolve, reject) => {
          (window as unknown as { finishDraft(): void }).finishDraft = retry
            ? () => reject(new Error("offline"))
            : resolve;
        });
      records.get(id)!.messages.push({
        id: reply.clientReplyId,
        role: "assistant",
        content: "",
        createdAt: 0,
        blocks: [
          {
            type: "form.fill",
            id: reply.clientReplyId,
            fallback: "Draft",
            body: {
              requestId: reply.request.requestId,
              values: Object.fromEntries(
                reply.request.fields.map((field) => [
                  field.name,
                  field.name === "title"
                    ? {
                        value: "Generated complete title",
                        validation: {
                          status: "invalid",
                          messages: ["Review this value"],
                          guidance: "Prefer a shorter title",
                        },
                      }
                    : {
                        value: field.name === "count" ? 7 : true,
                        validation: { status: "valid", messages: [] },
                      },
                ]),
              ),
            },
          },
        ],
      });
      return { id: reply.clientReplyId };
    },
  },
});
await client.ready;
function App() {
  const [open, setOpen] = useState(false),
    [field, setField] = useState<string | undefined>();
  const scheme = params.get("scheme");
  const skin =
    params.get("skin") === "antd"
      ? // waypoint's own tokens on the antd skin: a theme prop wins over
        // the host's antd theme.
        { ...antdSkin, theme: {} }
      : {};
  return (
    <WaypointProvider
      client={client}
      {...skin}
      {...(scheme === "light" || scheme === "dark"
        ? { colorScheme: scheme }
        : {})}
    >
      {/* A host form that uses waypoint's tokens around its fields. */}
      <div
        className="waypoint"
        style={{
          ...themeProperties(scheme === "dark" ? darkTheme : lightTheme),
          background: "var(--wp-background)",
          color: "var(--wp-foreground)",
          padding: "1rem",
        }}
      >
        <FormFillFields
          session={session}
          onRegenerate={(name) => {
            setField(name);
            setOpen(true);
          }}
        />
        <FormFillPopup
          session={session}
          open={open}
          field={field}
          onClose={() => setOpen(false)}
          attachments={attachments}
          source={{
            list: async () => [],
            create: async (input) => {
              const child: Conversation = {
                ...input,
                id: `child-${++serial}`,
                messages: [],
              };
              records.set(child.id, child);
              return child;
            },
          }}
        />
        <Result />
      </div>
    </WaypointProvider>
  );
}
function Result() {
  const state = useFormFill(session);
  return (
    <p role="status" aria-label="Result">
      {state.fields.title?.value === "Generated complete title"
        ? "Draft ready"
        : "Waiting"}
    </p>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
