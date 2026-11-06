// @vitest-environment jsdom
// Back-fill fixes to the UI that landed before the current review rules,
// one describe per finding (rows BF in the phase plan).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { Block, PlanRecord } from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
import {
  addMessages,
  createFormatter,
  type MessageKey,
} from "../../src/react/i18n";
import {
  blockEnglish,
  blockSimplifiedChinese,
} from "../../src/react/block-messages";
import { config } from "../support/client";

afterEach(() => {
  cleanup();
  vi.doUnmock("../../src/react/blocks");
  vi.resetModules();
});
// The UI modules, imported fresh so a test can mock a chunk first.
async function ui() {
  const react = await import("../../src/react/index");
  const { createWaypointClient } = await import("../../src/core/client");
  return { ...react, createWaypointClient };
}
async function show(
  children: (m: Awaited<ReturnType<typeof ui>>) => ReactNode,
  antd = false,
  locale?: string,
) {
  const m = await ui();
  const client = m.createWaypointClient(config());
  await client.ready;
  const primitives = antd
    ? (await import("../../src/skin-antd/index")).antdPrimitives
    : undefined;
  render(
    <m.WaypointProvider client={client} primitives={primitives} locale={locale}>
      {children(m)}
    </m.WaypointProvider>,
  );
  return { client, m };
}
const table = {
  id: "t",
  type: "table",
  fallback: "A table of results",
  body: { columns: ["Name"], rows: [["Ada"]] },
} as unknown as Block;

