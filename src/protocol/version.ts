export const supportsFormFill = (
  protocol: string | null,
): protocol is "1.1" | "1.2" => protocol === "1.1" || protocol === "1.2";

export const supportsReplySteps = (protocol: string | null): boolean =>
  protocol !== null && /^1\.(?:[2-9]|[1-9]\d+)(?![\s\S])/.test(protocol);
