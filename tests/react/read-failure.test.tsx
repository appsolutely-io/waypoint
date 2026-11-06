// @vitest-environment jsdom
// A conversation that could not be read says so, in its own words, with a
// Retry that reads the conversation current at that moment; one that is
// genuinely gone keeps its own text; the conversation list's failure has a
// Retry too.
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { english, simplifiedChinese } from "../../src/react/i18n";
import {
  ConversationReadError,
  createWaypointClient,
} from "../../src/core/client";
import type { Conversation } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(cleanup);
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
const conversation = (id: string): Conversation =>
  ({ protocol: "1.0", id, title: id, messages: [] }) as Conversation;
const alertWith = (text: string) =>
  screen.findByRole("alert", {
    name: (_, element) => element.textContent?.includes(text) ?? false,
  });

describe.each(skins)(
  "a conversation that could not be read (%s)",
  (_, skin) => {
    it("CK-FU11 a failed read says so with Retry; Retry reads the conversation current then", async () => {
      const base = config();
      const reads: string[] = [];
      let fail = true;
      const client = createWaypointClient({
        ...base,
        conversationId: "conversation-a",
        transport: {
          ...base.transport,
          read: async (id) => {
            reads.push(id);
            if (id === "conversation-b" && fail) throw new Error("offline");
            return conversation(id);
          },
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      await act(async () => {
        await client.ready;
        await client.switchConversation("conversation-b");
      });
      const alert = await alertWith(english["chat.conversationReadFailed"]);
      expect(alert.textContent).not.toContain("site");
      fail = false;
      reads.length = 0;
      await act(async () => {
        fireEvent.click(
          within(alert).getByRole("button", { name: english["chat.retry"] }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(reads).toContain("conversation-b");
      await waitFor(() =>
        expect(client.getSnapshot().conversation?.id).toBe("conversation-b"),
      );
      client.dispose();
    });
    it("CK-FU11 a conversation that is gone keeps its own text", async () => {
      const base = config();
      const client = createWaypointClient({
        ...base,
        conversationId: "conversation-a",
        transport: {
          ...base.transport,
          read: async (id) => {
            if (id === "conversation-b")
              throw new ConversationReadError(id, 404);
            return conversation(id);
          },
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      await act(async () => {
        await client.ready;
        await client.switchConversation("conversation-b");
      });
      await alertWith(english["chat.conversationUnavailable"]);
      expect(document.body.textContent).not.toContain(
        english["chat.conversationReadFailed"],
      );
      client.dispose();
    });
    it("CK-FU11 the conversation list's failure has a Retry that lists again", async () => {
      let lists = 0;
      const client = createWaypointClient(config());
      render(
        <WaypointChat
          client={client}
          {...skin}
          conversationSource={{
            list: async () => {
              lists++;
              if (lists === 1) throw new Error("offline");
              return [{ id: "conversation-a", title: "First" }];
            },
            create: async () => ({ id: "new" }) as never,
          }}
        />,
      );
      await act(async () => {
        await client.ready;
      });
      const alert = await alertWith(english["chat.conversationsFailed"]);
      await act(async () => {
        fireEvent.click(
          within(alert).getByRole("button", { name: english["chat.retry"] }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(lists).toBe(2);
      expect(await screen.findByRole("button", { name: "First" })).toBeTruthy();
      client.dispose();
    });
  },
);
describe("CK-FU11 the catalogue", () => {
  it("has the text in English and Simplified Chinese", () => {
    expect(english["chat.conversationReadFailed"]).toBe(
      "This conversation could not be loaded.",
    );
    expect(simplifiedChinese["chat.conversationReadFailed"]).toBe(
      "无法加载此对话。",
    );
  });
});
