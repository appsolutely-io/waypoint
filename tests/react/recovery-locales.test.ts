import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addMessages, createFormatter } from "../../src/react/i18n";
import {
  recoveryEnglish as english,
  recoverySimplifiedChinese as simplifiedChinese,
} from "../../src/react/recovery-messages";

addMessages(english, simplifiedChinese);
import { HOST_KEYS, OVERLAY_KEYS } from "../../src/react/plan-view";
import catalogue from "./fixtures/recovery-catalogue";

const recovery = Object.keys(english) as (keyof typeof english)[];
// The frozen whole messages of the design, as written there.
const FROZEN: Record<string, [string, string]> = {
  stopNotSent: [
    "Stop was not sent. A step already sent may still finish.",
    "停止请求未能发送。已发送的步骤仍可能完成。",
  ],
  leftUnconfirmed: [
    "Left as is; {count, plural, one {# step could not be confirmed} other {# steps could not be confirmed}}.",
    "已保持现状；有 {count} 个步骤的状态无法确认。",
  ],
  confirmKeepForwardOnly: [
    "Keep the current results and close this plan? Remaining planned steps will not run. This plan has no Undo choice to end, and site values will not change.",
    "是否保留当前结果并关闭此计划？剩余计划步骤将不再执行。此计划没有可结束的撤销选项，站点中的值也不会更改。",
  ],
  confirmEndRetention: [
    "Keep the current results and close this plan's retained record? No planned steps or Undo choices remain. Site values will not change.",
    "是否保留当前结果并结束此计划记录的保留？没有剩余计划步骤或撤销选项。站点中的值不会更改。",
  ],
  unknown: ["Could not be confirmed", "无法确认"],
};