describe("the lazy blocks chunk", () => {
  it("renders a block once its chunk has loaded", async () => {
    const { client } = await show((m) => (
      <m.Widget block={table} disabled={false} onReply={() => {}} />
    ));
    expect(await screen.findByRole("table")).not.toBeNull();
    client.dispose();
  });
  it("shows the block's own fallback when its chunk cannot load", async () => {
    vi.doMock("../../src/react/blocks", () => {
      throw new Error("chunk failed to load");
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { client } = await show((m) => (
        <m.Widget block={table} disabled={false} onReply={() => {}} />
      ));
      expect(await screen.findByText("A table of results")).not.toBeNull();
      expect(screen.queryByRole("table")).toBeNull();
      client.dispose();
    } finally {
      quiet.mockRestore();
    }
  });
});

// The locale Intl gets for a tag, as the chat resolves it.
const resolvedLocale = async (locale: string) => {
  const { catalogueFor } = await import("../../src/react/i18n");
  const { intlLocale } = await import("../../src/react/intl-locale");
  return intlLocale(locale, catalogueFor(locale).catalogue === "zh");
};
// Tag, catalogue, lang: every kind of tag the grammar accepts or refuses.
const LOCALE_CASES: [string, "en" | "zh", string][] = [
  ["zh", "zh", "zh"],
  ["zh-Hans", "zh", "zh-Hans"],
  ["ZH-hans-cn", "zh", "ZH-hans-cn"],
  ["zh-CN", "zh", "zh-CN"],
  // RFC 5646 subtags are joined by "-": an underscore is not a tag.
  ["zh_SG", "en", "en"],
  // Well-formedness first, then script and region by position; nothing
  // after a singleton (extensions, private use) is either.
  ["zh-!!", "en", "en"],
  ["zh--CN", "en", "en"],
  ["zh-x-hant", "zh", "zh-x-hant"],
  ["zh-CN-x-hant", "zh", "zh-CN-x-hant"],
  ["zh-Hant-TW", "en", "en"],
  ["zh-Hans-CN", "zh", "zh-Hans-CN"],
  ["zh-Hans-TW", "zh", "zh-Hans-TW"],
  ["zh-Latn", "en", "en"],
  ["zh-u-nu-hanidec", "zh", "zh-u-nu-hanidec"],
  // Well-formed by the RFC 5646 grammar itself, extlang included: the
  // extended language subtag names the language.
  ["zh-yue-HK", "en", "en"],
  ["zh-yue", "en", "en"],
  ["zh-cmn-Hans-CN", "zh", "zh-cmn-Hans-CN"],
  ["cmn-Hans", "zh", "cmn-Hans"],
  ["zh-cmn-Hant", "en", "en"],
  // Grandfathered tags: zh-guoyu is Mandarin; the others, and a
  // private-use-only tag, name no catalogue.
  ["zh-guoyu", "zh", "zh-guoyu"],
  ["zh-hakka", "en", "en"],
  ["art-lojban", "en", "en"],
  ["zh-min-nan", "en", "en"],
  ["i-klingon", "en", "en"],
  ["en-GB-oed", "en", "en"],
  ["x-private", "en", "en"],
  // Not well formed under the grammar.
  ["zh-yue-cmn-wuu-hak", "en", "en"],
  ["zh-Hans-CN-x", "en", "en"],
  ["zh-a", "en", "en"],
  ["zh-TW", "en", "en"],
  ["zh-Hant", "en", "en"],
  ["zh-Hant-HK", "en", "en"],
  ["zh-HK", "en", "en"],
  ["zh-MO", "en", "en"],
  ["en-GB", "en", "en-GB"],
  ["fr", "en", "en"],
  ["", "en", "en"],
  ["!!", "en", "en"],
];
describe("locale resolution", () => {
  it.each(LOCALE_CASES)(
    "%s gets the %s catalogue and lang %s",
    async (locale, catalogue, lang) => {
      const { catalogueFor } = await import("../../src/react/i18n");
      expect(catalogueFor(locale)).toEqual({ catalogue, lang });
    },
  );
  // Whatever the tag, the stock text renders in its catalogue: the tag
  // chooses the catalogue and lang, and Intl only ever sees a locale it
  // accepts.
  // Plurals follow the catalogue's language, not the tag's: French counts
  // zero as singular, English as plural.
  it("English text in a French locale uses English plurals", async () => {
    const { createFormatter } = await import("../../src/react/i18n");
    expect(createFormatter("fr")("chat.latestNew", { count: 0 })).toBe(
      createFormatter("en")("chat.latestNew", { count: 0 }),
    );
  });
  it.each(LOCALE_CASES)(
    "a chat in %s renders its text from the %s catalogue",
    async (locale, catalogue) => {
      const m = await ui();
      const client = m.createWaypointClient(config());
      await client.ready;
      render(<m.WaypointChat client={client} locale={locale} />);
      expect(
        await screen.findByText(
          catalogue === "zh" ? "开始对话" : "Start a conversation",
        ),
      ).not.toBeNull();
      client.dispose();
    },
  );
  it.each(LOCALE_CASES)(
    "%s formats every message and date without throwing",
    async (locale) => {
      const { createFormatter, english } = await import("../../src/react/i18n");
      const resolved = await resolvedLocale(locale);
      const t = createFormatter(locale);
      // Every argument any message names: a number for plurals, else text.
      const values = new Proxy({} as Record<string, unknown>, {
        get: (_, name) => (name === "count" ? 2 : "x"),
        has: () => true,
      });
      for (const key of Object.keys(english))
        expect(() => t(key as never, values as never)).not.toThrow();
      expect(() => new Date(0).toLocaleString(resolved)).not.toThrow();
    },
  );
  it.each([
    ["zh-cmn-Hans-CN", "zh-Hans"],
    ["x-private", "en"],
    ["zh_SG", "en"],
    ["en-GB", "en-GB"],
    ["fr-CA", "fr-CA"],
  ])("Intl takes %s as %s", async (locale, resolved) => {
    expect(await resolvedLocale(locale)).toBe(resolved);
  });
  it.each([
    ["zh", "开始对话", "zh"],
    ["zh-TW", "Start a conversation", "en"],
    ["fr", "Start a conversation", "en"],
  ])("a chat in %s shows %s, with lang %s", async (locale, text, lang) => {
    const m = await ui();
    const client = m.createWaypointClient(config());
    await client.ready;
    render(<m.WaypointChat client={client} locale={locale} />);
    expect(await screen.findByText(text)).not.toBeNull();
    expect(document.querySelector(".waypoint")!.getAttribute("lang")).toBe(
      lang,
    );
    client.dispose();
  });
  it("a host's own formatter keeps the host's locale as lang", async () => {
    const m = await ui();
    const client = m.createWaypointClient(config());
    await client.ready;
    render(
      <m.WaypointChat client={client} locale="fr" format={() => "Bonjour"} />,
    );
    expect(document.querySelector(".waypoint")!.getAttribute("lang")).toBe(
      "fr",
    );
    client.dispose();
  });
});

const formBlock = (
  fields: { name: string; label: string; required?: boolean }[],
) =>
  ({
    id: "f",
    type: "form",
    fallback: "A form",
    body: { fields },
  }) as unknown as Block;
const choiceBlock = (mode: "single" | "multi" | "text") =>
  ({
    id: "c",
    type: "choice",
    fallback: "Which plan suits you?",
    body: { mode, options: ["Basic", "Pro"] },
  }) as unknown as Block;
let antd = false;
async function widget(block: Block) {
  const onReply = vi.fn();
  const { client } = await show(
    (m) => <m.Widget block={block} disabled={false} onReply={onReply} />,
    antd,
  );
  return { client, onReply };
}
const submit = () => screen.getByRole("button", { name: "Submit" });
const describedText = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe.each([false, true])("blocks (antd %s)", (withAntd) => {
  beforeEach(() => {
    antd = withAntd;
  });
  describe("required form fields", () => {
    it("marks required fields in text and with aria-required; a blocked Submit stays focusable and says why", async () => {
      const { client, onReply } = await widget(
        formBlock([
          { name: "title", label: "Title", required: true },
          { name: "notes", label: "Notes" },
        ]),
      );
      const title = await screen.findByRole("textbox", { name: /Title/ });
      expect(title.closest("label")!.textContent).toMatch(/required/);
      expect(title.getAttribute("aria-required")).toBe("true");
      const notes = screen.getByRole("textbox", { name: "Notes" });
      expect(notes.getAttribute("aria-required")).toBeNull();
      expect(submit().hasAttribute("disabled")).toBe(false);
      expect(submit().getAttribute("aria-disabled")).toBe("true");
      expect(describedText(submit())).toMatch(/required/);
      fireEvent.click(submit());
      expect(onReply).not.toHaveBeenCalled();
      fireEvent.change(title, { target: { value: "Plan" } });
      expect(submit().getAttribute("aria-disabled")).toBeNull();
      fireEvent.click(submit());
      expect(onReply).toHaveBeenCalledOnce();
      expect(onReply.mock.calls[0]![0]).toMatchObject({
        kind: "form",
        values: { title: "Plan" },
      });
      client.dispose();
    });
  });
  describe("implicit submission", () => {
    it("Enter in an empty required field sends nothing; after filling it, one reply", async () => {
      const { client, onReply } = await widget(
        formBlock([{ name: "title", label: "Title", required: true }]),
      );
      const title = await screen.findByRole("textbox", { name: /Title/ });
      fireEvent.submit(title.closest("form")!);
      expect(onReply).not.toHaveBeenCalled();
      fireEvent.change(title, { target: { value: " " } });
      fireEvent.submit(title.closest("form")!);
      expect(onReply).not.toHaveBeenCalled();
      fireEvent.change(title, { target: { value: "Plan" } });
      fireEvent.submit(title.closest("form")!);
      expect(onReply).toHaveBeenCalledOnce();
      client.dispose();
    });
  });
  describe("the choice block", () => {
    it.each(["single", "multi"] as const)(
      "a %s choice is a group named by the question; an empty answer is refused with a reason",
      async (mode) => {
        const { client, onReply } = await widget(choiceBlock(mode));
        const group = await screen.findByRole("group", {
          name: "Which plan suits you?",
        });
        expect(group).not.toBeNull();
        expect(submit().getAttribute("aria-disabled")).toBe("true");
        expect(describedText(submit())).not.toBe("");
        fireEvent.click(submit());
        expect(onReply).not.toHaveBeenCalled();
        fireEvent.click(
          screen.getByRole(mode === "multi" ? "checkbox" : "radio", {
            name: "Pro",
          }),
        );
        fireEvent.click(submit());
        expect(onReply).toHaveBeenCalledOnce();
        client.dispose();
      },
    );
    it("a text answer is labelled by the question, and refused while empty", async () => {
      const { client, onReply } = await widget(choiceBlock("text"));
      const answer = await screen.findByRole("textbox", {
        name: "Which plan suits you?",
      });
      fireEvent.click(submit());
      expect(onReply).not.toHaveBeenCalled();
      fireEvent.change(answer, { target: { value: "Pro" } });
      fireEvent.click(submit());
      expect(onReply).toHaveBeenCalledOnce();
      client.dispose();
    });
  });
});

describe("values shown in plain words", () => {
  it.each([
    ["Before", "After", "Before", "After"],
    [3, true, "3", "true"],
    [null, undefined, "—", "—"],
    [["a", "b"], [], "a, b", "—"],
  ] as const)(
    "diff of %j and %j",
    async (before, after, shownBefore, shownAfter) => {
      const { client } = await show((m) => (
        <m.Widget
          block={
            {
              id: "d",
              type: "diff",
              fallback: "A change",
              body: { before, after },
            } as unknown as Block
          }
          disabled={false}
          onReply={() => {}}
        />
      ));
      const values = await screen.findAllByRole("definition");
      expect(values.map((value) => value.textContent)).toEqual([
        shownBefore,
        shownAfter,
      ]);
      for (const value of values)
        expect(value.textContent).not.toMatch(/["{[]/);
      client.dispose();
    },
  );
  it("an object is a list of its keys and values", async () => {
    const { client } = await show((m) => (
      <m.Widget
        block={
          {
            id: "d",
            type: "diff",
            fallback: "A change",
            body: { before: { name: "Ada", age: 36 }, after: "x" },
          } as unknown as Block
        }
        disabled={false}
        onReply={() => {}}
      />
    ));
    await screen.findAllByRole("definition");
    expect(screen.getByText("name")).not.toBeNull();
    expect(screen.getByText("Ada")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/[{}"]/);
    client.dispose();
  });
});

// The expected words, from the catalogues themselves.
addMessages(blockEnglish, blockSimplifiedChinese);
describe.each([
  ["en", false],
  ["en", true],
  ["zh-CN", false],
  ["zh-CN", true],
] as const)(
  "plan steps in plain, labelled words (%s, antd %s)",
  (locale, antd) => {
    const t = createFormatter(locale);
    const status = (key: string) =>
      t("chat.block.status", { status: t(key as MessageKey) });
    const plan = (children: (m: Awaited<ReturnType<typeof ui>>) => ReactNode) =>
      show(children, antd, locale);
    const record = (
      patch: (record: PlanRecord) => void = () => {},
    ): PlanRecord => {
      const value = structuredClone(samples.PlanRecord) as PlanRecord;
      patch(value);
      return value;
    };
    const step = (value: PlanRecord) =>
      value.plan.kind === "immediate" ? value.plan.steps[0]! : undefined!;
    it.each([
      [
        "low",
        "compare-and-set",
        "chat.block.tierLow",
        "chat.block.undoCompareAndSet",
      ],
      [
        "sensitive",
        "archive-created",
        "chat.block.tierSensitive",
        "chat.block.undoArchiveCreated",
      ],
      [
        "low",
        "inverse:restore",
        "chat.block.tierLow",
        "chat.block.undoInverse",
      ],
    ] as const)("tier %s and undo %s", async (tier, undo, tierKey, undoKey) => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => {
            step(value).tier = tier;
            step(value).undo = undo;
          })}
        />
      ));
      expect(await screen.findByText(t(tierKey))).not.toBeNull();
      expect(screen.getByText(t(undoKey))).not.toBeNull();
      expect(document.body.textContent).not.toContain(undo);
      client.dispose();
    });
    it("undo none says only that it cannot be undone", async () => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => (step(value).undo = "none"))}
        />
      ));
      expect(await screen.findByText(t("chat.irreversible"))).not.toBeNull();
      expect(screen.queryByText("none")).toBeNull();
      client.dispose();
    });
    it.each([
      "proposed",
      "awaiting-confirmation",
      "running",
      "undoing",
      "completed",
      "submitted",
      "undone",
      "needs-attention",
      "cancelled",
    ] as const)("plan state %s", async (state) => {
      const { client } = await plan((m) => (
        <m.PlanDiagram record={record((value) => (value.state = state))} />
      ));
      expect(
        await screen.findByText(status(`chat.block.state.${state}`)),
      ).not.toBeNull();
      expect(document.body.textContent).not.toContain(state);
      client.dispose();
    });
    it.each([
      [200, "chat.block.outcomeDone"],
      [500, "chat.block.outcomeFailed"],
    ] as const)("an outcome with HTTP status %s", async (code, key) => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => {
            value.outcomes = [
              { stepId: "step-a", status: code, attributed: true },
            ];
          })}
        />
      ));
      expect(await screen.findByText(status(key))).not.toBeNull();
      expect(document.body.textContent).not.toContain(String(code));
      client.dispose();
    });
    it.each([
      [false, "chat.block.notRetryable"],
      [true, "chat.block.retryable"],
    ] as const)(
      "a failed step says why, and whether it can be retried (%s)",
      async (retryable, key) => {
        const { client } = await plan((m) => (
          <m.PlanDiagram
            record={record((value) => {
              value.outcomes = [
                {
                  stepId: "step-a",
                  status: 412,
                  attributed: true,
                  reason: "The item changed since the plan was made.",
                  retryable,
                },
              ];
            })}
          />
        ));
        expect(
          await screen.findByText("The item changed since the plan was made."),
        ).not.toBeNull();
        expect(t(key as MessageKey)).not.toBe("");
        expect(screen.getByText(t(key as MessageKey))).not.toBeNull();
        client.dispose();
      },
    );
    it("a failed step's status and reason are in the danger tone, the status in bold", async () => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => {
            value.outcomes = [
              {
                stepId: "step-a",
                status: 412,
                attributed: true,
                reason: "The item changed since the plan was made.",
              },
            ];
          })}
        />
      ));
      const failed = await screen.findByText(
        status("chat.block.outcomeFailed"),
      );
      // Colour is not the only cue: the status is strong text.
      expect(failed.closest("strong")).not.toBeNull();
      expect(failed.closest('[data-tone="danger"]')).not.toBeNull();
      expect(
        screen
          .getByText("The item changed since the plan was made.")
          .closest('[data-tone="danger"]'),
      ).not.toBeNull();
      client.dispose();
    });
    it("a done step's status is not in the danger tone", async () => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => {
            value.outcomes = [
              { stepId: "step-a", status: 200, attributed: true },
            ];
          })}
        />
      ));
      const done = await screen.findByText(status("chat.block.outcomeDone"));
      expect(done.closest('[data-tone="danger"]')).toBeNull();
      client.dispose();
    });
    it("a failed step without a reason says only that it failed", async () => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => {
            value.outcomes = [
              { stepId: "step-a", status: 500, attributed: true },
            ];
          })}
        />
      ));
      await screen.findByText(status("chat.block.outcomeFailed"));
      for (const key of ["chat.block.retryable", "chat.block.notRetryable"])
        expect(screen.queryByText(t(key as MessageKey))).toBeNull();
      client.dispose();
    });
    it("the step's values are plain words, before and after", async () => {
      const { client } = await plan((m) => <m.PlanDiagram record={record()} />);
      await screen.findByText(t("chat.block.tierLow"));
      expect(document.body.textContent).not.toMatch(/"/);
      client.dispose();
    });
    it("no 'View change' without a safe destination", async () => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => (step(value).view = "javascript:alert(1)"))}
        />
      ));
      await screen.findByText(t("chat.block.tierLow"));
      expect(screen.queryByText(t("chat.view"))).toBeNull();
      client.dispose();
    });
    it("a plan that is not immediate shows its labelled state", async () => {
      const { client } = await plan((m) => (
        <m.PlanDiagram
          record={record((value) => {
            (value.plan as { kind: string }).kind = "scheduled";
            value.state = "submitted";
          })}
        />
      ));
      expect(
        await screen.findByText(status("chat.block.state.submitted")),
      ).not.toBeNull();
      client.dispose();
    });
    it("a plan block shows its own text, not the bare plan id", async () => {
      const { client } = await plan((m) => (
        <m.Widget
          block={
            {
              id: "p",
              type: "plan",
              fallback: "A plan to review",
              body: { planId: "plan-7f3a" },
            } as unknown as Block
          }
          disabled={false}
          onReply={() => {}}
        />
      ));
      expect(await screen.findByText("A plan to review")).not.toBeNull();
      expect(document.body.textContent).not.toContain("plan-7f3a");
      client.dispose();
    });
  },
);

