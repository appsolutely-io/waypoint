// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { FieldAdornment } from "../../src/react/field-adornment";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("shows on parent hover, hides at 400ms, cancels hide on reentry and announces focus", () => {
  vi.useFakeTimers();
  const view = render(
    <FieldAdornment label="Regenerate title" onRegenerate={() => {}}>
      <input aria-label="Title" />
    </FieldAdornment>,
  );
  const parent = view.container.firstElementChild!;
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.pointerEnter(parent);
  expect(
    screen.getByRole("button", { name: "Regenerate title" }),
  ).toBeDefined();
  fireEvent.pointerLeave(parent);
  act(() => vi.advanceTimersByTime(399));
  expect(screen.getByRole("button")).toBeDefined();
  fireEvent.pointerEnter(parent);
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("button")).toBeDefined();
  fireEvent.pointerLeave(parent);
  act(() => vi.advanceTimersByTime(400));
  expect(screen.queryByRole("button")).toBeNull();
  act(() => screen.getByRole("textbox").focus());
  expect(screen.getByRole("button")).toBeDefined();
  expect(screen.getByRole("status").textContent).toBe("Regenerate title");
  fireEvent.pointerLeave(parent);
  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByRole("button")).toBeDefined();
  act(() => screen.getByRole("button").focus());
  expect(screen.getByRole("button")).toBeDefined();
  view.unmount();
});
it("clears the scheduled hide timer specifically on unmount", () => {
  vi.useFakeTimers();
  const view = render(
    <FieldAdornment label="Regenerate title" onRegenerate={() => {}}>
      <input aria-label="Title" />
    </FieldAdornment>,
  );
  const schedule = vi.spyOn(globalThis, "setTimeout");
  const clear = vi.spyOn(globalThis, "clearTimeout");
  fireEvent.pointerLeave(view.container.firstElementChild!);
  const handle = schedule.mock.results.at(-1)!.value;
  expect(handle).toBeDefined();
  clear.mockClear();
  view.unmount();
  expect(clear).toHaveBeenCalledWith(handle);
  schedule.mockRestore();
  clear.mockRestore();
});
it("CK-FF10 a hover reveals the adornment but says nothing; focus says it", () => {
  const view = render(
    <FieldAdornment label="Regenerate title" onRegenerate={() => {}}>
      <input aria-label="Title" />
    </FieldAdornment>,
  );
  const parent = view.container.firstElementChild!;
  fireEvent.pointerEnter(parent);
  expect(
    screen.getByRole("button", { name: "Regenerate title" }),
  ).toBeDefined();
  expect(screen.getByRole("status").textContent).toBe("");
  act(() => screen.getByRole("textbox").focus());
  expect(screen.getByRole("status").textContent).toBe("Regenerate title");
});