describe("recovery catalogue", () => {
  it("CK-L1 every key the view can emit exists in both locales", () => {
    const emitted = new Set([
      ...Object.values(HOST_KEYS),
      ...Object.values(OVERLAY_KEYS),
    ]);
    const source = readFileSync("src/react/plan-view.ts", "utf8");
    for (const match of source.matchAll(/k\("([a-zA-Z]+)"\)/g))
      emitted.add(`chat.recovery.${match[1]}` as never);
    for (const key of emitted) {
      expect(english).toHaveProperty([key]);
      expect(simplifiedChinese).toHaveProperty([key]);
    }
    for (const key of recovery) expect(simplifiedChinese[key]).toBeTruthy();
  });
  it.each(Object.entries(FROZEN))(
    "CK-L2 %s keeps the frozen text in both locales",
    (key, [en, zh]) => {
      expect(english[`chat.recovery.${key}` as keyof typeof english]).toBe(en);
      expect(
        simplifiedChinese[`chat.recovery.${key}` as keyof typeof english],
      ).toBe(zh);
    },
  );
  it("CK-L3 plural messages read naturally in both locales", () => {
    const en = createFormatter("en");
    const zh = createFormatter("zh-CN");
    expect(en("chat.recovery.stepsUnknown", { count: 1 })).toMatch(
      /^1 step could not/,
    );
    expect(en("chat.recovery.stepsUnknown", { count: 2 })).toMatch(
      /^2 steps could not/,
    );
    expect(zh("chat.recovery.stepsUnknown", { count: 2 })).toMatch(
      /^有 2 个步骤/,
    );
    expect(en("chat.recovery.retryAfterSeconds", { seconds: 1 })).toBe(
      "You can try again in 1 second.",
    );
    expect(zh("chat.recovery.retryAfterSeconds", { seconds: 5 })).toBe(
      "5 秒后可以重试。",
    );
  });
  it("CK-L4 Chinese messages contain no untranslated English words", () => {
    for (const key of recovery)
      expect([key, simplifiedChinese[key].replace(/\{[^}]*\}/g, "")]).toEqual([
        key,
        expect.not.stringMatching(/[A-Za-z]{3,}/),
      ]);
  });
  it("CK-L5 not-sent messages are definitive in Chinese", () => {
    for (const key of [
      "stopNotSent",
      "stopNotSentElsewhere",
      "keepNotSent",
      "cancelNotSent",
      "reviewCancelNotSent",
    ])
      expect(
        simplifiedChinese[`chat.recovery.${key}` as keyof typeof english],
      ).toContain("未能发送");
    // The frozen Leave text says the choice was not saved.
    expect(simplifiedChinese["chat.recovery.leaveNotSent"]).toContain(
      "未能保存",
    );
  });
  it("CK-L6 every reply key the host can write is mapped", () => {
    const host = readFileSync("src/host/plan-intents.ts", "utf8");
    const literals = new Set<string>();
    // Keys appear in reply key arrays and as single key results.
    for (const match of host.matchAll(/\[([^[\]]*)\]/g))
      for (const literal of match[1]!.matchAll(/"([a-z][A-Za-z]+)"/g))
        literals.add(literal[1]!);
    for (const match of host.matchAll(/return "([a-z][A-Za-z]+)";/g))
      literals.add(match[1]!);
    for (const match of host.matchAll(
      /\? "([a-z][A-Za-z]+)"\s*:\s*"([a-z][A-Za-z]+)"/g,
    )) {
      literals.add(match[1]!);
      literals.add(match[2]!);
    }
    // Words of those positions that are not reply keys.
    const notKeys = new Set([
      "acknowledgment",
      "capturedRound",
      "cause",
      "clientReplyId",
      "completed",
      "correlation",
      "decisionResolutionVersion",
      "digest",
      "effect",
      "evidenceDigest",
      "evidenceVersion",
      "execution",
      "expectedSlotVersion",
      "finalHistory",
      "generation",
      "keepEffect",
      "keptFact",
      "kind",
      "payload",
      "planId",
      "protocol",
      "result",
      "review",
      "savedDisposition",
      "sourceDecisionKey",
      "stop",
      "target",
      "type",
      "unknownCount",
      "winnerVersion",
      "cancelled",
      "keep",
      "leave",
      "running",
      "readback",
      "proposal",
      "invalid",
      "obsolete",
      "settled",
      "applied",
      "refused",
      "unavailable",
      "replaced",
      "sealed",
      "kept",
      "closed",
      "open",
      "live",
      "unknown",
      "done",
      "accepted",
      "existing",
      "current",
      "string",
      "number",
      "object",
      "fenced",
      "commit",
      "admission",
      "allowed",
      "inhibited",
      "renewal",
      "foreign",
      "replay",
      "replayed",
      "unproven",
      "notAdmitted",
      "staleFence",
      "contradiction",
      "none",
      "user",
      "activationHistory",
      "reviewMissing",
      "reviewStale",
      "intentClosed",
      "fence",
      "close",
      "defeated",
      "confirmationToken",
      "superseded",
      "conflict",
      "id",
    ]);
    const keys = [...literals].filter((literal) => !notKeys.has(literal));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys)
      expect([key, HOST_KEYS[key]]).toEqual([
        key,
        expect.stringMatching(/^chat\.recovery\./),
      ]);
  });
  it.each(Object.entries(catalogue.frozen))(
    "CK-L2b frozen %s is exactly the design's text",
    (key, { en, zh }) => {
      const id = `chat.recovery.${key}` as keyof typeof english;
      expect(english[id]).toBe(en);
      expect(simplifiedChinese[id]).toBe(zh);
    },
  );
  it("CK-L7 every catalogue key is either frozen or an approved new key", () => {
    const known = new Set([...Object.keys(catalogue.frozen), ...catalogue.new]);
    for (const key of recovery)
      expect([key, known.has(key.replace("chat.recovery.", ""))]).toEqual([
        key,
        true,
      ]);
  });
  it("CK-L8 every overlay key the intent client can produce is mapped", () => {
    const source = readFileSync("src/core/intent.ts", "utf8");
    const prefixes = [
      ...source
        .slice(
          source.indexOf("const PREFIX"),
          source.indexOf("};", source.indexOf("const PREFIX")),
        )
        .matchAll(/: "([a-zA-Z]+)"/g),
    ].map((match) => match[1]!);
    expect(prefixes).toEqual([
      "stop",
      "cancelInitial",
      "cancelReview",
      "leave",
      "keep",
    ]);
    const keys = [
      ...prefixes.flatMap((prefix) =>
        ["NotSent", "Unconfirmed", "Refused"].map((suffix) => prefix + suffix),
      ),
      "stopNotSentElsewhere",
    ];
    for (const key of keys)
      expect([key, OVERLAY_KEYS[key]]).toEqual([
        key,
        expect.stringMatching(/^chat\.recovery\./),
      ]);
  });
});
