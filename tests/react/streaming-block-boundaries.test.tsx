// @vitest-environment jsdom
// A reply being written is split into blocks so that only the open one is
// parsed again on each frame. A block may be kept only once CommonMark
// guarantees that no later text can change it: while a code fence is open,
// nothing after its opening line is kept, and a fence closes only on the
// same character, at least as long, with nothing after it but spaces or
// tabs (CommonMark 0.31.2, 4.5 "Fenced code blocks").
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import Markdown, {
  blockStarts,
  closeOpenMarkdown,
} from "../../src/react/markdown";
import gfm from "../../src/react/gfm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
// Reduced motion shows all of the text given at once, so each render
// shows exactly the chunks streamed so far, still as a reply being written.
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("reduce"),
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});

// Markup with the whitespace between elements and the fade mark dropped:
// separately parsed blocks have no newline text between them.
const normal = (html: string) =>
  html.replace(/ data-fade=""/g, "").replace(/>\s+</g, "><");

const oneShot = (text: string) => {
  const { container, unmount } = render(<Markdown text={text} />);
  const html = normal(container.innerHTML);
  unmount();
  return html;
};

// Streams the text in the given chunks into one mounted renderer and
// returns each render's markup, after each chunk.
function stream(chunks: readonly string[]) {
  const renders: { text: string; html: string; element: HTMLElement }[] = [];
  let text = "";
  const { container, rerender, unmount } = render(<Markdown text="" writing />);
  for (const chunk of chunks) {
    text += chunk;
    rerender(<Markdown text={text} writing />);
    renders.push({
      text,
      html: normal(container.innerHTML),
      element: container.cloneNode(true) as HTMLElement,
    });
  }
  unmount();
  return renders;
}

const byLine = (text: string) => text.split(/(?<=\n)/);
const byCharacter = (text: string) => [...text];

const probes: Record<string, string> = {
  readmeInFourBackticks:
    "Here is a README:\n\n````md\n# Tool\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nRun it with `npm start`.\n````\n\nThat is all.\n",
  fourBacktickFence:
    "````md\n```js\nx()\n```\n\nstill inside the outer fence\n````\n\nDone.\n",
  fenceInfoLineInside: "```\ncode\n```python\n\nstill code\n```\n\nafter\n",
  tildeVsBacktick: "~~~\n```\n\nstill tilde code\n~~~\n\nafter\n",
  // A definition applies to the whole text, before it and after it.
  definitionsAtEnd:
    'See [the docs][d] and [Other].\n\nNext [d].\n\n[d]: https://example.com/docs "The title"\n[other]: </a b&amp;c\\>>\n',
  definitionInQuote: "See [x].\n\n> [x]: https://example.com/x\n\nafter [x]\n",
  firstDefinitionWins:
    "[a]: https://one.example\n\nUse [a].\n\n[A]: https://two.example\n\nAgain [a].\n",
  escapedAndFoldedLabels:
    'Use [a\\]b], [Foo  Bar] and [STRASSE].\n\n[a\\]b]: /x\\<y\n[foo\nbar]: /z "say \\"hi\\" &amp; go"\n[straße]: /s\n',
  definitionInList: "- [l]: https://example.com/l\n- item [l]\n\nafter [l]\n",
  titleOnNextLine:
    'Use [t].\n\n[t]: https://example.com/t\n  "title on its own line"\n\nend [t]\n',
};

for (const [name, text] of Object.entries(probes)) {
  it(`streams ${name} as re-parsing all of it would, at every line`, () => {
    for (const { text: shown, html } of stream(byLine(text)))
      expect(html, JSON.stringify(shown)).toBe(
        oneShot(closeOpenMarkdown(shown)),
      );
  });
  it(`streams ${name} to the one-shot render, character by character`, () => {
    const renders = stream(byCharacter(text));
    expect(renders.at(-1)!.html).toBe(oneShot(text));
  });
}

it("keeps no block that starts after an open fence's opening line", () => {
  const text = probes.readmeInFourBackticks!;
  // Up to the outer fence's closing line, the open block is the fence.
  const open = text.indexOf("````md");
  const close = text.indexOf("````\n\nThat");
  for (let at = open; at < close; at++)
    expect(blockStarts(text.slice(0, at)).starts.at(-1)).toBeLessThanOrEqual(
      open,
    );
});

it("closes an open fence with its own character and length", () => {
  expect(closeOpenMarkdown("````md\n```js\nx\n```\n")).toBe(
    "````md\n```js\nx\n```\n\n````",
  );
  expect(closeOpenMarkdown("~~~\n```\nx")).toBe("~~~\n```\nx\n~~~");
  // A closing fence takes no info string; a backtick opener takes no
  // backtick in its info string, so it opens nothing.
  expect(closeOpenMarkdown("```\nx\n```py\n")).toBe("```\nx\n```py\n\n```");
  expect(closeOpenMarkdown("``` a`b\nx")).toBe("``` a`b\nx");
  expect(closeOpenMarkdown("~~~~\nx\n~~~~~  \n")).toBe("~~~~\nx\n~~~~~  \n");
  // What a closed fence held is no paragraph of open markers.
  expect(closeOpenMarkdown("Text\n```\n~~~ ** `\n```\n")).toBe(
    "Text\n```\n~~~ ** `\n```\n",
  );
});

it("an HTML comment across blank lines shows nothing it holds while written", () => {
  const text = "Before.\n\n<!--\n\nhidden words\n\n-->\n\nAfter.\n";
  for (const { text: shown, element } of stream(byCharacter(text)))
    expect(element.textContent, JSON.stringify(shown)).not.toContain(
      "hidden words",
    );
});

