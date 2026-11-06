import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const pattern = new RegExp(
  [
    "cl" + "oud",
    "ten" + "an",
    "host" + "ing",
    "mind" + "cue",
    "the" + "mes",
    "plan[ -]?\\d{3}",
  ].join("|"),
  "i",
);
export function forbiddenText(text) {
  return pattern.test(text);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const failures = files.filter((file) =>
    forbiddenText(readFileSync(file, "utf8")),
  );
  if (failures.length) {
    process.stderr.write(failures.join("\n") + "\n");
    process.exitCode = 1;
  }
}
