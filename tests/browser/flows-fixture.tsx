import { createRoot } from "react-dom/client";
import { createWaypointClient } from "../../src/index";
import type { Flow } from "../../src/protocol/generated";
import { WaypointChat } from "../../src/react/index";
import { createTestPlatform } from "../../src/testing/transport";
import { antdSkin } from "../../src/skin-antd/index";
import "../../src/react/styles.css";
import { completed, recordOf } from "../support/host-plans";
// Saved requests with a parameter form. Query parameters: skin=antd,
// scheme=light|dark, rtl=css (direction from a host stylesheet only).
const params = new URLSearchParams(location.search);
const favourites = new Set<string>(["flow-b"]);
let loadAttempts = 0;
const runs: unknown[] = [];
(window as unknown as { runs: unknown[] }).runs = runs;
const document_ = (id: string, title: string): Flow => ({
  format: "1.0",
  id,
  title,
  kind: "prompt",
  parameters:
    id === "flow-a"
      ? [
          { name: "title", type: "string", required: true, label: "Title" },
          {
            name: "count",
            type: "number",
            required: false,
            label: "Count",
            default: 2,
          },
          { name: "notify", type: "boolean", required: false, label: "Notify" },
        ]
      : [],
  tags: [],
  body: title,
});
const titles: Record<string, string> = {
  "flow-a": "Rename item",
  "flow-b": "Weekly report",
  "flow-c": "Archive old items",
};
const client = createWaypointClient({
  accountId: "flows-account",
  conversationId: "flows",
  platform: createTestPlatform(),
  tabs: ["presets", "favourites"],
  transport: {
    negotiate: async () => ({
      protocol: "1.0",
      capabilities: ["flows", "plans"],
    }),
    read: async (id) => ({ protocol: "1.0", id, title: "Chat", messages: [] }),
    send: async (reply) => ({ id: reply.clientReplyId }),
    subscribe: () => () => {},
  },
  flowSource: {
    list: (tab) =>
      Object.keys(titles)
        .filter((id) => tab !== "favourites" || favourites.has(id))
        .map((id) => ({
          id,
          title: titles[id]!,
          favourite: favourites.has(id),
        })),
    setFavourite: (id, value) => {
      if (value) favourites.add(id);
      else favourites.delete(id);
    },
    load: async (id) => {
      if (params.get("load") === "retry") {
        if (++loadAttempts === 1) throw new Error("offline");
        await new Promise<void>((resolve) => {
          (window as unknown as { finishFlow(): void }).finishFlow = resolve;
        });
      }
      (window as unknown as { loads: number }).loads =
        ((window as unknown as { loads?: number }).loads ?? 0) + 1;
      return document_(id, titles[id]!);
    },
    run: async (id, values) => {
      runs.push({ id, values });
      return { conversationId: "flows" };
    },
  },
});
await client.ready;
// plan=readonly: a protected plan this client cannot control (it has no
// intent port, so plan recovery is not agreed).
if (params.get("plan") === "readonly") {
  const record = recordOf(completed());
  client.setPlan({
    ...record,
    recovery: { ...record.recovery!, conversationId: "flows" },
  });
}
const skin = params.get("skin") === "antd" ? antdSkin : {};
const scheme = params.get("scheme");
if (params.get("rtl") === "css")
  document.head.insertAdjacentHTML(
    "beforeend",
    "<style>.waypoint [role=tablist] { direction: rtl; }</style>",
  );
createRoot(document.getElementById("root")!).render(
  <WaypointChat
    client={client}
    {...skin}
    {...(scheme === "light" || scheme === "dark"
      ? { colorScheme: scheme }
      : {})}
  />,
);
