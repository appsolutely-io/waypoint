// Loaded on first use by decodeFrames in ./transports.
export async function* decodeFrames(
  chunks: AsyncIterable<string>,
  format: "sse" | "ndjson",
): AsyncGenerator<unknown> {
  let buffer = "";
  let data: string[] = [];
  const parse = (raw: string): unknown =>
    raw.trim() ? JSON.parse(raw) : undefined;
  for await (const chunk of chunks) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      if (format === "ndjson") {
        const frame = parse(line);
        if (frame !== undefined) yield frame;
      } else if (line === "") {
        const frame = parse(data.join("\n"));
        data = [];
        if (frame !== undefined) yield frame;
      } else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (format === "ndjson") {
    const frame = parse(buffer);
    if (frame !== undefined) yield frame;
  }
}
