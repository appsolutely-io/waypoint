// `x-open-enum` marks a string whose known values a newer peer may add to:
// a list of the known values, or the name of the enum definition that
// lists them. Its type keeps the known values for editors and accepts
// any other string. Marks every annotated node of `node` in place.
// An array's item type and an intersection's member are written next to
// another operator (`T[]`, `A & T`), so there the union is grouped.
const grouping = new Set(["items", "prefixItems", "allOf"]);
export const openEnums = (node, grouped = false) => {
  if (Array.isArray(node))
    return node.forEach((item) => openEnums(item, grouped));
  if (!node || typeof node !== "object") return;
  const known = node["x-open-enum"];
  if (known !== undefined) {
    const type = `${
      Array.isArray(known)
        ? known.map((value) => `'${value}'`).join(" | ")
        : known
    } | (string & {})${
      // A nullable string keeps its null.
      Array.isArray(node.type) && node.type.includes("null") ? " | null" : ""
    }`;
    node.tsType = grouped ? `(${type})` : type;
  }
  for (const [key, value] of Object.entries(node))
    openEnums(value, grouping.has(key));
};
