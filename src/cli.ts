#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { runConformance } from "./conformance/index";
import { readHeaders } from "./conformance/auth";
import { sameOriginRequest } from "./conformance/http";

const USAGE =
  "Use waypoint-conformance <test-base-url> [--app-host] [--headers-file <file>]";
async function main(): Promise<void> {
  let baseUrl: string | undefined;
  let file: string | undefined;
  let profile: "admin-host" | "app-host" = "admin-host";
  let selectedProfile = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--app-host" && !selectedProfile) {
      selectedProfile = true;
      profile = "app-host";
    } else if (
      argument === "--headers-file" &&
      file === undefined &&
      args[index + 1] &&
      !args[index + 1]!.startsWith("--")
    )
      file = args[++index];
    else if (!argument.startsWith("-") && !baseUrl) baseUrl = argument;
    else throw new Error(USAGE);
  }
  if (!baseUrl) throw new Error(USAGE);
  const parsed = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(USAGE);
  let headers: Record<string, string> | undefined;
  if (file) {
    try {
      headers = readHeaders(
        JSON.parse(await readFile(file, "utf8")) as unknown,
      );
    } catch {
      throw new Error(
        "Provide --headers-file with a readable UTF-8 JSON string header map",
      );
    }
  }
  const result = await runConformance({
    baseUrl,
    profile,
    headers,
    request: sameOriginRequest(baseUrl),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.passed) process.exitCode = 1;
}
try {
  await main();
} catch {
  process.stderr.write(
    `${USAGE}; check the URL, headers file and test service.\n`,
  );
  process.exitCode = 1;
}
