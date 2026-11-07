import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkParse from "remark-parse";
import { unified } from "unified";
import gfm from "./gfm";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { isSafeUrl } from "./urls";
import type { Source } from "../protocol/generated";
export interface MarkdownImagePolicy {
  origin?: string;
  allow?: (url: string) => boolean;
}
// Whether the renderer below shows an image as an image (its alt text is
// then not visible) rather than as a link labelled with its alt text.
function showsImage(
  src: string,
  images?: MarkdownImagePolicy,
  extraSchemes?: readonly string[],
): boolean {
  let sameOrigin = false;
  if (images?.origin) {
    try {
      sameOrigin =
        new URL(src, images.origin).origin === new URL(images.origin).origin;
    } catch {
      sameOrigin = false;
    }
  }
  return (
    isSafeUrl(src, extraSchemes) &&
    (sameOrigin || Boolean(images?.allow?.(src)))
  );
}
interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}
const BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "tableCell",
  "code",
]);
/**
 * The text a message rendered by this renderer visibly shows: raw HTML is
 * skipped as the renderer skips it, and comments, reference definitions
 * and link or image destinations are never part of it.
 */
export function visibleText(
  source: string,
  policy: {
    images?: MarkdownImagePolicy;
    extraSchemes?: readonly string[];
  } = {},
): string {
  // The same grammar as the renderer: CommonMark with the supported GFM.
  const processor = unified().use(remarkParse).use(gfm);
  const tree = processor.runSync(processor.parse(source)) as MdastNode;
  // A reference is rendered with its definition's destination (the first
  // definition of a normalized label wins), so it follows the same policy.
  const definitions = new Map<string, string>();
  const collect = (node: MdastNode) => {
    if (
      node.type === "definition" &&
      node.identifier !== undefined &&
      !definitions.has(node.identifier)
    )
      definitions.set(node.identifier, node.url ?? "");
    for (const child of node.children ?? []) collect(child);
  };
  collect(tree);
  // The renderer normalizes a destination before it decides on it (as
  // mdast-util-to-hast does with this same function), so the projection
  // decides on the same normalized form.
  const imageAlt = (node: MdastNode, url: string | undefined) => {
    const src = url ? normalizeUri(url) : undefined;
    if (!src || !showsImage(src, policy.images, policy.extraSchemes))
      parts.push(node.alt ?? "");
  };
  const parts: string[] = [];
  const walk = (node: MdastNode) => {
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "code":
        parts.push(node.value ?? "");
        break;
      case "html":
      case "definition":
      case "footnoteDefinition":
        return;
      case "image":
        imageAlt(node, node.url);
        return;
      case "imageReference":
        imageAlt(node, definitions.get(node.identifier ?? ""));
        return;
      case "break":
        parts.push(" ");
        return;
      default:
        for (const child of node.children ?? []) walk(child);
    }
    if (BLOCKS.has(node.type)) parts.push(" ");
  };
  walk(tree);
  return parts.join("").replace(/\s+/g, " ").trim();
}
// A line that may open or close a code fence (CommonMark 0.31.2, 4.5
// "Fenced code blocks", https://spec.commonmark.org/0.31.2/#fenced-code-blocks):
// up to three spaces, then three or more of one fence character.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * The fence still open at the end of the text, if any, and where the text
 * after the last closed fence starts. A backtick opener's info string holds
 * no backtick; a fence closes only on a line of the same character, at
 * least as long, with nothing after it but spaces or tabs.
 */
function fences(text: string): { open?: string; after: number } {
  let open: string | undefined;
  let after = 0;
  let at = 0;
  for (const line of text.split("\n")) {
    at += line.length + 1;
    const match = FENCE_LINE.exec(line.replace(/\r$/, ""));
    if (!match) continue;
    const fence = match[1]!;
    const rest = match[2]!;
    if (open === undefined) {
      if (fence[0] !== "`" || !rest.includes("`")) open = fence;
    } else if (
      fence[0] === open[0] &&
      fence.length >= open.length &&
      /^[ \t]*$/.test(rest)
    ) {
      open = undefined;
      after = at;
    }
  }
  return { open, after };
}

/**
 * Closes, for display, what a reply still being written has opened and not
 * yet closed: a code fence, with its own character and length, or `**`,
 * `~~` and `` ` `` in its last paragraph. The text itself is never changed.
 */
