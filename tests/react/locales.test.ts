import { it, expect } from "vitest";
import { createFormatter } from "../../src/react/i18n";
it("Simplified Chinese tags select that catalogue; Traditional ones keep English", () => {
  for (const locale of ["zh", "zh-CN", "zh-Hans", "zh-SG"])
    expect(createFormatter(locale)("chat.message")).toBe("消息");
  for (const locale of ["zh-TW", "zh-HK", "zh-Hant", "zh-MO"]) {
    expect(createFormatter(locale)("chat.message")).toBe("Message");
    expect(createFormatter(locale)("chat.stepUp", { count: 1 })).toBe(
      createFormatter("en")("chat.stepUp", { count: 1 }),
    );
  }
});
