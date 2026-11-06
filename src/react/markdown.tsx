import { useMemo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkParse from "remark-parse";
import { unified } from "unified";
import gfm from "./gfm";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { isSafeUrl } from "./urls";
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
interface MarkdownProps {
  text: string;
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
      a: ({ href, children }) =>
        href ? (
          <a href={href} rel="noreferrer noopener">
            {children}
          </a>
        ) : (
          <span>{children}</span>
        ),
    }),
    [],
  );
  const { text, extraSchemes } = props;
  return (
    <div className="wp-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[gfm]}
        urlTransform={(url) => (isSafeUrl(url, extraSchemes) ? url : undefined)}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
