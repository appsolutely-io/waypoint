import { createRoot } from "react-dom/client";
import { useState } from "react";
import Markdown from "../../src/react/markdown";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient, createHttpTransport } from "../../src/index";
import { createTestPlatform } from "../../src/testing/transport";
import { antdSkin } from "../../src/skin-antd/index";
import "../../src/react/styles.css";
const session = await fetch("/api/__conformance/session", {
  method: "POST",
}).then((r) => r.json());
const request = async (
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
) => {
  const response = await fetch("/api" + path, {
    ...init,
    headers: { ...init.headers, "X-CSRF-Token": session.csrf },
  });
  return { status: response.status, body: await response.json() };
};
const post = (path: string, body: unknown) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocol: "1.0", ...(body as object) }),
  });
const created = await post("/conversations", { title: "Fixture conversation" });
const id = (created.body as { id: string }).id;
for (let i = 0; i < 12; i++) {
  await post("/__conformance/script", {
    turns: [{ content: "A long fixture answer. ".repeat(30) }],
  });
  await post(`/conversations/${id}/messages`, {
    clientMessageId: `fixture-${i}`,
    content: `Question ${i}`,
  });
}
const transport = createHttpTransport(
  request,
  {
    subscribe: (path, onChunk, onStatus) => {
      let closed = false;
      onStatus("open");
      void request(path).then((result) => {
        if (!closed) onChunk(JSON.stringify(result.body) + "\n");
      });
      return () => {
        closed = true;
      };
    },
  },
  "signals",
);
const client = createWaypointClient({
  accountId: "fixture-account",
  conversationId: id,
  platform: createTestPlatform(),
  transport,
});
await client.ready;
client.setPlan({
  protocol: "1.0",
  id: "open-plan",
  state: "awaiting-confirmation",
  outcomes: [],
  confirmation: {
    token: "fixture-token",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    planId: "open-plan",
    conversationId: id,
    revision: 1,
    heading: "Update 1 record in items",
    items: [{ label: "Item a: title", before: '"Before"', after: '"After"' }],
    irreversible: false,
    undo: "Undoing this change is not available in this version.",
    verificationCount: 0,
    actionLabel: "Apply 1 change",
  },
  plan: {
    kind: "immediate",
    stage: "final",
    id: "open-plan",
    digest: "fixture",
    stepUpCount: 0,
    steps: [
      {
        id: "step-a",
        operation: "items.update",
        resource: "items",
        rows: ["a"],
        fields: ["title"],
        view: "/items/a",
        tier: "low",
        undo: "compare-and-set",
        stepUp: false,
        before: { title: "Before" },
        after: { title: "After" },
        request: {
          method: "PATCH",
          path: "/items/a",
          body: '{"title":"After"}',
          headers: { "If-Match": "v1" },
          digest: "fixture",
        },
      },
    ],
  },
});
function App() {
  const [dark, setDark] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [layout, setLayout] = useState<"panel" | "page" | "floating" | "sheet">(
    "panel",
  );
  const skin =
    new URLSearchParams(location.search).get("skin") === "antd"
      ? // waypoint's own tokens on the antd skin: a theme prop wins over
        // the host's antd theme.
        { ...antdSkin, theme: {} }
      : {};
  return (
    <>
      <div id="image-preview">
        <Markdown text="![](https://evil/?q=x)" />
      </div>
      <button id="switch" onClick={() => setDark(!dark)}>
        Switch scheme
      </button>
      <button id="direction" onClick={() => setRtl(!rtl)}>
        Switch direction
      </button>
      <select
        id="layout"
        value={layout}
        onChange={(event) => setLayout(event.target.value as typeof layout)}
      >
        {["panel", "page", "floating", "sheet"].map((mode) => (
          <option key={mode}>{mode}</option>
        ))}
      </select>
      <div style={{ width: 420 }}>
        <WaypointChat
          client={client}
          {...skin}
          colorScheme={dark ? "dark" : "light"}
          dir={rtl ? "rtl" : "ltr"}
          layout={layout}
          conversations={[{ id, title: "Fixture conversation" }]}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
