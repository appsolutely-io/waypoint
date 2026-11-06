import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync(".api-temp", { recursive: true });
mkdirSync("etc", { recursive: true });
for (const part of [
  "index",
  "react/index",
  "hooks/index",
  "skin-default/index",
  "skin-antd/index",
  "testing/index",
]) {
  const name = part.replace("/index", "");
  const only = process.argv.find((arg) => arg.startsWith("--entry="))?.slice(8);
  if (only && only !== name) continue;
  if (!existsSync(`dist/${part}.d.ts`)) {
    process.stderr.write(`Missing declaration entry: dist/${part}.d.ts\n`);
    process.exitCode = 1;
    continue;
  }
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: resolve("."),
      newlineKind: "lf",
      mainEntryPointFilePath: `<projectFolder>/dist/${part}.d.ts`,
      compiler: { tsconfigFilePath: "<projectFolder>/tsconfig.json" },
      apiReport: {
        enabled: true,
        reportFileName: `${name}.api.md`,
        reportFolder: "<projectFolder>/etc",
        reportTempFolder: "<projectFolder>/.api-temp",
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        extractorMessageReporting: {
          "ae-missing-release-tag": { logLevel: "none" },
          "ae-forgotten-export": { logLevel: "error" },
        },
      },
    },
    configObjectFullPath: resolve(`.api-temp/${name}.json`),
    packageJsonFullPath: resolve("package.json"),
  });
  const result = Extractor.invoke(config, {
    localBuild: process.argv.includes("--local"),
    showVerboseMessages: false,
  });
  if (!result.succeeded) process.exitCode = 1;
  if (process.argv.includes("--local")) {
    const file = `etc/${name}.api.md`;
    writeFileSync(file, readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  }
}