it("a reference resolves as soon as its definition arrives", () => {
  const text =
    "See [the docs][d].\n\nNext para.\n\n[d]: https://example.com/docs\n";
  const renders = stream(byLine(text));
  expect(renders.at(-1)!.html).toBe(oneShot(text));
  expect(renders.at(-1)!.element.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.com/docs",
  );
});

// A seeded generator of replies, so a failure is reproducible.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Prose words are marked Kp…q, code lines Kc…q and hidden words Kh…q, so
// each intermediate render can say where every one of them landed.
function reply(next: () => number) {
  let n = 0;
  const pick = <T,>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)]!;
  const prose = () => `Kp${n++}q`;
  const code = () => `Kc${n++}q`;
  const fence = (inner: boolean): string => {
    const character = pick(["`", "~"]);
    const length = 3 + Math.floor(next() * 3);
    const opener = character.repeat(length);
    const lines: string[] = [];
    for (let line = 0; line < 2 + Math.floor(next() * 4); line++)
      lines.push(
        pick([
          code(),
          "",
          `${code()} \`x\` **y**`,
          // Fence-like lines that do not close this fence.
          `${(character === "`" ? "~" : "`").repeat(length + 1)}`,
          `${opener}python`,
          ...(length > 3 ? [character.repeat(length - 1)] : []),
          ...(inner && length > 3
            ? [
                `${character.repeat(3)}js\n${code()}\n\n${code()}\n${character.repeat(3)}`,
              ]
            : []),
        ]),
      );
    const closer = opener + character.repeat(Math.floor(next() * 2));
    return `${opener}${pick(["", "md", "js"])}\n${lines.join("\n")}\n${closer}`;
  };
  const blocks: string[] = [];
  const uses: string[] = [];
  const definitions: string[] = [];
  for (let block = 0; block < 3 + Math.floor(next() * 7); block++)
    blocks.push(
      pick([
        () => `${prose()} with **bold** and \`inline\` words.`,
        () => `## ${prose()} heading`,
        () => `- ${prose()} item\n- ${prose()} item`,
        () => `1. ${prose()}\n\n2. ${prose()}\n\n   ${prose()}`,
        () => `> ${prose()} quoted\n> ${prose()}`,
        () => `| ${prose()} | b |\n| - | - |\n| ${prose()} | d |`,
        () => `${prose()} before code.\n\n    ${code()}\n\n    ${code()}`,
        () => `<!--\n\nKh${n++}q\n\n-->`,
        // A lazy continuation line, a setext heading in both forms, and
        // list items continued at their own indent after blank lines.
        () => `> ${prose()} quoted\n${prose()} lazy\n> ${prose()}`,
        () => `${prose()} title\n${prose()} more\n=====`,
        () => `${prose()}\n\n${prose()} title\n---`,
        () => `- ${prose()}\n\n  ${prose()} continued\n\n- ${prose()}`,
        () => `- ${prose()}\n\n\n  ${prose()} still`,
        // HTML blocks of type 1 and type 6, across blank lines.
        () => `<pre>\n\nKc${n++}q *b*\n\n</pre>`,
        () => `<div>\n*${prose()}*\n\n</div>`,
        // A definition inside a block quote applies everywhere.
        () => {
          const label = `q${n++}`;
          uses.push(`${label}-quoted`);
          return `> [${label}-quoted]: https://example.com/q\n\n${prose()} [${label}-quoted].`;
        },
        () => fence(false),
        () => fence(true),
        () => {
          const label = `r${n++}`;
          uses.push(label);
          return `${prose()} [a link][${label}] here.`;
        },
      ])(),
    );
  for (const label of uses)
    definitions.push(`[${label}]: https://example.com/${label}`);
  if (definitions.length) blocks.push(definitions.join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

function chunked(text: string, next: () => number) {
  const chunks: string[] = [];
  for (let at = 0; at < text.length;) {
    const size = 1 + Math.floor(next() * 24);
    chunks.push(text.slice(at, at + size));
    at += size;
  }
  return chunks;
}

// Where each top-level block of the whole text starts, from its line.
const boundaries = (text: string) => {
  const processor = unified().use(remarkParse).use(gfm);
  const tree = processor.parse(text);
  return new Set(
    tree.children.map(
      (child) => text.lastIndexOf("\n", child.position!.start.offset! - 1) + 1,
    ),
  );
};

it("streams random replies to the one-shot render, code always in code", () => {
  for (let seed = 1; seed <= 150; seed++) {
    const next = random(seed);
    const text = reply(next);
    const chunks = chunked(text, next);
    const renders = stream(chunks);
    const label = `seed ${seed}: ${JSON.stringify(text)}`;
    expect(renders.at(-1)!.html, label).toBe(oneShot(text));
    for (const { text: shown, element } of renders) {
      const at = `${label} at ${shown.length}`;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const inCode = !!node.parentElement?.closest("pre");
        for (const [token] of (node.nodeValue ?? "").matchAll(/K[cph]\d+q/g)) {
          expect(token.startsWith("Kh"), `${at}: ${token}`).toBe(false);
          expect(inCode, `${at}: ${token}`).toBe(token.startsWith("Kc"));
        }
      }
    }
    // A kept block starts where one starts in the whole text.
    const whole = boundaries(text);
    let state: ReturnType<typeof blockStarts> | undefined;
    for (const { text: shown } of renders) {
      state = blockStarts(shown, state);
      for (const start of state.starts.slice(0, -1))
        expect(whole.has(start), `${label}: kept ${start}`).toBe(true);
    }
  }
}, 120_000);
