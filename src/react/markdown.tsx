import { useEffect, useMemo, useRef, useState } from "react";
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
/**
 * Closes, for display, what a reply still being written has opened and not
 * yet closed: a code fence, or `**`, `~~` and `` ` `` in its last paragraph.
 * The text itself is never changed.
 */
export function closeOpenMarkdown(text: string): string {
  const fences = text.match(/^ {0,3}(?:```|~~~)/gm) ?? [];
  if (fences.length % 2) return `${text}\n${fences.at(-1)!.trim()}`;
  // Escaped characters close nothing.
  const last = text.slice(text.lastIndexOf("\n\n") + 1).replace(/\\./g, "");
  if ((last.match(/`/g) ?? []).length % 2) return `${text}\``;
  const outside = last.replace(/`[^`]*`/g, "");
  let closing = "";
  for (const marker of ["**", "~~"])
    if ((outside.split(marker).length - 1) % 2) closing = marker + closing;
  return text + closing;
}
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
  const segments = [...segmenter.segment(text.slice(from))];
  const words = segments.filter((segment) => segment.isWordLike).length;
  let wanted = Math.max(1, Math.floor(words / 8));
  // Up to the end of the last whole word; what follows the last word (a
  // full stop, a space) comes with the rest.
  let at = from;
  for (const segment of segments)
    if (segment.isWordLike) {
      const end = from + segment.index + segment.segment.length;
      // A word at the very end may still be arriving: it waits for more.
      if (end === text.length) break;
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
}
export default function Markdown(props: MarkdownProps) {
  // The element renderers keep one identity for the renderer's lifetime:
  // new ones on each render would be new element types, and React would
  // replace every code block and table whenever the chat renders again,
  // dropping the keyboard focus and scroll position inside them. They read
  // the current props when they render.
  const current = useRef(props);
  current.current = props;
  const components = useMemo<Components>(
    () => ({
      // A code block scrolls inside itself, never the transcript, and can
      // be reached and scrolled by keyboard.
      pre: ({ children }) => (
        <pre
          data-scroll-region=""
          tabIndex={0}
          aria-label={current.current.scrollLabel}
        >
          {children}
        </pre>
      ),
      // A table scrolls inside itself too, as a named region.
      table: ({ children }) => (
        <div
          data-scroll-region=""
          tabIndex={0}
          role="region"
          aria-label={current.current.scrollLabel}
        >
          <table>{children}</table>
        </div>
      ),
      img: ({ src, alt }) => {
        if (!src) return <span>{alt}</span>;
        const { images, extraSchemes } = current.current;
        return showsImage(src, images, extraSchemes) ? (
          <img src={src} alt={alt ?? ""} />
        ) : (
          <a href={src} rel="noreferrer noopener">
            {alt || src}
          </a>
        );
      },
      a: ({ href, children, node }) => {
        // A citation opens its source, named by its number and title. Only
        // the citations plugin marks one: author text cannot, and its
        // address has passed the allow-list like any other.
        const cited = Number(node?.properties?.[CITE] ?? 0);
        const source = cited ? current.current.sources?.[cited - 1] : undefined;
        if (source && href)
          return (
            <a
              href={href}
              rel="noreferrer noopener"
              target="_blank"
              aria-label={current.current.sourceNames?.item(
                cited,
                source.title,
              )}
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
    }),
    [],
  );
  const { text, extraSchemes, sources = [] } = props;
  // Sources that may be opened: the others are named but never linked.
  const safe = (source: Source) => isSafeUrl(source.url, extraSchemes);
  const reduced = reducedMotion();
  const shown = useReveal(text, !!props.writing && !reduced, props.lang);
  return (
    <div
      className="wp-markdown"
      // Under reduced motion a reply fades in instead of typing out.
      data-fade={props.writing && reduced ? "" : undefined}
    >
      <ReactMarkdown
        skipHtml
        remarkPlugins={[gfm, [citations, { sources, safe }]]}
        urlTransform={(url) => (isSafeUrl(url, extraSchemes) ? url : undefined)}
        components={components}
      >
        {props.writing ? closeOpenMarkdown(shown) : text}
      </ReactMarkdown>
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
