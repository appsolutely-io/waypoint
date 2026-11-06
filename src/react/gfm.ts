// GitHub-flavoured Markdown for the stock renderer, limited to the parts
// the chat supports: tables, strikethrough, task lists and autolinks.
// Footnotes stay off. Part of the markdown chunk, so every message is
// parsed by one grammar; registered the way remark-gfm registers the
// full set.
import type { Processor } from "unified";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";

export default function gfm(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(
    gfmAutolinkLiteral(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
  );
  (data.fromMarkdownExtensions ??= []).push(
    gfmAutolinkLiteralFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
}
