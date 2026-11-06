// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { antdSkin } from "../../src/skin-antd";
import { FormFillFields, FormFillPopup } from "../../src/react/form-fill";
import { WaypointProvider, type PartProps } from "../../src/react/ui";
import { createFormSession } from "../../src/core/form-session";
import {
  createWaypointClient,
  type TransportPort,
} from "../../src/core/client";
import type { Conversation, FormFillValue } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const valid = { status: "valid" as const, messages: [] };
const invalid = (message: string) => ({
  status: "invalid" as const,
  messages: [message],
});
type Values = Record<
  string,
  {
    value: unknown;
    validation: { status: "valid" | "invalid"; messages: string[] };
  }
>;
// A form-bound conversation whose host answers each fill request with
// `answer(request)` (or nothing), appended to the conversation.
async function formHost(
  options: {
    fields?: { name: string; label: string; value: unknown }[];
    answer?: (requestId: string) => Values | "malformed" | undefined;
    send?: TransportPort["send"];
  } = {},
) {
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  const conversation: Conversation = {
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    mode: "form-fill",
    subject: {
      key: "draft",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
    messages: [],
  };
  cfg.transport.read = async () => structuredClone(conversation);
  const sent: string[] = [];
  cfg.transport.send =
    options.send ??
    (async (reply) => {
      if (reply.kind === "form-fill") {
        sent.push(reply.request.requestId);
        const values = options.answer?.(reply.request.requestId);
        if (values)
          conversation.messages.push({
            id: `m-${sent.length}`,
            role: "assistant",
            content: "",
            createdAt: 0,
            blocks: [
              {
                type: "form.fill",
                id: `b-${sent.length}`,
                fallback: "Draft",
                body:
                  values === "malformed"
                    ? ({ requestId: reply.request.requestId } as never)
                    : {
                        requestId: reply.request.requestId,
                        values: values as Record<string, FormFillValue>,
                      },
              },
            ],
          });
      }
      return { id: reply.clientReplyId };
    });
  const client = createWaypointClient(cfg);
  await client.ready;
  let serial = 0;
  const session = createFormSession({
    fields: (
      options.fields ?? [{ name: "title", label: "Title", value: "" }]
    ).map((field) => ({ ...field, tier: "low" as const })),
    ids: () => `fill-${++serial}`,
  });
  return { client, session, sent, conversation };
}
const generate = () =>
  screen.getByRole("button", { name: "Generate draft" }) as HTMLButtonElement;
const toolsReady = () =>
  waitFor(() => expect(generate().getAttribute("aria-disabled")).toBeNull());
const status = () =>
  [...document.querySelectorAll(".wp-form-status")].map((e) => e.textContent);

describe("the popup's fields go through the skin", () => {
  it("CK-FF1 Message and Reference links are the textarea primitive, and image paste still reaches the port", async () => {
    const h = await formHost();
    const textarea = vi.fn((props: PartProps) => (
      <textarea
        data-custom=""
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    ));
    const upload = vi.fn(async () => "private-reference");
    render(
      <WaypointProvider client={h.client} primitives={{ textarea }}>
        <FormFillPopup
          session={h.session}
          open
          onClose={() => {}}
          attachments={{ upload, remove: async () => {} }}
        />
      </WaypointProvider>,
    );
    await toolsReady();
    const message = screen.getByRole("textbox", { name: "Message" });
    expect(message.hasAttribute("data-custom")).toBe(true);
    expect(
      screen
        .getByRole("textbox", { name: "Reference links" })
        .hasAttribute("data-custom"),
    ).toBe(true);
    fireEvent.paste(message, {
      clipboardData: {
        files: [new File(["i"], "shot.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    h.client.dispose();
  });
});

describe("generation feedback", () => {
  it("CK-FF2 CK-FF3 says Generating once accepted, then one combined Draft ready", async () => {
    const h = await formHost({
      fields: [
        { name: "title", label: "Title", value: "" },
        { name: "summary", label: "Summary", value: "Mine" },
      ],
      answer: () => ({
        title: { value: "Drafted", validation: invalid("Too short") },
        summary: { value: "Theirs", validation: valid },
      }),
    });
    h.session.edit("summary", "My own");
    render(
      <WaypointProvider client={h.client}>
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    await waitFor(() =>
      expect(status()).toContain(
        "Draft ready, 1 field needs your choice, 1 field needs attention",
      ),
    );
    // A replay of the conversation says nothing new.
    const before = status();
    await act(async () => {
      await h.client.refresh();
    });
    expect(status()).toEqual(before);
    h.client.dispose();
  });

  it("CK-FF2 says nothing before the host accepts the request", async () => {
    let accept!: () => void;
    const h = await formHost({
      send: async (reply) => {
        await new Promise<void>((resolve) => (accept = resolve));
        return { id: reply.clientReplyId };
      },
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(status()).toEqual([""]);
    await act(async () => accept());
    await waitFor(() => expect(status()).toEqual(["Generating draft…"]));
    h.client.dispose();
  });

  it("CK-FF13 a draft for the pending request that cannot be used ends it, with a Retry that sends a new request", async () => {
    let answer: "malformed" | Values = "malformed";
    const h = await formHost({ answer: () => answer });
    render(
      <WaypointProvider client={h.client}>
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    await waitFor(() =>
      expect(screen.getByText("The draft could not be used.")).toBeDefined(),
    );
    expect(h.session.getSnapshot().pending).toBe(false);
    answer = { title: { value: "Good", validation: valid } };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(h.session.getSnapshot().fields.title?.value).toBe("Good"),
    );
    expect(new Set(h.sent).size).toBe(2);
    h.client.dispose();
  });
});

describe("a suggestion over an edit", () => {
  it("CK-FF4 is named, formatted, keeps its validation, and offers Replace or Keep mine", async () => {
    const h = await formHost();
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    const input = screen.getByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My edit" } });
    act(() => {
      const request = h.session.begin({ text: "Fill" });
      h.session.receive({
        requestId: request.requestId,
        values: {
          title: { value: "Their draft", validation: invalid("Too long") },
        },
      });
    });
    const group = await screen.findByRole("group", {
      name: "Suggested value for Title",
    });
    expect(group.textContent).toContain("Their draft");
    expect(group.textContent).toContain("Too long");
    expect(group.textContent).not.toContain('"');
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(input.value).toBe("My edit");
    expect(screen.queryByRole("group")).toBeNull();
    h.client.dispose();
  });

  it("CK-FF4 CK-FF5 Replace applies value and validation and says how many need attention", async () => {
    const h = await formHost();
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "My edit" },
    });
    act(() => {
      const request = h.session.begin({ text: "Fill" });
      h.session.receive({
        requestId: request.requestId,
        values: {
          title: { value: "Their draft", validation: invalid("Too long") },
        },
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    const input = screen.getByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement;
    expect(input.value).toBe("Their draft");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").map((element) => element.textContent),
      ).toContain("1 field needs attention"),
    );
    expect(
      document
        .getElementById(input.getAttribute("aria-describedby")!)!
        .classList.contains("wp-invalid"),
    ).toBe(true);
    h.client.dispose();
  });
});

describe("fields that are not text", () => {
  it("CK-FF6 a number edits as a number, a boolean as a checkbox, an object is shown read-only", async () => {
    const h = await formHost({
      fields: [
        { name: "count", label: "Count", value: 42 },
        { name: "public", label: "Public", value: false },
        { name: "meta", label: "Meta", value: { colour: "blue" } },
      ],
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Count" }), {
      target: { value: "7" },
    });
    expect(h.session.getSnapshot().fields.count?.value).toBe(7);
    fireEvent.click(screen.getByRole("checkbox", { name: "Public" }));
    expect(h.session.getSnapshot().fields.public?.value).toBe(true);
    await waitFor(() => expect(document.body.textContent).toContain("blue"));
    expect(document.body.textContent).not.toMatch(/[{["]/);
    expect(document.body.textContent).toContain("Edit this value in the form.");
    h.client.dispose();
  });

  it("CK-FF6 CK-FF4 a structured value and its suggestion are never put inside a paragraph", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await formHost({
      fields: [{ name: "meta", label: "Meta", value: { colour: "blue" } }],
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    await waitFor(() => expect(document.body.textContent).toContain("blue"));
    act(() => {
      h.session.edit("meta", { colour: "red" });
      const request = h.session.begin({ text: "Fill" });
      h.session.receive({
        requestId: request.requestId,
        values: { meta: { value: { colour: "green" }, validation: valid } },
      });
    });
    await screen.findByRole("group", { name: "Suggested value for Meta" });
    expect(document.querySelector("p dl")).toBeNull();
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes("cannot be a descendant"),
      ),
    ).toBe(false);
    errors.mockRestore();
    h.client.dispose();
  });

  it("CK-FF6b an entry that is not a number counts as an edit and holds Generate back", async () => {
    const h = await formHost({
      fields: [{ name: "count", label: "Count", value: 42 }],
      answer: () => ({ count: { value: 1, validation: valid } }),
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Count" }), {
      target: { value: "" },
    });
    expect(h.session.getSnapshot().fields.count?.localInvalid).toBe(true);
    expect(screen.getByText("Enter a number.")).toBeDefined();
    expect(generate().getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(generate().getAttribute("aria-describedby")!)!
        .textContent,
    ).toBe("Fix the highlighted fields first.");
    fireEvent.click(generate());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.sent).toHaveLength(0);
    h.client.dispose();
  });
});

describe("an entry that is not a number holds back every send", () => {
  const fields = [{ name: "count", label: "Count", value: 42 }];
  const reasonOf = (button: HTMLElement) =>
    document.getElementById(button.getAttribute("aria-describedby") ?? "")
      ?.textContent;
  const unfinish = () =>
    fireEvent.change(screen.getByRole("spinbutton", { name: "Count" }), {
      target: { value: "" },
    });
  it.each(["default", "antd"])(
    "CK-FF6b a field's Regenerate stays focusable with its reason and asks for nothing: %s",
    async (skin) => {
      const h = await formHost({ fields });
      const regenerate = vi.fn();
      render(
        <WaypointProvider
          client={h.client}
          {...(skin === "antd" ? antdSkin : {})}
        >
          <FormFillFields session={h.session} onRegenerate={regenerate} />
          <FormFillPopup session={h.session} open onClose={() => {}} />
        </WaypointProvider>,
      );
      await toolsReady();
      unfinish();
      fireEvent.focus(screen.getByRole("spinbutton", { name: "Count" }));
      const button = screen.getByRole("button", { name: "Regenerate Count" });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      button.focus();
      expect(document.activeElement).toBe(button);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(reasonOf(button)).toBe("Fix the highlighted fields first.");
      fireEvent.click(button);
      expect(regenerate).not.toHaveBeenCalled();
      h.client.dispose();
    },
  );

  it("CK-FF6b the Retry of a failed send is unavailable with the reason and sends nothing", async () => {
    let attempts = 0;
    const h = await formHost({
      fields,
      send: async (reply) => {
        if (reply.kind === "form-fill") attempts++;
        throw new Error("offline");
      },
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    const retry = await screen.findByRole("button", { name: "Retry" });
    const before = attempts;
    unfinish();
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(reasonOf(retry)).toBe("Fix the highlighted fields first.");
    fireEvent.click(retry);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(attempts).toBe(before);
    h.client.dispose();
  });

  it("CK-FF6b the Retry of a draft that could not be used is unavailable with the reason and sends nothing", async () => {
    const h = await formHost({ fields, answer: () => "malformed" });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    await screen.findByText("The draft could not be used.");
    const retry = screen.getByRole("button", { name: "Retry" });
    unfinish();
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(reasonOf(retry)).toBe("Fix the highlighted fields first.");
    fireEvent.click(retry);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.sent).toHaveLength(1);
    h.client.dispose();
  });

  it("CK-FF6b a remount shows the entry again, and an earlier request's fill becomes a suggestion whose Replace clears the error", async () => {
    const h = await formHost({ fields });
    const view = () => (
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>
    );
    const first = render(view());
    const request = h.session.begin({ text: "Fill" });
    unfinish();
    first.unmount();
    render(view());
    const input = screen.getByRole("spinbutton", {
      name: "Count",
    }) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText("Enter a number.")).toBeDefined();
    act(() => {
      h.session.receive({
        requestId: request.requestId,
        values: { count: { value: 7, validation: valid } },
      });
    });
    await screen.findByRole("group", { name: "Suggested value for Count" });
    expect(input.value).toBe("");
    expect(h.session.getSnapshot().fields.count?.localInvalid).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(
      (screen.getByRole("spinbutton", { name: "Count" }) as HTMLInputElement)
        .value,
    ).toBe("7");
    expect(screen.queryByText("Enter a number.")).toBeNull();
    expect(h.session.getSnapshot().fields.count?.localInvalid).toBeUndefined();
    h.client.dispose();
  });
});

describe("attachments", () => {
  const popup = (h: Awaited<ReturnType<typeof formHost>>, port?: object) =>
    render(
      <WaypointProvider client={h.client}>
        <FormFillPopup
          session={h.session}
          open
          onClose={() => {}}
          attachments={port as never}
        />
      </WaypointProvider>,
    );
  it("images can upload during a draft send without changing its captured attachments", async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const send = vi.fn<TransportPort["send"]>(async (reply) => {
      await held;
      return { id: reply.clientReplyId };
    });
    const h = await formHost({ send });
    const upload = vi.fn(async (file: File) => `ref-${file.name}`);
    popup(h, { upload, remove: async () => {} });
    await toolsReady();
    fireEvent.click(generate());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const reply = send.mock.calls[0]![0];
    expect(reply.kind).toBe("form-fill");
    if (reply.kind !== "form-fill") throw new Error("Expected form fill");
    expect(reply.request.attachments).toEqual([]);
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "Remove a.png" }),
    ).toBeDefined();
    expect(reply.request.attachments).toEqual([]);
    expect(generate().disabled).toBe(true);
    await act(async () => {
      finish();
      await held;
    });
    h.client.dispose();
  });

  it.each(["arrival", "request end"])(
    "Remove stays refused through a pending draft until %s",
    async (outcome) => {
      let finish!: () => void;
      const held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const send = vi.fn<TransportPort["send"]>(async (reply) => {
        await held;
        return { id: reply.clientReplyId };
      });
      const h = await formHost({ send });
      const remove = vi.fn(async () => {});
      popup(h, { upload: async () => "ref-a", remove });
      await toolsReady();
      fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
        clipboardData: {
          files: [new File(["a"], "a.png", { type: "image/png" })],
        },
      });
      const button = await screen.findByRole("button", {
        name: "Remove a.png",
      });
      fireEvent.click(generate());
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      fireEvent.click(button);
      expect(remove).not.toHaveBeenCalled();
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(
        document.getElementById(button.getAttribute("aria-describedby")!)
          ?.textContent,
      ).toBe("Wait for the draft to finish.");
      expect(screen.getByRole("button", { name: "Remove a.png" })).toBe(button);
      const reply = send.mock.calls[0]![0];
      if (reply.kind !== "form-fill") throw new Error("Expected form fill");
      expect(reply.request.attachments).toEqual(["ref-a"]);
      await act(async () => {
        finish();
        await held;
      });
      if (outcome === "arrival") {
        expect(h.session.getSnapshot().pending).toBe(true);
        expect(button.getAttribute("aria-disabled")).toBe("true");
        fireEvent.click(button);
        expect(remove).not.toHaveBeenCalled();
        h.conversation.messages.push({
          id: "draft",
          role: "assistant",
          content: "",
          createdAt: 0,
          blocks: [
            {
              type: "form.fill",
              id: "fill",
              fallback: "Draft",
              body: {
                requestId: reply.request.requestId,
                values: { title: { value: "Arrived", validation: valid } },
              },
            },
          ],
        });
        await act(async () => {
          await h.client.refresh();
        });
        await waitFor(() =>
          expect(h.session.getSnapshot().pending).toBe(false),
        );
      } else {
        act(() => h.session.failRequest(reply.request.requestId));
      }
      await waitFor(() =>
        expect(button.getAttribute("aria-disabled")).toBeNull(),
      );
      fireEvent.click(button);
      await waitFor(() => expect(remove).toHaveBeenCalledWith("ref-a"));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Remove a.png" }),
        ).toBeNull(),
      );
      h.client.dispose();
    },
  );

  it("a failed draft keeps Remove refused and Retry resends exactly its original images and material", async () => {
    const send = vi.fn<TransportPort["send"]>(async (reply) => {
      if (send.mock.calls.length === 1) throw new Error("offline");
      return { id: reply.clientReplyId };
    });
    const h = await formHost({ send });
    const remove = vi.fn(async () => {});
    popup(h, { upload: async (file: File) => `ref-${file.name}`, remove });
    await toolsReady();
    const message = screen.getByRole("textbox", { name: "Message" });
    const references = screen.getByRole("textbox", { name: "Reference links" });
    fireEvent.change(message, { target: { value: "Original material" } });
    fireEvent.change(references, {
      target: { value: "https://example.test/a" },
    });
    fireEvent.paste(message, {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    const button = await screen.findByRole("button", { name: "Remove a.png" });
    fireEvent.click(generate());
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(h.session.getSnapshot().pending).toBe(true);
    fireEvent.click(button);
    expect(remove).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const original = structuredClone(send.mock.calls[0]![0]);
    if (original.kind !== "form-fill") throw new Error("Expected form fill");
    expect(original.request.attachments).toEqual(["ref-a.png"]);
    fireEvent.change(message, { target: { value: "New material" } });
    fireEvent.change(references, {
      target: { value: "https://example.test/b" },
    });
    fireEvent.paste(message, {
      clipboardData: {
        files: [new File(["b"], "b.png", { type: "image/png" })],
      },
    });
    await screen.findByRole("button", { name: "Remove b.png" });
    fireEvent.click(retry);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0]).toEqual(original);
    await waitFor(() => expect(retry.isConnected).toBe(false));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    act(() => h.session.failRequest(original.request.requestId));
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(remove).toHaveBeenCalledWith("ref-a.png"));
    h.client.dispose();
  });

  it("during an upload Generate and a failed send's Retry stay focusable, say why, and send nothing", async () => {
    const send = vi.fn<TransportPort["send"]>(async (reply) => {
      if (send.mock.calls.length === 1) throw new Error("offline");
      return { id: reply.clientReplyId };
    });
    const h = await formHost({ send });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const port = {
      upload: async (_file: File) => {
        await held;
        return "ref-a";
      },
      remove: async () => {},
    };
    popup(h, port);
    await toolsReady();
    const message = screen.getByRole("textbox", { name: "Message" });
    const reason = (button: HTMLElement) =>
      document.getElementById(button.getAttribute("aria-describedby")!)
        ?.textContent;
    // Generate, with no request yet.
    fireEvent.paste(message, {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(status()).toEqual(["Uploading 1 image…"]));
    expect(generate().disabled).toBe(false);
    expect(generate().getAttribute("aria-disabled")).toBe("true");
    expect(reason(generate())).toBe("Wait for the current upload to finish.");
    fireEvent.click(generate());
    expect(send).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(status()).toEqual(["1 image attached"]));
    // A failed send's Retry, during a second upload.
    fireEvent.click(generate());
    const retry = (await screen.findByRole("button", {
      name: "Retry",
    })) as HTMLButtonElement;
    let again!: () => void;
    const second = new Promise<void>((resolve) => (again = resolve));
    port.upload = async () => {
      await second;
      return "ref-b";
    };
    fireEvent.paste(message, {
      clipboardData: {
        files: [new File(["b"], "b.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(status()).toEqual(["Uploading 1 image…"]));
    expect(retry.disabled).toBe(false);
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(reason(retry)).toBe("Wait for the current upload to finish.");
    fireEvent.click(retry);
    expect(send).toHaveBeenCalledOnce();
    await act(async () => again());
    await waitFor(() => expect(retry.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(retry);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    h.client.dispose();
  });

  it("an upload belongs to the popup opening that started it: closing retires it, and the next opening is not busy", async () => {
    const h = await formHost();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const remove = vi.fn(async () => {});
    const port = {
      upload: vi.fn(async (_file: File) => {
        await held;
        return "ref-retired";
      }),
      remove,
    };
    const view = (open: boolean, field?: string) => (
      <WaypointProvider client={h.client}>
        <FormFillPopup
          session={h.session}
          open={open}
          field={field}
          onClose={() => {}}
          attachments={port}
        />
      </WaypointProvider>
    );
    const shown = render(view(true, "title"));
    await toolsReady();
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(status()).toEqual(["Uploading 1 image…"]));
    shown.rerender(view(false, "title"));
    shown.rerender(view(true, "title"));
    await toolsReady();
    // The new opening uploads and generates at once.
    expect(generate().getAttribute("aria-disabled")).toBeNull();
    port.upload.mockImplementation(async () => "ref-new");
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [new File(["b"], "b.png", { type: "image/png" })],
      },
    });
    await screen.findByRole("button", { name: "Remove b.png" });
    // The retired upload, once it lands, is removed and never listed.
    await act(async () => release());
    await waitFor(() => expect(remove).toHaveBeenCalledWith("ref-retired"));
    expect(screen.queryByRole("button", { name: "Remove a.png" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove b.png" })).toBeDefined();
    expect(remove).toHaveBeenCalledTimes(1);
    h.client.dispose();
  });

  it("the unusable draft Retry explains its refusal during an upload", async () => {
    const h = await formHost({ answer: () => "malformed" });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    popup(h, {
      upload: async () => {
        await held;
        return "ref-a";
      },
      remove: async () => {},
    });
    await toolsReady();
    fireEvent.click(generate());
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(retry.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Wait for the current upload to finish.");
    fireEvent.click(retry);
    expect(h.sent).toHaveLength(1);
    await act(async () => {
      release();
      await held;
    });
    await waitFor(() => expect(retry.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(retry);
    await waitFor(() => expect(h.sent).toHaveLength(2));
    h.client.dispose();
  });

  it("an empty picker selection preserves the attachment status", async () => {
    const h = await formHost();
    popup(h, { upload: async () => "ref-a", remove: async () => {} });
    await toolsReady();
    const picker = document.querySelector('input[type="file"]')!;
    fireEvent.change(picker, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(status()).toEqual(["1 image attached"]));
    fireEvent.change(picker, { target: { files: [] } });
    expect(status()).toEqual(["1 image attached"]);
    h.client.dispose();
  });

  it("CK-FF7 every file is tried, rows are named uniquely, and the status names a failure", async () => {
    const h = await formHost();
    let n = 0;
    const upload = vi.fn(async (file: File) => {
      if (file.name === "bad.png") throw new Error("refused");
      return `ref-${++n}`;
    });
    const remove = vi.fn(async () => {});
    popup(h, { upload, remove });
    await toolsReady();
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [
          new File(["a"], "image.png", { type: "image/png" }),
          new File(["b"], "bad.png", { type: "image/png" }),
          new File(["c"], "image.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(status()).toEqual([
        "2 images attached bad.png could not be attached.",
      ]),
    );
    expect(
      screen.getByRole("button", { name: "Remove image.png" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove image.png (2)" }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith("ref-2"));
    h.client.dispose();
  });

  it("CK-FF7 a picker and a drop upload images; other files are refused", async () => {
    const h = await formHost();
    const upload = vi.fn(async (file: File) => `ref-${file.name}`);
    popup(h, { upload, remove: async () => {} });
    await toolsReady();
    const picker = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(screen.getByRole("button", { name: "Attach images" })).toBeDefined();
    fireEvent.change(picker, {
      target: { files: [new File(["a"], "picked.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove picked.png" }),
      ).toBeDefined(),
    );
    const area = screen.getByRole("textbox", { name: "Message" });
    fireEvent.drop(area, {
      dataTransfer: {
        files: [new File(["d"], "notes.txt", { type: "text/plain" })],
        types: ["Files"],
      },
    });
    await waitFor(() =>
      expect(status()).toEqual(["Only images can be attached."]),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    h.client.dispose();
  });

  it("CK-FF7 a failed removal keeps the row and says so", async () => {
    const h = await formHost();
    popup(h, {
      upload: async () => "ref-a",
      remove: async () => {
        throw new Error("no");
      },
    });
    await toolsReady();
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove a.png" }),
    );
    await waitFor(() =>
      expect(status()).toEqual(["a.png could not be removed."]),
    );
    expect(screen.getByRole("button", { name: "Remove a.png" })).toBeDefined();
    h.client.dispose();
  });

  it("CK-FF8 without a port, a pasted or dropped image says so and nothing is inserted by a drop", async () => {
    const h = await formHost();
    popup(h);
    await toolsReady();
    expect(screen.queryByRole("button", { name: "Attach images" })).toBeNull();
    const area = screen.getByRole("textbox", { name: "Message" });
    const paste = fireEvent.paste(area, {
      clipboardData: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
      },
    });
    expect(paste).toBe(true);
    expect(screen.getByText("Images can't be attached here.")).toBeDefined();
    expect(
      screen.queryByText("The request could not be completed."),
    ).toBeNull();
    const drop = fireEvent.drop(area, {
      dataTransfer: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
        types: ["Files"],
      },
    });
    expect(drop).toBe(false);
    h.client.dispose();
  });
});

describe("reverting a fill from the popup", () => {
  it("CK-FF9 offers one revert per fill, unavailable while a request is pending", async () => {
    const h = await formHost({
      answer: () => ({ title: { value: "Drafted", validation: valid } }),
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    const revert = await screen.findByRole("button", {
      name: "Revert this fill (Title)",
    });
    act(() => {
      h.session.begin({ text: "Again" });
    });
    expect(revert.getAttribute("aria-disabled")).toBe("true");
    act(() => h.session.cancel());
    fireEvent.click(revert);
    expect(h.session.getSnapshot().fields.title?.value).toBe("");
    await waitFor(() => expect(status()).toEqual(["Fill reverted."]));
    h.client.dispose();
  });
});

describe("focus after a removed control", () => {
  it("CK-FF12 Keep mine by keyboard hands focus to the field", async () => {
    const h = await formHost();
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "Mine" } });
    act(() => {
      const request = h.session.begin({ text: "Fill" });
      h.session.receive({
        requestId: request.requestId,
        values: { title: { value: "Theirs", validation: valid } },
      });
    });
    const keep = await screen.findByRole("button", { name: "Keep mine" });
    keep.focus();
    fireEvent.click(keep);
    await waitFor(() => expect(document.activeElement).toBe(input));
    h.client.dispose();
  });
});

describe("focus after a removed suggestion, revert or Retry", () => {
  // A suggestion for Title over the user's own edit.
  const suggest = (h: Awaited<ReturnType<typeof formHost>>) =>
    act(() => {
      const request = h.session.begin({ text: "Fill", field: "title" });
      h.session.receive({
        requestId: request.requestId,
        values: { title: { value: "Theirs", validation: valid } },
      });
    });
  it("CK-FF12 Replace by keyboard hands focus to the field", async () => {
    const h = await formHost();
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "Mine" } });
    suggest(h);
    const replace = await screen.findByRole("button", { name: "Replace" });
    replace.focus();
    fireEvent.keyDown(replace, { key: "Enter" });
    fireEvent.click(replace);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((input as HTMLInputElement).value).toBe("Theirs");
    h.client.dispose();
  });

  it("CK-FF12 under renderField, Keep mine hands focus to what the host drew", async () => {
    const h = await formHost();
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields
          session={h.session}
          onRegenerate={() => {}}
          renderField={(field) => (
            <input
              data-host=""
              aria-label={`Host ${field.label}`}
              value={String(field.value)}
              onChange={(event) => field.onChange(event.target.value)}
            />
          )}
        />
      </WaypointProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Host Title" }), {
      target: { value: "Mine" },
    });
    suggest(h);
    const keep = await screen.findByRole("button", { name: "Keep mine" });
    keep.focus();
    fireEvent.click(keep);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Host Title" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FF12 a handoff after focus moved elsewhere does nothing", async () => {
    const h = await formHost({
      fields: [
        { name: "title", label: "Title", value: "" },
        { name: "notes", label: "Notes", value: "" },
      ],
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
      </WaypointProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Mine" },
    });
    suggest(h);
    const keep = await screen.findByRole("button", { name: "Keep mine" });
    keep.focus();
    // The user moves on before the suggestion goes.
    const notes = screen.getByRole("textbox", { name: "Notes" });
    notes.focus();
    act(() => h.session.cancelReplacement("title"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    expect(document.activeElement).toBe(notes);
    h.client.dispose();
  });

  it("CK-FF12 a revert that leaves another revert action focuses that one", async () => {
    const h = await formHost({
      fields: [
        { name: "title", label: "Title", value: "" },
        { name: "notes", label: "Notes", value: "" },
      ],
      answer: () => ({
        title: { value: "Drafted", validation: valid },
        notes: { value: "First", validation: valid },
      }),
    });
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    await screen.findByRole("button", {
      name: "Revert this fill (Title, Notes)",
    });
    // A second fill takes Notes over: each fill now owns one field.
    act(() => {
      const request = h.session.begin({ text: "Notes", field: "notes" });
      h.session.receive({
        requestId: request.requestId,
        values: { notes: { value: "Noted", validation: valid } },
      });
    });
    const first = screen.getByRole("button", {
      name: "Revert this fill (Title)",
    });
    first.focus();
    fireEvent.click(first);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Revert this fill (Notes)" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FF12 CK-FF13 the unusable draft's Retry by keyboard hands focus to the Message field once the new request is sent", async () => {
    let answer: "malformed" | undefined = "malformed";
    const h = await formHost({ answer: () => answer });
    render(
      <WaypointProvider client={h.client}>
        <FormFillPopup session={h.session} open onClose={() => {}} />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(generate());
    await screen.findByText("The draft could not be used.");
    answer = undefined;
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.keyDown(retry, { key: "Enter" });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Message" }),
      ),
    );
    expect(new Set(h.sent).size).toBe(2);
    h.client.dispose();
  });
});

describe("focus after removed attachments and reverts, and a busy picker", () => {
  const open = (h: Awaited<ReturnType<typeof formHost>>, port: object) =>
    render(
      <WaypointProvider client={h.client}>
        <FormFillFields session={h.session} onRegenerate={() => {}} />
        <FormFillPopup
          session={h.session}
          open
          onClose={() => {}}
          attachments={port as never}
        />
      </WaypointProvider>,
    );
  const paste = (names: string[]) =>
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: names.map(
          (name) => new File(["x"], name, { type: "image/png" }),
        ),
      },
    });

  it("CK-FF12 removing a middle attachment by keyboard focuses the next row's Remove", async () => {
    const h = await formHost();
    let n = 0;
    open(h, { upload: async () => `ref-${++n}`, remove: async () => {} });
    await toolsReady();
    paste(["a.png", "b.png", "c.png"]);
    const middle = await screen.findByRole("button", { name: "Remove b.png" });
    middle.focus();
    fireEvent.click(middle);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Remove c.png" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FF12 removing the last attachment focuses the previous one, then the picker", async () => {
    const h = await formHost();
    let n = 0;
    open(h, { upload: async () => `ref-${++n}`, remove: async () => {} });
    await toolsReady();
    paste(["a.png", "b.png"]);
    const last = await screen.findByRole("button", { name: "Remove b.png" });
    last.focus();
    fireEvent.click(last);
    const previous = await screen.findByRole("button", {
      name: "Remove a.png",
    });
    await waitFor(() => expect(document.activeElement).toBe(previous));
    fireEvent.click(previous);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Attach images" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FF7 a mixed selection attaches its images and still says the other files were skipped", async () => {
    const h = await formHost();
    open(h, { upload: async () => "ref-a", remove: async () => {} });
    await toolsReady();
    fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
      clipboardData: {
        files: [
          new File(["x"], "a.png", { type: "image/png" }),
          new File(["x"], "notes.txt", { type: "text/plain" }),
        ],
      },
    });
    await screen.findByRole("button", { name: "Remove a.png" });
    await waitFor(() =>
      expect(status()).toEqual([
        "1 image attached Only images can be attached.",
      ]),
    );
    h.client.dispose();
  });

  it("CK-FF7 a second upload while one runs is refused and says why, and uploading is said", async () => {
    const h = await formHost();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    open(h, {
      upload: async () => {
        await held;
        return "ref-a";
      },
      remove: async () => {},
    });
    await toolsReady();
    paste(["a.png"]);
    await waitFor(() => expect(status()).toEqual(["Uploading 1 image…"]));
    paste(["b.png"]);
    await waitFor(() =>
      expect(status()).toEqual(["Wait for the current upload to finish."]),
    );
    await act(async () => release());
    await waitFor(() => expect(status()).toEqual(["1 image attached"]));
    h.client.dispose();
  });

  it("CK-FF12 a revert that leaves no revert action focuses the Message field", async () => {
    const h = await formHost({
      answer: () => ({ title: { value: "Drafted", validation: valid } }),
    });
    open(h, { upload: async () => "r", remove: async () => {} });
    await toolsReady();
    fireEvent.click(generate());
    const revert = await screen.findByRole("button", {
      name: "Revert this fill (Title)",
    });
    revert.focus();
    fireEvent.click(revert);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Message" }),
      ),
    );
    h.client.dispose();
  });
});
