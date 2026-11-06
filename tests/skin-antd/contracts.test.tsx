// @vitest-environment jsdom
import { it, expect } from "vitest";
import {
  defineSkinContract,
  defineFormFillContract,
  defineWidgetContract,
  defineOverrideContract,
  defineAccessibilityContract,
} from "../../src/testing/index";
import { antdSkin } from "../../src/skin-antd/index";
const suite = {
  test: it,
  assert: {
    equal: (a: unknown, b: unknown) => expect(a).toEqual(b),
    ok: (a: unknown) => expect(a).toBeTruthy(),
  },
};
defineSkinContract(suite, antdSkin);
defineOverrideContract(suite, antdSkin);
defineAccessibilityContract(suite, antdSkin);

defineWidgetContract(suite, antdSkin);

defineFormFillContract(suite, antdSkin);