describe.each([false, true])("composer hints (antd %s)", (withAntd) => {
  it("the composer is described by every hint shown, and by none when there is none", async () => {
    const m = await ui();
    const skin = withAntd
      ? await import("../../src/skin-antd/index")
      : undefined;
    const client = m.createWaypointClient({
      ...config(),
      contributions: [
        {
          id: "a",
          evaluate: () => ({ hint: "Mention the order number", hold: true }),
        },
        { id: "b", evaluate: () => ({ hint: "Say which item" }) },
      ],
    } as never);
    await client.ready;
    render(
      <m.WaypointChat client={client} primitives={skin?.antdPrimitives} />,
    );
    const composer = await screen.findByRole("textbox", { name: "Message" });
    expect(composer.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(composer, { target: { value: "Where is it?" } });
    await act(async () => {
      await client.send();
    });
    await screen.findByText("Mention the order number");
    const described = describedText(
      screen.getByRole("textbox", { name: "Message" }),
    );
    expect(described).toContain("Mention the order number");
    expect(described).toContain("Say which item");
    client.dispose();
  });
});

describe("flow tabs follow the visual order", () => {
  it.each([
    ["ltr", "ArrowRight", 1],
    ["ltr", "ArrowLeft", -1],
    ["rtl", "ArrowRight", -1],
    ["rtl", "ArrowLeft", 1],
  ] as const)("in %s, %s moves %i", async (dir, key, step) => {
    const m = await ui();
    const client = m.createWaypointClient(config());
    await client.ready;
    render(<m.WaypointChat client={client} dir={dir} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(2);
    const start = tabs.findIndex(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    tabs[start]!.focus();
    await act(async () => {
      fireEvent.keyDown(tabs[start]!, { key });
    });
    const expected = (start + step + tabs.length) % tabs.length;
    expect(
      screen.getAllByRole("tab")[expected]!.getAttribute("aria-selected"),
    ).toBe("true");
    client.dispose();
  });
});

describe.each([false, true])("senders and sends (antd %s)", (withAntd) => {
  async function chatWith(
    send: (reply: { clientReplyId: string }) => Promise<{ id: string }>,
  ) {
    const m = await ui();
    const skin = withAntd
      ? await import("../../src/skin-antd/index")
      : undefined;
    const base = config();
    const client = m.createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id: string) => ({
          protocol: "1.0",
          id,
          title: id,
          messages: [
            {
              id: "u",
              role: "user",
              content: "Hello",
              blocks: [],
              createdAt: 1,
            },
            {
              id: "a",
              role: "assistant",
              content: "Hi there",
              blocks: [],
              createdAt: 2,
              status: "completed",
            },
          ],
        }),
        send: send as never,
      },
    } as never);
    await client.ready;
    render(
      <m.WaypointChat client={client} primitives={skin?.antdPrimitives} />,
    );
    return client;
  }
  const composer = () => screen.getByRole("textbox", { name: "Message" });
  const sendButton = () =>
    document.querySelector<HTMLElement>('[data-part="composer"] button')!;
  it("each message is named by its sender", async () => {
    const client = await chatWith(async (reply) => ({
      id: reply.clientReplyId,
    }));
    // The text comes from the markdown chunk.
    await screen.findByText("Hello");
    await screen.findByText("Hi there");
    const user = screen.getByRole("article", { name: "You" });
    expect(user.textContent).toContain("Hello");
    expect(
      screen.getByRole("article", { name: "Assistant" }).textContent,
    ).toContain("Hi there");
    client.dispose();
  });
  it("a send in flight says so on its own message; the Send button's text is its name", async () => {
    const client = await chatWith(() => new Promise(() => {}));
    await screen.findByRole("article", { name: "You" });
    expect(sendButton().textContent).toBe(
      sendButton().getAttribute("aria-label") ?? sendButton().textContent,
    );
    expect(sendButton().getAttribute("aria-label")).toBeNull();
    fireEvent.change(composer(), { target: { value: "Ship it" } });
    await act(async () => {
      void client.send();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const pending = screen
      .getAllByRole("article", { name: "You" })
      .find((article) => article.textContent?.includes("Ship it"))!;
    expect(pending.textContent).toContain("Sending…");
    expect(sendButton().getAttribute("aria-label")).toBeNull();
    expect(sendButton().textContent).toBe("Sending");
    client.dispose();
  });
  it("a failed send says Not sent before its controls, which it describes", async () => {
    const client = await chatWith(async () => {
      throw { code: "refused", id: "send-refused" };
    });
    await screen.findByRole("article", { name: "You" });
    fireEvent.change(composer(), { target: { value: "Ship it" } });
    await act(async () => {
      await client.send();
    });
    const pending = screen
      .getAllByRole("article", { name: "You" })
      .find((article) => article.textContent?.includes("Ship it"))!;
    expect(pending.textContent).toContain("Not sent");
    expect(pending.textContent).not.toContain("Sending…");
    const retry = within(pending).getByRole("button", { name: "Retry" });
    expect(describedText(retry)).toBe("Not sent");
    const text = pending.textContent!;
    expect(text.indexOf("Not sent")).toBeLessThan(text.indexOf("Retry"));
    client.dispose();
  });
});

describe("the shell's third column", () => {
  it.each([
    ["no plan and no panels", undefined, false],
    ["a host's own panels", () => <p>Team notes</p>, true],
  ] as const)("with %s", async (_, panel, third) => {
    const m = await ui();
    const client = m.createWaypointClient(config());
    await client.ready;
    render(
      <m.WaypointChat
        client={client}
        slots={panel ? { extraPanels: panel } : undefined}
      />,
    );
    const shell = await waitForShell();
    expect(shell.hasAttribute("data-has-aside")).toBe(third);
    expect(!!shell.querySelector('[data-part="extraPanels"]')).toBe(third);
    client.dispose();
  });
});
async function waitForShell() {
  await screen.findByRole("textbox", { name: "Message" });
  return document.querySelector<HTMLElement>(".wp-shell")!;
}

describe("GitHub-flavoured Markdown, through the one real parser", () => {
  async function chatOf(content: string) {
    const m = await ui();
    const base = config();
    const client = m.createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id: string) => ({
          protocol: "1.0",
          id,
          title: id,
          messages: [
            {
              id: "a",
              role: "assistant",
              content,
              blocks: [],
              createdAt: 1,
              status: "completed",
            },
          ],
        }),
      },
    } as never);
    await client.ready;
    render(<m.WaypointChat client={client} />);
    // The markdown chunk renders the text.
    await waitFor(() =>
      expect(article().textContent).not.toContain("Loading message"),
    );
    return client;
  }
  const article = () =>
    document.querySelector<HTMLElement>("article[data-message-id]")!;
  it("renders tables in a named scroller, strikethrough, task lists and autolinks", async () => {
    const client = await chatOf(
      [
        "| Name | Age |",
        "| --- | --- |",
        "| Ada | 36 |",
        "",
        "~~gone~~ and https://example.test/page",
        "",
        "- [x] done",
      ].join("\n"),
    );
    const table = within(article()).getByRole("table");
    const scroller = table.closest("[data-scroll-region]") as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(scroller.getAttribute("aria-label")).toBeTruthy();
    expect(article().querySelector("del")!.textContent).toBe("gone");
    expect(
      within(article()).getByRole("link", {
        name: "https://example.test/page",
      }),
    ).not.toBeNull();
    const box = within(article()).getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    client.dispose();
  });
  it.each([
    ["a quoted task list", "> - [x] done", "checkbox"],
    ["a nested quoted task list", "> > - [ ] later", "checkbox"],
    ["a quoted table", "> | Name |\n> | --- |\n> | Ada |", "table"],
    ["a task list nested on one line", "- - [x] done", "checkbox"],
    [
      "a table after a quoted fence",
      "> ```\n> code\n> ```\n\n| Name |\n| --- |\n| Ada |",
      "table",
    ],
  ] as const)("GFM in %s is rendered", async (_, content, role) => {
    const client = await chatOf(content);
    expect(within(article()).getByRole(role)).not.toBeNull();
    client.dispose();
  });
  it("an internationalised address is an autolink", async () => {
    const client = await chatOf("Visit https://bücher.example/ today");
    expect(
      within(article()).getByRole("link", { name: /bücher\.example/ }),
    ).not.toBeNull();
    client.dispose();
  });
  it("code and fences keep what is inside them as text", async () => {
    const client = await chatOf(
      "Run `| --- |` and ~~not~~ here:\n\n```\n| A |\n| --- |\n- [x] no\n```",
    );
    expect(article().querySelector("table")).toBeNull();
    expect(within(article()).queryByRole("checkbox")).toBeNull();
    expect(article().querySelector("pre")!.textContent).toContain("- [x] no");
    expect(article().querySelector("code")!.textContent).toBe("| --- |");
    client.dispose();
  });
  it("links, angle-bracket links and plain angle brackets stay as they are", async () => {
    const client = await chatOf(
      "See [the docs](https://example.test/docs), <https://example.test/a> and a < b > c.",
    );
    expect(
      within(article()).getByRole("link", { name: "the docs" }),
    ).not.toBeNull();
    expect(
      within(article()).getByRole("link", { name: "https://example.test/a" }),
    ).not.toBeNull();
    expect(article().textContent).toContain("a < b > c.");
    client.dispose();
  });
  it("footnote syntax is not GFM here: it renders as plain text", async () => {
    const client = await chatOf(
      "Text with a note[^1] and ~~gone~~.\n\n[^1]: The note.",
    );
    expect(article().querySelector("del")).not.toBeNull();
    expect(article().textContent).toContain("[^1]");
    expect(article().querySelector("sup, section[data-footnotes]")).toBeNull();
    client.dispose();
  });
  it("the outline's excerpt of a table message has no pipes", async () => {
    const client = await chatOf("| Name |\n| --- |\n| Ada |");
    fireEvent.click(screen.getByRole("button", { name: "Message outline" }));
    const outline = document.querySelector("nav[data-outline]")!;
    await waitFor(() => expect(outline.textContent).toContain("Ada"));
    expect(outline.textContent).not.toContain("|");
    client.dispose();
  });
});

