import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { expect, it } from "vitest";
import { pageErrors } from "./page-errors";

it("records page exceptions and error-level console output", () => {
  const events = new EventEmitter();
  const errors = pageErrors(events as unknown as Page);
  events.emit("console", { type: () => "warning", text: () => "A warning" });
  expect(errors).toEqual([]);
  events.emit("console", { type: () => "error", text: () => "Render failed" });
  events.emit("pageerror", new Error("Unhandled failure"));
  expect(errors).toEqual(["Render failed", "Unhandled failure"]);
});

it("allows one expected console line without hiding exceptions or other errors", () => {
  const events = new EventEmitter();
  const expected =
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
  const errors = pageErrors(events as unknown as Page, expected);
  events.emit("pageerror", new Error(expected));
  events.emit("console", {
    type: () => "error",
    text: () => "Unexpected render failure",
  });
  events.emit("console", { type: () => "error", text: () => expected });
  events.emit("console", { type: () => "error", text: () => expected });
  expect(errors).toEqual([expected, "Unexpected render failure", expected]);
});

it("allows the exact antd React diagnostic only while the antd skin is selected", () => {
  const events = new EventEmitter();
  let skin = "neutral";
  const page = Object.assign(events, {
    url: () => `http://127.0.0.1:43301/?skin=${skin}`,
  });
  const errors = pageErrors(page as unknown as Page);
  const diagnostic =
    "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release.";
  const emitError = (text: string) =>
    events.emit("console", { type: () => "error", text: () => text });
  emitError(diagnostic);
  expect(errors).toEqual([diagnostic]);
  skin = "antd";
  emitError(diagnostic);
  expect(errors).toEqual([diagnostic]);
  emitError(`${diagnostic} Unexpected detail`);
  emitError("Unexpected render failure");
  events.emit("pageerror", new Error(diagnostic));
  skin = "neutral";
  emitError(diagnostic);
  expect(errors).toEqual([
    diagnostic,
    `${diagnostic} Unexpected detail`,
    "Unexpected render failure",
    diagnostic,
    diagnostic,
  ]);
});
