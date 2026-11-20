import type { Conversation, Message } from "../protocol/generated";

type Fields<T> = Map<keyof T, { at: number; value: T[keyof T] }>;
interface MessageOverlay {
  message: Message;
  fields: Fields<Message>;
  present?: number;
}
function write<T extends object>(
  fields: Fields<T>,
  patch: Partial<T>,
  at: number,
): void {
  for (const key of Object.keys(patch) as (keyof T)[])
    fields.set(key, { at, value: patch[key] as T[keyof T] });
}
function merge<T extends object>(
  value: T,
  fields: Fields<T>,
  token: number,
): T {
  let result = value;
  for (const [key, field] of fields)
    if (token > field.at) fields.delete(key);
    else result = { ...result, [key]: field.value };
  return result;
}

export class FrameOverlay {
  private readonly messages = new Map<string, MessageOverlay>();
  private readonly conversation: Fields<Conversation> = new Map();

  clear(): void {
    this.messages.clear();
    this.conversation.clear();
  }
  writeConversation(patch: Partial<Conversation>, at: number): void {
    write(this.conversation, patch, at);
  }
  writeMessage(
    message: Message,
    patch: Partial<Message>,
    at: number,
    inserted = false,
  ): void {
    const record: MessageOverlay = this.messages.get(message.id) ?? {
      message,
      fields: new Map(),
    };
    record.message = { ...record.message, ...patch };
    const { status: ignored, ...fields } = patch;
    void ignored;
    write(record.fields, fields, at);
    if (inserted) record.present = at;
    this.messages.set(message.id, record);
  }
  apply(
    value: Conversation,
    token: number,
    live: readonly Message[],
  ): Conversation {
    const included = new Set(value.messages.map((message) => message.id));
    const messages = value.messages.map((message) => {
      const record = this.messages.get(message.id);
      if (!record) return message;
      const result = merge(message, record.fields, token);
      if (record.present !== undefined && token > record.present)
        record.present = undefined;
      if (!record.fields.size && record.present === undefined)
        this.messages.delete(message.id);
      return result;
    });
    for (const [id, record] of this.messages) {
      if (included.has(id)) continue;
      if (record.present === undefined || token > record.present) {
        this.messages.delete(id);
        continue;
      }
      const current = live.find((message) => message.id === id);
      const message = {
        ...record.message,
        ...(current && { status: current.status }),
      };
      const position = live.findIndex((entry) => entry.id === id);
      const following = live
        .slice(position + 1)
        .find((entry) => messages.some((shown) => shown.id === entry.id));
      const at = following
        ? messages.findIndex((entry) => entry.id === following.id)
        : messages.length;
      messages.splice(at, 0, message);
    }
    return { ...merge(value, this.conversation, token), messages };
  }
}