export function closeOpenMarkdown(text: string): string {
  const { open, after } = fences(text);
  if (open !== undefined) return `${text}\n${open}`;
  // The last paragraph starts after a blank line or a closed fence; escaped
  // characters close nothing.
  const last = text
    .slice(Math.max(text.lastIndexOf("\n\n") + 1, after))
    .replace(/\\./g, "");
  if ((last.match(/`/g) ?? []).length % 2) return `${text}\``;
  const outside = last.replace(/`[^`]*`/g, "");
  let closing = "";
  for (const marker of ["**", "~~"])
    if ((outside.split(marker).length - 1) % 2) closing = marker + closing;
  return text + closing;
}

// How much of the text still to show one frame of the reveal reads.
const REVEAL_WINDOW = 4096;
// One word segmenter per language, made on first use.
const segmenters = new Map<string, Intl.Segmenter>();
/**
 * Where the next animation frame of a reply being written shows it up to:
 * past whole words only, more of them the further the display is behind,
 * so it keeps up without showing single characters. Word boundaries come
 * from `Intl.Segmenter`, in the chat's language.
 */
export function nextReveal(text: string, from: number, lang?: string): number {
  if (from >= text.length) return text.length;
  let segmenter = segmenters.get(lang ?? "");
  if (!segmenter)
    segmenters.set(
      lang ?? "",
      (segmenter = new Intl.Segmenter(lang, { granularity: "word" })),
    );
  // Only a window of what is still to show is read, so a frame costs the
  // same however far behind the display is.
  const until = Math.min(text.length, from + REVEAL_WINDOW);
  const segments = [...segmenter.segment(text.slice(from, until))];
  const words = segments.filter((segment) => segment.isWordLike).length;
  let wanted = Math.max(1, Math.floor(words / 8));
  // Up to the end of the last whole word; what follows the last word (a
  // full stop, a space) comes with the rest.
  let at = from;
  for (const segment of segments)
    if (segment.isWordLike) {
      const end = from + segment.index + segment.segment.length;
      // A word at the very end may still be arriving, and one at the end of
      // the window may go on past it: either waits.
      if (end === until) break;
      at = end;
      if (--wanted === 0) return at;
    }
  return at;
}
// How long a last word waits for the rest of it.
const HOLD_MS = 400;
const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
// The part of a reply being written that is shown so far: it grows a few
// words per animation frame, and is the whole text once the reply ends or
// under reduced motion.
function useReveal(text: string, live: boolean, lang?: string) {
  const [count, setCount] = useState(() =>
    live ? nextReveal(text, 0, lang) : text.length,
  );
  const shown = useRef("");
  // Text that no longer continues what was shown starts again.
  const at = !live
    ? text.length
    : text.startsWith(shown.current)
      ? Math.min(count, text.length)
      : 0;
  shown.current = text.slice(0, at);
  useEffect(() => {
    if (!live || at >= text.length) return;
    const next = nextReveal(text, at, lang);
    // Only a last word that may still be arriving is left: it shows once
    // no more text has come for a moment, so a stalled reply hides none.
    if (next === at) {
      const wait = setTimeout(() => setCount(text.length), HOLD_MS);
      return () => clearTimeout(wait);
    }
    const frame = requestAnimationFrame(() => setCount(next));
    return () => cancelAnimationFrame(frame);
  }, [live, at, text, lang]);
  return shown.current;
}
// The property that marks a citation link; raw HTML is skipped, so only
// the plugin below can set it.
const CITE = "dataWpCite";
// Nodes whose text is never a citation: code, and a link's own text.
const NOT_CITED = new Set(["inlineCode", "code", "link", "linkReference"]);
/**
 * Turns `[n]` in the text of a reply into a link to its source n, when that
 * source may be opened. Only text nodes are read, so code and the text of a
 * link are left as written.
 */
function citations(options: {
  sources: readonly Source[];
  safe: (source: Source) => boolean;
}) {
  const { sources, safe } = options;
  const split = (value: string): MdastNode[] => {
    const nodes: MdastNode[] = [];
    let from = 0;
    for (const match of value.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      const source = sources[n - 1];
      if (!source || !safe(source)) continue;
      if (match.index > from)
        nodes.push({ type: "text", value: value.slice(from, match.index) });
      nodes.push({
        type: "link",
        url: source.url,
        children: [{ type: "text", value: match[0] }],
        data: { hProperties: { [CITE]: n } },
      });
      from = match.index + match[0].length;
    }
    if (!nodes.length) return [{ type: "text", value }];
    if (from < value.length)
      nodes.push({ type: "text", value: value.slice(from) });
    return nodes;
  };
  const walk = (node: MdastNode) => {
    if (NOT_CITED.has(node.type) || !node.children) return;
    node.children = node.children.flatMap((child) =>
      child.type === "text" ? split(child.value ?? "") : (walk(child), [child]),
    );
  };
  return (tree: MdastNode) => {
    if (sources.length) walk(tree);
  };
}
interface MarkdownProps {
  text: string;
  /** The reply's sources, which `[n]` in its text cites. */
  sources?: readonly Source[];
  /** The sources' list name and each citation's name. */
  sourceNames?: {
    list(count: number): string;
    item(index: number, title: string): string;
  };
  /** The chat's language, for the word boundaries of a reply being written. */
  lang?: string;
  /** The reply is still being written: open markers are closed for display. */
  writing?: boolean;
  images?: MarkdownImagePolicy;
  extraSchemes?: readonly string[];
  // The name of a code block's own sideways scroller.
  scrollLabel?: string;
  /**
   * Keeps the finished text's parse: given how to parse it, returns the
   * kept result while the text it was made from is unchanged.
   */
  cached?: (parse: () => ReactNode) => ReactNode;
}
// What the element renderers below read when they render: the props of
// the renderer showing them, so an element made by an earlier render (or
// kept parsed for a message) shows with the current names and policies.
const Current = createContext<MarkdownProps>({ text: "" });
// The element renderers keep one identity for good: new ones would be new
// element types, and React would replace every code block and table
// whenever the chat renders again, dropping the keyboard focus and scroll
// position inside them.
const components: Components = {
  // A code block scrolls inside itself, never the transcript, and can be
  // reached and scrolled by keyboard.
  pre: function Pre({ children }) {
    const { scrollLabel } = useContext(Current);
    return (
      <pre data-scroll-region="" tabIndex={0} aria-label={scrollLabel}>
        {children}
      </pre>
    );
  },
  // A table scrolls inside itself too, as a named region.
  table: function Table({ children }) {
    const { scrollLabel } = useContext(Current);
    return (
      <div
        data-scroll-region=""
        tabIndex={0}
        role="region"
        aria-label={scrollLabel}
      >
        <table>{children}</table>
      </div>
    );
  },
  img: function Image({ src, alt }) {
    const { images, extraSchemes } = useContext(Current);
    if (!src) return <span>{alt}</span>;
    return showsImage(src, images, extraSchemes) ? (
      <img src={src} alt={alt ?? ""} />
    ) : (
      <a href={src} rel="noreferrer noopener">
        {alt || src}
      </a>
    );
  },
  a: function Link({ href, children, node }) {
    const { sources, sourceNames } = useContext(Current);
    // A citation opens its source, named by its number and title. Only the
    // citations plugin marks one: author text cannot, and its address has
    // passed the allow-list like any other.
    const cited = Number(node?.properties?.[CITE] ?? 0);
    const source = cited ? sources?.[cited - 1] : undefined;
    if (source && href)
      return (
        <a
          href={href}
          rel="noreferrer noopener"
          target="_blank"
          data-wp-cite=""
          aria-label={sourceNames?.item(cited, source.title)}
        >
          {children}
        </a>
      );
    return href ? (
      <a href={href} rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
};
// Called as a function: the synchronous renderer is a plain function of its
// options, so its result can be kept for a message or a finished block.
function parse(
  markdown: string,
  sources: readonly Source[],
  extraSchemes: readonly string[] | undefined,
): ReactNode {
  // Sources that may be opened: the others are named but never linked.
  const safe = (source: Source) => isSafeUrl(source.url, extraSchemes);
  return ReactMarkdown({
    skipHtml: true,
    remarkPlugins: [gfm, [citations, { sources, safe }]],
    urlTransform: (url) => (isSafeUrl(url, extraSchemes) ? url : undefined),
    components,
    children: markdown,
  });
}
// A block of a reply being written that later text can no longer change:
// parsed once, while the open block after it is parsed on every frame.
const FinishedBlock = memo(function FinishedBlock(props: {
  text: string;
  sources: readonly Source[];
  extraSchemes?: readonly string[];
}) {
  return parse(props.text, props.sources, props.extraSchemes);
});
// One identity, so a finished block's sources compare equal.
const NO_SOURCES: readonly Source[] = [];
// The block structure is read with the renderer's own grammar.
let blockGrammar: ReturnType<typeof blockProcessor> | undefined;
function blockProcessor() {
  return unified().use(remarkParse).use(gfm);
}

interface Blocks {
  text: string;
  // Where each block starts; the last one is still open.
  starts: number[];
  // How far whole lines have been read.
  read: number;
  // A link reference definition was read: it applies to the whole text,
  // earlier blocks included, so the text is no longer split.
  whole: boolean;
}

/**
 * Where the blocks of a text being written start, each block but the last
 * one finished: no later text can change it. A block is finished once the
 * renderer's grammar, reading the whole lines from the open block on, has
 * started another top-level block after it. CommonMark never reopens a
 * block it closed, so nothing after an open fence's opening line (or an
 * open HTML comment, or a list a later line may continue) is finished
 * until a later line closes it. Text that continues what was read is read
 * on from the open block.
 */
export function blockStarts(text: string, was?: Blocks): Blocks {
  const state: Blocks =
    was && text.startsWith(was.text)
      ? { ...was, text }
      : { text, starts: [0], read: 0, whole: false };
  // The line still being written may yet change what it is.
  const lines = text.lastIndexOf("\n") + 1;
  if (state.whole || lines <= state.read) return state;
  state.read = lines;
  const open = state.starts.at(-1)!;
  const grammar = (blockGrammar ??= blockProcessor());
  const tree = grammar.parse(text.slice(open, lines));
  const lineOf = (offset: number) =>
    text.lastIndexOf("\n", open + offset - 1) + 1;
  const defines = (node: { type: string; children?: unknown[] }): boolean =>
    node.type === "definition" ||
    (node.children ?? []).some((child) =>
      defines(child as { type: string; children?: unknown[] }),
    );
  if (tree.children.some(defines)) {
    state.whole = true;
    state.starts = [0];
    return state;
  }
  for (const child of tree.children.slice(1)) {
    const start = lineOf(child.position!.start.offset!);
    if (start > state.starts.at(-1)!) state.starts.push(start);
  }
  return state;
}

export default function Markdown(props: MarkdownProps) {
  const { text, extraSchemes, sources = NO_SOURCES } = props;
  const safe = (source: Source) => isSafeUrl(source.url, extraSchemes);
  const reduced = reducedMotion();
  const shown = useReveal(text, !!props.writing && !reduced, props.lang);
  const blocks = useRef<Blocks | undefined>(undefined);
  let body: ReactNode;
  if (props.writing) {
    // Only the open block is parsed again, with what it opened closed.
    const read = (blocks.current = blockStarts(shown, blocks.current));
    const starts = read.starts.filter((start) => start <= shown.length);
    const open = starts.at(-1)!;
    body = (
      <>
        {starts.slice(0, -1).map((start, index) => (
          <FinishedBlock
            key={start}
            text={shown.slice(start, starts[index + 1])}
            sources={sources}
            extraSchemes={extraSchemes}
          />
        ))}
        {parse(closeOpenMarkdown(shown.slice(open)), sources, extraSchemes)}
      </>
    );
  } else {
    blocks.current = undefined;
    body = props.cached
      ? props.cached(() => parse(text, sources, extraSchemes))
      : parse(text, sources, extraSchemes);
  }
  return (
    <div
      className="wp-markdown"
      // Under reduced motion a reply fades in instead of typing out.
      data-fade={props.writing && reduced ? "" : undefined}
    >
      <Current.Provider value={props}>{body}</Current.Provider>
      {sources.length ? (
        <details
          data-sources=""
          aria-label={props.sourceNames?.list(sources.length)}
        >
          <summary>{props.sourceNames?.list(sources.length)}</summary>
          <ol>
            {sources.map((source) => (
              <li key={source.id}>
                {safe(source) ? (
                  <a
                    href={source.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
