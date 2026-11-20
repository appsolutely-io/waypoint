import type { MessageSender } from "../protocol/generated";

export function normalizeSender(value: unknown): MessageSender | undefined {
  if (!value || typeof value !== "object") return;
  const sender = value as Record<string, unknown>;
  if (
    typeof sender.id !== "string" ||
    !sender.id.length ||
    typeof sender.name !== "string" ||
    !sender.name.length ||
    [...sender.name].length > 80
  )
    return;
  return {
    id: sender.id,
    name: sender.name,
    ...(typeof sender.avatarUrl === "string" && {
      avatarUrl: sender.avatarUrl,
    }),
  };
}
