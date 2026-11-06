import type { Frame } from "../protocol/generated";
// Loaded on first use by decodeFrames in ./transports.
export async function* decodeFrames(
  chunks: AsyncIterable<string>,
  format: "sse" | "ndjson",
): AsyncGenerator<Frame> {
  let buffer = "";
  let data: string[] = [];
  const parse = (raw: string): Frame | null => {
    if (!raw.trim()) return null;
    const frame: unknown = JSON.parse(raw);
    if (
      typeof frame !== "object" ||
      frame === null ||
      typeof (frame as Frame).protocol !== "string" ||
      !Number.isInteger((frame as Frame).sequence) ||
      typeof (frame as Frame).type !== "string"
    )
      throw new Error("Invalid frame");
    return frame as Frame;
  };
  for await (const chunk of chunks) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      if (format === "ndjson") {
        const frame = parse(line);
        if (frame) yield frame;
      } else if (line === "") {
        const frame = parse(data.join("\n"));
        data = [];
        if (frame) yield frame;
      } else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (format === "ndjson") {
    const frame = parse(buffer);
    if (frame) yield frame;
  }
}
