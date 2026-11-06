import type { FixtureTurn } from "../fixtures/server/index";
import type { PlanRecord, Problem } from "../src/protocol/generated";
import type { View } from "./state";

/** The title every reply-state conversation is created with. */
export const STATE_TITLE = "Reply states";

// Splits text into the uneven small pieces a model streams.
export function pieces(text: string): string[] {
  const out: string[] = [];
  for (
    let at = 0, size = 3;
    at < text.length;
    at += size, size = (size % 5) + 2
  )
    out.push(text.slice(at, at + size));
  return out;
}

const copy = {
  en: {
    question: "Show me the last 3 orders and summarise them in detail",
    long: [
      "## Your last three orders\n\n",
      "Here is what changed since last week. ",
      "**Order 1042** shipped on Monday and arrived a day early. ",
      "**Order 1043** is waiting for one item that is back in stock on Friday. ",
      "**Order 1044** was paid twice by mistake; the second payment is refunded.\n\n",
      "- Check the delivery note for 1042\n",
      "- Tell the customer about the Friday date for 1043\n",
      "- Confirm the refund for 1044 has reached the card\n\n",
      "Nothing else needs your attention today. ",
      "If you want, I can draft the message to the customer about order 1043 ",
      "and add the refund reference to the order notes.",
    ].join(""),
    short:
      "Here is a short summary: **3 orders**, all paid, one waiting for stock.",
    partial: "I started reading the orders, and then ",
    plan: "I prepared a plan. Review the change before anything runs.",
    form: "I need the order number before I can look this up.",
    orderLabel: "Order number",
    noteLabel: "Note",
    answer:
      "This is the local preview's mock host. It streams an answer to every message, so you can watch a reply arrive. Pick a **reply state** in the toolbar to see the others.",
  },
  "zh-CN": {
    question: "列出最近 3 个订单，并详细总结",
    long: [
      "## 最近三个订单\n\n",
      "以下是上周以来的变化。",
      "**订单 1042** 周一发货，提前一天送达。",
      "**订单 1043** 还差一件商品，周五到货。",
      "**订单 1044** 被误付了两次，第二笔已退款。\n\n",
      "- 核对 1042 的送货单\n",
      "- 告知客户 1043 周五到货\n",
      "- 确认 1044 的退款已到账\n\n",
      "今天没有其他需要处理的事项。",
      "如有需要，我可以起草发给 1043 客户的消息，",
      "并把退款编号写进订单备注。",
    ].join(""),
    short: "简要总结：**3 个订单**均已付款，其中一个在等待到货。",
    partial: "我开始读取订单，然后",
    plan: "我准备了一个计划。执行前请先检查改动。",
    form: "我需要订单号才能查询。",
    orderLabel: "订单号",
    noteLabel: "备注",
    answer:
      "这是本地预览的模拟服务。它会逐段回复每条消息，方便观察回复的过程。在工具栏中选择**回复状态**可以查看其他状态。",
  },
};

export type ReplyState = View["state"];

/** What the host does with the question a reply state asks. */
export function stateTurn(state: ReplyState, lang: View["lang"]): FixtureTurn {
  const text = copy[lang];
  if (state.startsWith("error-"))
    return {
      problem: {
        id: "playground-send",
        code: state.slice("error-".length) as Problem["code"],
      },
    };
  switch (state) {
    case "streaming":
      return { chunks: pieces(text.long), interval: 220 };
    case "stopped":
      return { chunks: pieces(text.long), interval: 60 };
    case "done":
      return { chunks: pieces(text.short), interval: 15 };
    case "overdue":
      return { silent: true, askedAgo: 20_000 };
    case "reply-failed":
      return { chunks: pieces(text.partial), interval: 40, ending: "failed" };
    case "reply-unavailable":
      return {
        chunks: pieces(text.partial),
        interval: 40,
        ending: "unavailable",
      };
    case "plan":
      return { content: text.plan };
    case "form":
      return {
        content: text.form,
        blocks: [
          {
            type: "form",
            id: "order-form",
            fallback: text.form,
            body: {
              fields: [
                { name: "order", label: text.orderLabel, required: true },
                { name: "note", label: text.noteLabel },
              ],
            },
          },
        ],
      };
    default:
      return {};
  }
}

/** What the mock host answers any other message with. */
export const defaultTurn = (lang: View["lang"]): FixtureTurn => ({
  chunks: pieces(copy[lang].answer),
  interval: 25,
});

export const stateQuestion = (lang: View["lang"]) => copy[lang].question;

/** The plan the plan state shows, as the host would send it. */
export function statePlan(conversationId: string): PlanRecord {
  return {
    protocol: "1.0",
    id: "playground-plan",
    state: "awaiting-confirmation",
    outcomes: [],
    confirmation: {
      token: "playground-token",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      planId: "playground-plan",
      conversationId,
      revision: 1,
      heading: "Update 2 records in orders",
      items: [
        { label: "Order 1043: status", before: '"Waiting"', after: '"Ready"' },
        { label: "Order 1044: note", before: '""', after: '"Refunded"' },
      ],
      irreversible: false,
      undo: "Undoing this change is not available in this version.",
      verificationCount: 0,
      actionLabel: "Apply 2 changes",
    },
    plan: {
      kind: "immediate",
      stage: "final",
      id: "playground-plan",
      digest: "playground",
      stepUpCount: 0,
      steps: ["1043", "1044"].map((row, at) => ({
        id: `step-${row}`,
        operation: "orders.update",
        resource: "orders",
        rows: [row],
        fields: [at ? "note" : "status"],
        view: `/orders/${row}`,
        tier: "low" as const,
        undo: "compare-and-set" as const,
        stepUp: false,
        before: at ? { note: "" } : { status: "Waiting" },
        after: at ? { note: "Refunded" } : { status: "Ready" },
        request: {
          method: "PATCH",
          path: `/orders/${row}`,
          body: at ? '{"note":"Refunded"}' : '{"status":"Ready"}',
          headers: { "If-Match": "v1" },
          digest: "playground",
        },
      })),
    },
  };
}
