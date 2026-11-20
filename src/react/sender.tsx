import { useState } from "react";
import type { Message } from "../protocol/generated";
import type { FormatMessage } from "./i18n";
import { showsImage, type MarkdownImagePolicy } from "./image-policy";

export function senderName(message: Message, format: FormatMessage): string {
  return (
    message.sender?.name ??
    format(
      message.role === "user"
        ? "chat.roleUser"
        : message.role === "notice"
          ? "chat.roleNotice"
          : "chat.roleAssistant",
    )
  );
}

const AVATAR_SIZE = 24;
export function SenderAvatar({
  src,
  images,
  extraSchemes,
}: {
  src?: string;
  images?: MarkdownImagePolicy;
  extraSchemes?: readonly string[];
}) {
  const [failed, setFailed] = useState<string>();
  return src && src !== failed && showsImage(src, images, extraSchemes) ? (
    <img
      src={src}
      alt=""
      data-avatar=""
      width={AVATAR_SIZE}
      height={AVATAR_SIZE}
      onError={() => setFailed(src)}
    />
  ) : null;
}
