// @vitest-environment jsdom
import { it, expect } from "vitest";
import {
  defineSkinContract,
  defineFormFillContract,
  defineWidgetContract,
  defineOverrideContract,
  defineAccessibilityContract,
} from "../../src/testing/index";
const suite = {
  test: it,
  assert: {
    equal: (a: unknown, b: unknown) => expect(a).toEqual(b),
    ok: (a: unknown) => expect(a).toBeTruthy(),
  },
};
defineSkinContract(suite);
defineOverrideContract(suite);
defineAccessibilityContract(suite);

defineWidgetContract(suite);

defineFormFillContract(suite);
