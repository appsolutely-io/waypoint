// Load for `npm run perf`: `?perfMessages=N` puts N synthetic messages
// before the conversation's own on every read, and `?perfTokens=N` makes
// the staged reply a streamed one of about N tokens (`perfRate` tokens a
// second). Without these the playground is unchanged.
import type { Conversation, Message } from "../src/protocol/generated";
import type { FixtureTurn } from "../fixtures/server/index";
import { stateTurn } from "./reply-states";

const query = new URLSearchParams(globalThis.location?.search ?? "");
export const perf = {
  messages: Number(query.get("perfMessages") ?? 0),
  tokens: Number(query.get("perfTokens") ?? 0),
  rate: Number(query.get("perfRate") ?? 200),
};
export const measuring = perf.messages > 0 || perf.tokens > 0;

// Each piece of a streamed reply: 16 characters, about 4 tokens.
const PIECE = 16;
const PARAGRAPH =
  "The **quarterly report** shows `orders` rising across *every* region, with returns flat and stock steady. ";
const CODE =
  "```ts\nexport function total(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.count, 0);\n}\n```\n\n";
const TABLE =
  "| Region | Orders | Returns |\n| --- | --- | --- |\n| North | 1,204 | 31 |\n| South | 988 | 12 |\n| East | 1,530 | 44 |\n\n";
const LIST =
  "- First, check the open orders\n- Then compare against stock\n  - flag anything under ten\n- Finally, write the summary\n\n";

/** Markdown of about `tokens` tokens, four characters each. */
export function longMarkdown(tokens: number): string {
  const parts: string[] = [];
  let size = 0;
  for (let index = 0; size < tokens * 4; index++) {
    const part = [
      `## Section ${index / 4 + 1}\n\n${PARAGRAPH.repeat(3)}\n\n`,
      CODE,
      TABLE,
      LIST,
    ][index % 4]!;
    parts.push(part);
    size += part.length;
  }
  return parts.join("");
}

/** The streamed reply, also kept for the harness to compare with. */
export function perfTurn(tokens = perf.tokens, rate = perf.rate): FixtureTurn {
  const text = longMarkdown(tokens);
  // The harness compares the finished reply with it.
  (globalThis as { __wpPerfExpected?: string }).__wpPerfExpected = text;
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += PIECE)
    chunks.push(text.slice(at, at + PIECE));
  return { chunks, interval: Math.max(1, Math.round(4000 / rate)) };
}

/** The conversation with the synthetic history before its own messages. */
export function withPerf(
  value: Conversation,
  count = perf.messages,
): Conversation {
  if (!count) return value;
  const form = stateTurn("form", "en");
  const sources = stateTurn("sources", "en");
  const details = stateTurn("details", "en");
  const history: Message[] = [];
  for (let index = 0; index < count; index++) {
    const id = `perf-${index}`;
    const createdAt = 1_700_000_000_000 + index * 1000;
    if (index % 2 === 0) {
      history.push({
        id,
        role: "user",
        content: `Question ${index}: how are orders this week?`,
        blocks: [],
        createdAt,
        status: "completed",
      });
      continue;
    }
    const base = {
      id,
      role: "assistant" as const,
      createdAt,
      status: "completed" as const,
    };
    const renamed = (blocks: FixtureTurn["blocks"]) =>
      (blocks ?? []).map((block) => ({ ...block, id: `${block.id}-${index}` }));
    switch ((index >> 1) % 4) {
      case 0:
        history.push({
          ...base,
          content: `Answer ${index}. ${PARAGRAPH}\n\n${LIST}${CODE}`,
          blocks: [],
        });
        break;
      case 1:
        history.push({
          ...base,
          content: form.content ?? "",
          blocks: renamed(form.blocks),
        });
        break;
      case 2:
        history.push({
          ...base,
          content: (sources.chunks ?? []).join(""),
          blocks: [],
          sources: sources.sources,
        });
        break;
      default:
        history.push({
          ...base,
          content: details.content ?? "",
          blocks: renamed(details.blocks),
        });
    }
  }
  return { ...value, messages: [...history, ...value.messages] };
}
