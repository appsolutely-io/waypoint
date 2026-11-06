import { load, JSON_SCHEMA } from "js-yaml";
export function loadFrontmatter(source: string): unknown {
  const value: unknown = load(source, {
    schema: JSON_SCHEMA,
    listener: (event, state) => {
      if (event === "close" && (state as { anchor?: string | null }).anchor)
        throw new Error("Flow aliases are not supported");
    },
  });

  return value;
}
