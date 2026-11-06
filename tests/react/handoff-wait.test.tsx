// @vitest-environment jsdom
// A removal handoff waits for its destination only while it could still be
// authorized: once the user has focused something else, it stops waiting.
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { pendingHandoffs, useHandoff } from "../../src/react/focus";

afterEach(cleanup);

function Region({
  removable,
  target,
}: {
  removable: boolean;
  target: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const handoff = useHandoff(() => [
    box.current?.querySelector<HTMLElement>("[data-target]"),
  ]);
  return (
    <>
      <div ref={box} onFocus={handoff}>
        {removable ? <button>Remove me</button> : null}
        {target ? <button data-target="">Replacement</button> : null}
      </div>
      <button data-outside="">Elsewhere</button>
    </>
  );
}

function removeFocused() {
  const view = render(<Region removable target={false} />);
  act(() => view.getByText("Remove me").focus());
  view.rerender(<Region removable={false} target={false} />);
  return view;
}

it("waits while focus is still nowhere, then hands focus to the destination", () => {
  const view = removeFocused();
  expect(pendingHandoffs(document)).toBe(1);
  view.rerender(<Region removable={false} target />);
  expect(document.activeElement).toBe(view.getByText("Replacement"));
  expect(pendingHandoffs(document)).toBe(0);
});

it("stops waiting once the user focused something else", () => {
  const view = removeFocused();
  expect(pendingHandoffs(document)).toBe(1);
  const elsewhere = view.getByText("Elsewhere");
  act(() => elsewhere.focus());
  view.rerender(<Region removable={false} target={false} />);
  expect(pendingHandoffs(document)).toBe(0);
  view.rerender(<Region removable={false} target />);
  expect(document.activeElement).toBe(elsewhere);
  expect(pendingHandoffs(document)).toBe(0);
});

it("stops waiting when the region goes away", () => {
  const view = removeFocused();
  expect(pendingHandoffs(document)).toBe(1);
  view.unmount();
  expect(pendingHandoffs(document)).toBe(0);
});

it("stops waiting once the user pressed somewhere while focus was nowhere", () => {
  const view = removeFocused();
  // A press on text that takes no focus: the user acted, so focus arriving
  // later would be a surprise.
  act(() => {
    document.body.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );
  });
  view.rerender(<Region removable={false} target={false} />);
  expect(pendingHandoffs(document)).toBe(0);
  view.rerender(<Region removable={false} target />);
  expect(document.activeElement).toBe(document.body);
});

it("waits and then hands focus on under StrictMode's double effects", () => {
  const strict = (removable: boolean, target: boolean) => (
    <StrictMode>
      <Region removable={removable} target={target} />
    </StrictMode>
  );
  const view = render(strict(true, false));
  act(() => view.getByText("Remove me").focus());
  view.rerender(strict(false, false));
  expect(pendingHandoffs(document)).toBe(1);
  view.rerender(strict(false, true));
  expect(document.activeElement).toBe(view.getByText("Replacement"));
  expect(pendingHandoffs(document)).toBe(0);
  view.unmount();
  expect(pendingHandoffs(document)).toBe(0);
});
