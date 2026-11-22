export const supportsFormFill = (
  protocol: string | null,
): protocol is "1.1" | "1.2" => protocol === "1.1" || protocol === "1.2";