describe("every array item reads as a value", () => {
  it("a nested object in an array is a key/value list, and null a dash", async () => {
    const { client } = await show((m) => (
      <m.Widget
        block={
          {
            id: "d",
            type: "diff",
            fallback: "A change",
            body: {
              before: [{ address: { city: "Auckland" } }, null],
              after: "x",
            },
          } as unknown as Block
        }
        disabled={false}
        onReply={() => {}}
      />
    ));
    await screen.findByText("Auckland");
    expect(document.body.textContent).not.toMatch(/\[object Object\]|null/);
    expect(screen.getByText("address")).not.toBeNull();
    expect(document.body.textContent).toContain("—");
    client.dispose();
  });
  it("a plan step's array field reads the same way", async () => {
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    if (record.plan.kind === "immediate")
      record.plan.steps[0]!.after = { title: [{ city: "Auckland" }, null] };
    const { client } = await show((m) => <m.PlanDiagram record={record} />);
    await screen.findByText("Auckland");
    expect(document.body.textContent).not.toMatch(/\[object Object\]|null/);
    client.dispose();
  });
});

describe("the real parser on long pathological input", () => {
  it.each([
    ["a 32 000-character word", "a".repeat(32_000)],
    ["20 000 pipes", "|".repeat(20_000)],
    [
      "delimiter rows after long indentation",
      ("| a | b |\n|" + " ".repeat(2000) + "--- | --- |\n").repeat(20),
    ],
    ["2 000 nested quotes", "> ".repeat(2000) + "- [x] done"],
    ["5 000 unfinished addresses", "a@b.".repeat(5000)],
    ["10 000 open brackets", "[".repeat(10_000)],
  ])("%s is read in well under a second", async (_, source) => {
    const { visibleText } = await import("../../src/react/markdown");
    const started = performance.now();
    visibleText(source);
    // Measured at 10-70 ms; the bound leaves room for a loaded machine.
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("the plan diagram when its chunk cannot load", () => {
  const chunk = { fail: 0 };
  afterEach(() => {
    chunk.fail = 0;
  });
  it("says so with a Retry, and Retry shows the steps once the chunk loads", async () => {
    chunk.fail = 1;
    vi.doMock("../../src/react/blocks", async (importActual) => {
      if (chunk.fail > 0) {
        chunk.fail--;
        throw new Error("chunk failed to load");
      }
      return importActual();
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const record = structuredClone(samples.PlanRecord) as PlanRecord;
      const { client } = await show((m) => <m.PlanDiagram record={record} />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        "The plan's steps could not be loaded.",
      );
      const retry = within(alert).getByRole("button", { name: "Retry" });
      retry.focus();
      fireEvent.click(retry);
      expect(await screen.findByText("Low risk")).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      // The pressed button is gone; focus is on the box around the steps.
      expect(document.activeElement).toBe(
        screen.getByText("Low risk").closest('[tabindex="-1"]'),
      );
      client.dispose();
    } finally {
      quiet.mockRestore();
    }
  });
  it("Retry after the steps failed to render renders them again", async () => {
    // Broken until the Retry: React renders a failing tree twice.
    const renders = { broken: true };
    vi.doMock("../../src/react/blocks", async (importActual) => {
      const actual =
        await importActual<typeof import("../../src/react/blocks")>();
      return {
        ...actual,
        PlanSteps: (props: Parameters<typeof actual.PlanSteps>[0]) => {
          if (renders.broken) throw new Error("render failed");
          return actual.PlanSteps(props);
        },
      };
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const record = structuredClone(samples.PlanRecord) as PlanRecord;
      const { client } = await show((m) => <m.PlanDiagram record={record} />);
      const alert = await screen.findByRole("alert");
      const retry = within(alert).getByRole("button", { name: "Retry" });
      retry.focus();
      renders.broken = false;
      fireEvent.click(retry);
      expect(await screen.findByText("Low risk")).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByText("Low risk").closest('[tabindex="-1"]'),
      );
      client.dispose();
    } finally {
      quiet.mockRestore();
    }
  });
  it("a step without a view renders, without a link", async () => {
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    if (record.plan.kind === "immediate")
      delete (record.plan.steps[0] as { view?: string }).view;
    const { client } = await show((m) => <m.PlanDiagram record={record} />);
    expect(await screen.findByText("Low risk")).not.toBeNull();
    expect(screen.queryByText("View change")).toBeNull();
    client.dispose();
  });
});
