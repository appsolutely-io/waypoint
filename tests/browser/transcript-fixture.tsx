// A chat whose messages have set heights, for the transcript's position in
// a real browser. A message's content is "<height>" or "<height>:nested"
// (a nested scrollable region); the page exposes `fixture.show(contents,
// ids?)`, ids defaulting to m1, m2, … by position.
import { createRoot } from "react-dom/client";
import {
  createWaypointClient,
  type Conversation,
  type ConversationPage,
  type ConversationPageInput,
} from "../../src/index";
import { WaypointChat } from "../../src/react/index";
import { createTestPlatform } from "../../src/testing/transport";
import { antdSkin } from "../../src/skin-antd/index";
import "../../src/react/styles.css";

const params = new URLSearchParams(location.search);
const PAGE_SIZE: number = 5;
const pageSnapshots = new Map<string, Conversation>();
let releasePage: (() => void) | undefined;
let contents: string[] = Array.from({ length: 10 }, () => "100");
let ids: string[] | undefined;
const conversation = (): Conversation => ({
  protocol: "1.0",
  id: "transcript",
  title: "Transcript",
  messages: contents.map((content, index) => ({
    id: ids?.[index] ?? `m${index + 1}`,
    role: "assistant",
    content,
    createdAt: index,
    blocks: [],
    status: "completed",
  })),
});
const client = createWaypointClient({
  accountId: "transcript-account",
  conversationId: "transcript",
  platform: createTestPlatform(),
  transport: {
    negotiate: async () => ({ protocol: "1.0", capabilities: [] }),
    read: async () => conversation(),
    ...(params.has("paged")
      ? {
          readPage: async (
            _id: string,
            input: ConversationPageInput,
          ): Promise<ConversationPage> => {
            const current = conversation();
            const currentId = JSON.stringify(current.messages);
            pageSnapshots.set(currentId, current);
            const snapshotId = input.snapshotId ?? currentId;
            const snapshot = pageSnapshots.get(snapshotId);
            if (!snapshot) return { stale: true };
            let end = snapshot.messages.length;
            if (input.cursor) {
              if (!/^before:(0|[1-9]\d*)$/.test(input.cursor))
                return { stale: true };
              end = Number(input.cursor.slice("before:".length));
              if (!Number.isSafeInteger(end) || end > snapshot.messages.length)
                return { stale: true };
            } else if (input.aroundMessageId) {
              const index = snapshot.messages.findIndex(
                (message) => message.id === input.aroundMessageId,
              );
              if (index < 0) return { stale: true };
              end = Math.min(
                snapshot.messages.length,
                (Math.floor(index / PAGE_SIZE) + 1) * PAGE_SIZE,
              );
            }
            if (input.cursor && params.has("holdPages"))
              await new Promise<void>((resolve) => {
                releasePage = resolve;
              });
            const start = Math.max(0, end - PAGE_SIZE);
            return {
              conversation: {
                ...snapshot,
                messages: snapshot.messages.slice(start, end),
              },
              snapshotId,
              olderCursor: start ? `before:${start}` : null,
              heldClientMessageIds: [],
              outline: snapshot.messages.map((message) => ({
                id: message.id,
                role: message.role,
                revision: JSON.stringify(message),
                text: message.content,
              })),
            };
          },
        }
      : {}),
    subscribe: () => () => {},
    send: async () => {
      throw new Error("Not used");
    },
  } as never,
});
await client.ready;
function Sized({ text }: { text: string }) {
  const [height, nested] = text.split(":");
  return nested ? (
    <div
      data-nested=""
      style={{ height: Number(height), overflow: "auto", margin: 0 }}
    >
      <div style={{ height: Number(height) * 4 }}>nested</div>
    </div>
  ) : (
    <div data-sized="" style={{ height: Number(height), margin: 0 }} />
  );
}
const skin = params.get("skin");
const scheme = params.get("scheme") === "dark" ? "dark" : "light";
const pageLayout = params.get("layout") === "page";
createRoot(document.getElementById("root")!).render(
  <WaypointChat
    client={client}
    renderers={params.has("prose") ? undefined : { markdown: Sized }}
    layout={pageLayout ? "page" : "panel"}
    dir={params.get("dir") === "rtl" ? "rtl" : "ltr"}
    colorScheme={scheme}
    // waypoint's own tokens on the antd skin (a theme prop wins over the
    // host's antd theme), unless the page asks for the host's (host=1).
    {...(skin === "antd"
      ? { ...antdSkin, ...(params.get("host") ? {} : { theme: {} }) }
      : {})}
  />,
);
Object.assign(window, {
  fixture: {
    releasePages() {
      releasePage?.();
      releasePage = undefined;
    },
    async show(next: string[], nextIds?: string[]) {
      contents = next;
      ids = nextIds;
      await client.refresh();
    },
  },
});
