// @vitest-environment jsdom
// The one guarded focus move: an origin recorded in an in-chat event, or a
// removal handoff, authorizes it at the moment of the move; nothing else.
import { afterEach, describe, expect, it } from "vitest";
import {
  composedContains,
  deepActiveElement,
  moveFocus,
  recordOrigin,
  rememberModalRemoval,
  watchFocus,
} from "../../src/react/focus";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("tabindex");
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  // The chat watches its document from mount on.
  watchFocus(document);
  const root = document.createElement("section");
  const control = document.createElement("button");
  const target = document.createElement("button");
  root.append(control, target);
  const host = document.createElement("button");
  host.textContent = "host";
  document.body.append(root, host);
  return { root, control, target, host };
}
// An event as an in-chat handler receives it.
const pressOn = (element: Element) => {
  const event = new MouseEvent("click", { bubbles: true, composed: true });
  let seen: Event | undefined;
  element.addEventListener("click", (e) => (seen = e), { once: true });
  element.dispatchEvent(event);
  return seen!;
};

describe("moveFocus with an origin (G2)", () => {
  it("CK-G2-positive an origin from an in-chat press moves focus", () => {
    const { root, control, target } = setup();
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    expect(origin).toBeDefined();
    expect(
      moveFocus(target, {
        origin,
        root,
        owner: "c",
        stillCurrent: () => true,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(target);
  });
  it("CK-G2-control a press on a nested label records the button around it", () => {
    const { root, control } = setup();
    const label = document.createElement("span");
    control.append(label);
    control.focus();
    const origin = recordOrigin(pressOn(label), root, "c", "keep");
    expect(origin?.control).toBe(control);
  });
  it("CK-G2-landed a move to an element that cannot take focus does not count", () => {
    const { root, control } = setup();
    const span = document.createElement("span");
    root.append(span);
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    expect(moveFocus(span, { origin, root, owner: "c" })).toBe(false);
    expect(document.activeElement).toBe(control);
  });
  it("CK-G2-none without an origin or a removed element nothing moves", () => {
    const { root, control, target } = setup();
    control.focus();
    expect(moveFocus(target, { root, owner: "c" })).toBe(false);
    expect(document.activeElement).toBe(control);
  });
  it("CK-G2-host an event from outside the chat records no origin", () => {
    const { root, host } = setup();
    expect(recordOrigin(pressOn(host), root, "c", "keep")).toBeUndefined();
  });
  it("CK-G2-invalidated a focus outside the chat after the press invalidates it", () => {
    const { root, control, target, host } = setup();
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    host.focus();
    control.focus();
    expect(moveFocus(target, { origin, root, owner: "c" })).toBe(false);
    expect(document.activeElement).toBe(control);
  });
  it("CK-G2-left a user focusout to nothing invalidates it", async () => {
    const { root, control, target } = setup();
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    control.blur();
    await flush();
    control.focus();
    expect(moveFocus(target, { origin, root, owner: "c" })).toBe(false);
  });
  it("CK-G2-conversation another conversation refuses it", () => {
    const { root, control, target } = setup();
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    expect(moveFocus(target, { origin, root, owner: "d" })).toBe(false);
  });
  it("CK-G2-current an action no longer current refuses it", () => {
    const { root, control, target } = setup();
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    expect(
      moveFocus(target, {
        origin,
        root,
        owner: "c",
        stillCurrent: () => false,
      }),
    ).toBe(false);
  });
  it("CK-G2-outside focus outside the chat at the move refuses it, even with a valid origin", () => {
    const { root, control, target, host } = setup();
    control.focus();
    const origin = recordOrigin(pressOn(control), root, "c", "keep");
    // Focus that moved without an event the guard saw (a detached tracker).
    origin!.valid = true;
    host.focus();
    origin!.valid = true;
    expect(moveFocus(target, { origin, root, owner: "c" })).toBe(false);
    expect(document.activeElement).toBe(host);
  });
});

describe("moveFocus as a removal handoff (G3)", () => {
  it("CK-G3-positive the focused control removed with nothing in between hands focus over", () => {
    const { root, control, target } = setup();
    control.focus();
    control.remove();
    expect(
      moveFocus(target, {
        removed: control,
        root,
        owner: "c",
        stillCurrent: () => true,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(target);
  });
  it("CK-G3-host a host focus between focus and removal refuses it", () => {
    const { root, control, target, host } = setup();
    control.focus();
    host.focus();
    control.remove();
    expect(moveFocus(target, { removed: control, root, owner: "c" })).toBe(
      false,
    );
    expect(document.activeElement).toBe(host);
  });
  it("CK-G3-body a focused host body between focus and removal refuses it", () => {
    const { root, control, target } = setup();
    document.body.tabIndex = -1;
    control.focus();
    document.body.focus();
    control.remove();
    expect(moveFocus(target, { removed: control, root, owner: "c" })).toBe(
      false,
    );
    expect(document.activeElement).toBe(document.body);
  });
  it("CK-G3-left a user focusout to nothing before removal refuses it", async () => {
    const { root, control, target } = setup();
    control.focus();
    control.blur();
    await flush();
    control.remove();
    expect(moveFocus(target, { removed: control, root, owner: "c" })).toBe(
      false,
    );
  });
  it("CK-G3-current another conversation or action refuses it", () => {
    const { root, control, target } = setup();
    control.focus();
    control.remove();
    expect(
      moveFocus(target, {
        removed: control,
        root,
        owner: "c",
        stillCurrent: () => false,
      }),
    ).toBe(false);
  });
  it("CK-G3-other focus that moved on to another control, removed too, is not this control's handoff", () => {
    const { root, control, target } = setup();
    const other = document.createElement("button");
    root.append(other);
    control.focus();
    other.focus();
    control.remove();
    other.remove();
    expect(moveFocus(target, { removed: control, root, owner: "c" })).toBe(
      false,
    );
  });
  it("CK-G3-unseen focus that moved without a focus event the guard saw still refuses it", () => {
    const { root, control, target, host } = setup();
    control.focus();
    control.remove();
    // A host page that swallows focusin before the document sees it.
    const swallow = (event: Event) => event.stopImmediatePropagation();
    window.addEventListener("focusin", swallow, true);
    host.focus();
    window.removeEventListener("focusin", swallow, true);
    expect(moveFocus(target, { removed: control, root, owner: "c" })).toBe(
      false,
    );
    expect(document.activeElement).toBe(host);
  });
  it("CK-G5 a refusal moves nothing and tries no other target", () => {
    const { root, control, target, host } = setup();
    host.focus();
    expect(moveFocus(target, { removed: control, root, owner: "c" })).toBe(
      false,
    );
    expect(document.activeElement).toBe(host);
  });
});

describe("deep focus", () => {
  it("follows shadow roots and contains across them", () => {
    const { root } = setup();
    const hostEl = document.createElement("div");
    root.append(hostEl);
    const shadow = hostEl.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.append(input);
    input.focus();
    expect(deepActiveElement(document)).toBe(input);
    expect(composedContains(root, input)).toBe(true);
    const outside = document.createElement("div");
    document.body.append(outside);
    const outsideShadow = outside.attachShadow({ mode: "open" });
    const editor = document.createElement("input");
    outsideShadow.append(editor);
    editor.focus();
    expect(composedContains(root, deepActiveElement(document))).toBe(false);
  });
});

describe("modal entry without a press", () => {
  it("enters only the modal itself, while the opening is current", () => {
    const { control, target } = setup();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    document.body.append(dialog);
    control.focus();
    expect(
      moveFocus(target, { root: target, owner: "", enterModal: true }),
    ).toBe(false);
    expect(
      moveFocus(dialog, {
        root: dialog,
        owner: "",
        enterModal: true,
        stillCurrent: () => false,
      }),
    ).toBe(false);
    expect(document.activeElement).toBe(control);
    expect(
      moveFocus(dialog, { root: dialog, owner: "", enterModal: true }),
    ).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });
});

describe("modal removal handoff evidence", () => {
  it.each(["focused control", "modal"])(
    "preserves the %s handoff before portal teardown",
    (removed) => {
      const { root, target } = setup();
      const modal = document.createElement("div");
      const host = document.createElement("span");
      const shadow = host.attachShadow({ mode: "open" });
      const control = document.createElement("button");
      shadow.append(control);
      modal.append(host);
      root.append(modal);
      control.focus();
      rememberModalRemoval(modal);
      if (removed === "modal") control.remove();
      modal.remove();
      expect(
        moveFocus(target, {
          root,
          owner: "",
          removed: removed === "modal" ? modal : control,
        }),
      ).toBe(true);
      expect(document.activeElement).toBe(target);
    },
  );
});
