import { it, expect } from "vitest";
import { parseFlow, bindFlow } from "../../src/core/flows";
it("parses structured parameters and rejects unknown operations, refs and unsafe documents", async () => {
  const source =
    '---\nformat: "1.0"\nid: fixture/rename\ntitle: Rename\nkind: structured\nparameters:\n  - {name: title, type: string, label: Title, required: true}\nsteps:\n  - operation: items.update\n    arguments: {title: "{{title}}"}\ntags: []\n---\nDescription';
  const flow = await parseFlow(source, ["items.update"]);
  expect(bindFlow(flow, { title: "New" })).toEqual([
    { operation: "items.update", arguments: { title: "New" } },
  ]);
  expect(() => bindFlow(flow, {})).toThrow();
  await expect(parseFlow(source, ["other"])).rejects.toThrow();
  await expect(
    parseFlow(source.replace("{{title}}", "{{missing}}"), ["items.update"]),
  ).rejects.toThrow();
});
it("refuses duplicate keys, aliases and executable tags", async () => {
  for (const header of [
    'format: "1.0"\nid: example/a\nid: example/b',
    'format: "1.0"\nid: &ref example/a\ntitle: *ref',
    'format: "1.0"\nid: !!js/function function(){}',
  ])
    await expect(
      parseFlow(`---\n${header}\n---\nPrompt`, []),
    ).rejects.toThrow();
});
