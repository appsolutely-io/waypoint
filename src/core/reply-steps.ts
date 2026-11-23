import type {
  FrameStep,
  Message,
  OutlineMessage,
  ReplyStep,
} from "../protocol/generated";

export function stepEnvelope(value: unknown): value is FrameStep {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<FrameStep>;
  return (
    frame.type === "step" &&
    typeof frame.protocol === "string" &&
    frame.protocol.length > 0 &&
    Number.isInteger(frame.sequence) &&
    frame.sequence! >= 0 &&
    typeof frame.messageId === "string" &&
    frame.messageId.length > 0
  );
}
export function replyStep(value: unknown): ReplyStep | undefined {
  if (!value || typeof value !== "object") return;
  const step = value as Partial<ReplyStep>;
  if (
    typeof step.id !== "string" ||
    !step.id.length ||
    !["running", "done", "failed"].includes(step.status ?? "")
  )
    return;
  const label = step.label;
  return {
    id: step.id,
    status: step.status!,
    ...(typeof label === "string" &&
      [...label].length > 0 &&
      [...label].length <= 200 && { label }),
  };
}
export function upsertStep(
  steps: readonly ReplyStep[],
  step: ReplyStep,
): ReplyStep[] {
  const at = steps.findIndex((shown) => shown.id === step.id);
  return at < 0
    ? [...steps, step]
    : steps.map((shown, index) => (index === at ? step : shown));
}
export function normalizeSteps(value: unknown): ReplyStep[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<ReplyStep[]>((steps, value) => {
    const step = replyStep(value);
    return step ? upsertStep(steps, step) : steps;
  }, []);
}

export class ReplySteps {
  private user?: string;
  private awaitingUser = false;
  private clientMessageId?: string;
  private excluded = new Set<string>();
  private order = new Map<string, number>();
  private local: ReplyStep[] = [];
  generation = 0;

  clear(): void {
    this.user = undefined;
    this.awaitingUser = false;
    this.clientMessageId = undefined;
    this.excluded.clear();
    this.reset();
  }
  private reset(): void {
    this.generation++;
    this.local = [];
    this.order.clear();
  }
  begin(
    messages: readonly Message[],
    outline: readonly OutlineMessage[] = [],
    clientMessageId?: string,
  ): void {
    if (clientMessageId && clientMessageId === this.clientMessageId) return;
    this.excluded = new Set(
      [...outline, ...messages].map((message) => message.id),
    );
    this.awaitingUser = true;
    this.clientMessageId = clientMessageId;
    this.reset();
  }
  bind(clientMessageId: string): void {
    this.clientMessageId = clientMessageId;
  }
  set(step: ReplyStep): void {
    this.local = upsertStep(this.local, step);
    this.remember(step.id);
  }
  private remember(id: string): void {
    if (!this.order.has(id)) this.order.set(id, this.order.size);
  }
  display(
    messages: readonly Message[],
    outline?: readonly OutlineMessage[],
  ): ReplyStep[] {
    const known = new Set(outline?.map((entry) => entry.id));
    const index = outline
      ? [...outline, ...messages.filter((message) => !known.has(message.id))]
      : messages;
    let start = 0;
    for (let at = index.length - 1; at >= 0; at--)
      if (index[at]?.role === "user") {
        start = at + 1;
        break;
      }
    const user = start ? index[start - 1]?.id : undefined;
    if (user !== this.user) {
      const confirmed = messages.find((message) => message.id === user);
      const sameSend =
        this.awaitingUser &&
        (!confirmed?.clientMessageId ||
          confirmed.clientMessageId === this.clientMessageId);
      this.user = user;
      this.awaitingUser = false;
      this.excluded.clear();
      if (!sameSend) {
        this.clientMessageId = confirmed?.clientMessageId;
        this.reset();
      }
    }
    const current = new Set(index.slice(start).map((entry) => entry.id));
    let steps = [...this.local];
    for (const message of messages)
      if (
        current.has(message.id) &&
        message.role === "assistant" &&
        !this.excluded.has(message.id)
      )
        for (const step of message.steps ?? []) {
          this.remember(step.id);
          steps = upsertStep(steps, step);
        }
    return steps.sort((a, b) => this.order.get(a.id)! - this.order.get(b.id)!);
  }
}
