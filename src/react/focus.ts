import { MODAL_DIALOG_SELECTOR } from "./dialog-selectors";
import { useLayoutEffect, useRef } from "react";
// The chat's one guarded focus move. The chat never takes focus from
// anything outside it, arriving content never takes focus, and only an
// explicit user action in the chat moves it: either an origin recorded in
// the handler of a press or key event inside the chat, still valid at the
// move, or the handoff after the focused control itself was removed.
// Modal openings also authorize entry into the dialog itself.

/** A press or key action inside the chat that may later move focus. */
export interface FocusOrigin {
  // Who the action belongs to: the client and conversation shown when it
  // was recorded (or the key the caller gave it).
  readonly owner: string;
  readonly action: string;
  readonly root: Element;
  // The focusable control the action came from (the button around a
  // pressed label or icon), or the pressed element when none is focusable.
  readonly control: Element | null;
  // Elements the action opened outside its root (a popup), which count as
  // its own: focus moving into them does not invalidate it.
  readonly owned: Element[];
  // Cleared as soon as focus goes outside the chat.
  valid: boolean;
}

interface Tracker {
  origins: Set<FocusOrigin>;
  // The element of the last focus event anywhere in the document, or null
  // once focus was given up to nothing by the user.
  last: Element | null;
}
const trackers = new WeakMap<Document, Tracker>();

/** The deepest focused element, through open shadow roots. */
export function deepActiveElement(
  start: Document | ShadowRoot,
): Element | null {
  let active = start.activeElement;
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement;
  return active;
}
/** Whether `node` is `root` or inside it, across shadow-root boundaries. */
export function composedContains(root: Node, node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === root) return true;
    current =
      current.parentNode ??
      (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}
/** The element a user event really started on, through shadow roots. */
export function deepTarget(event: Event): EventTarget | null {
  return event.composedPath?.()[0] ?? event.target;
}
// The open modal drawers of a document, oldest first: only the topmost
// one's outside is inert.
interface Containment {
  drawer: Element;
  mark: string;
  set: Element[];
  watch?: MutationObserver;
}
const contained = new WeakMap<Document, Containment[]>();
let containmentId = 0;
// Everything outside the drawer becomes inert: each sibling along the way
// from the drawer up to the document, across shadow-root hosts, that is
// not inert already, and any added there while the drawer is topmost.
function enclose(layer: Containment) {
  const chain = new Set<Node>();
  const parents: Node[] = [];
  const shut = (element: Element) => {
    if (chain.has(element) || element.hasAttribute("inert")) return;
    element.setAttribute("inert", layer.mark);
    layer.set.push(element);
  };
  for (let node: Node = layer.drawer; ;) {
    chain.add(node);
    const slot = node instanceof Element ? node.assignedSlot : null;
    // Assigned nodes have flat-tree siblings in the slot and light-DOM
    // siblings on the host; new nodes can be added in either place.
    if (slot && node.parentNode) parents.push(node.parentNode);
    const parent = slot ?? node.parentNode;
    if (!parent || parent.nodeType === Node.DOCUMENT_NODE) break;
    parents.push(parent);
    node = parent instanceof ShadowRoot ? parent.host : parent;
  }
  for (const parent of parents)
    for (const child of (parent as ParentNode).children) shut(child);
  if (typeof MutationObserver !== "function") return;
  layer.watch = new MutationObserver((records) => {
    for (const record of records)
      for (const added of record.addedNodes)
        if (added instanceof Element) shut(added);
  });
  for (const parent of parents)
    layer.watch.observe(parent, { childList: true });
}
// Undoes exactly what `enclose` did, and nothing a host made inert.
function release(layer: Containment) {
  layer.watch?.disconnect();
  layer.watch = undefined;
  for (const element of layer.set)
    if (element.getAttribute("inert") === layer.mark)
      element.removeAttribute("inert");
  layer.set = [];
}
/**
 * Makes the page outside an open modal drawer unreachable, by keyboard and
 * by assistive technology, as a modal dialog does; the browser keeps its
 * own Tab order inside. Returns the release for when the drawer closes.
 */
export function containFocus(drawer: Element): () => void {
  const document = drawer.ownerDocument;
  const stack = contained.get(document) ?? [];
  contained.set(document, stack);
  const below = stack.at(-1);
  if (below) release(below);
  // A skin may mark the drawer's own root (its mask and focus sentinels
  // beside the dialog), which then stays outside the inert set.
  const layer: Containment = {
    drawer: drawer.closest("[data-wp-modal-root]") ?? drawer,
    mark: `waypoint-${++containmentId}`,
    set: [],
  };
  stack.push(layer);
  enclose(layer);
  return () => {
    const at = stack.indexOf(layer);
    if (at < 0) return;
    release(layer);
    stack.splice(at, 1);
    const top = stack.at(-1);
    // The drawer below becomes the topmost again.
    if (at === stack.length && top) enclose(top);
  };
}
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])';
/**
 * Whether an element can take focus: connected, a focusable kind (not a
 * hidden input), enabled, not hidden or inert, and rendered where the
 * browser can tell.
 */
export function focusable(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element.matches(FOCUSABLE) &&
    !element.matches('input[type="hidden"], :disabled') &&
    !element.closest("[hidden], [inert]") &&
    (typeof element.checkVisibility !== "function" ||
      element.checkVisibility({ visibilityProperty: true }))
  );
}
// The nearest focusable element from `start` up to `root`, across shadow
// roots: the control a press inside it invoked.
function invokingControl(start: Element | null, root: Element): Element | null {
  for (let node: Node | null = start; node;) {
    if (node instanceof Element && focusable(node)) return node;
    if (node === root) return null;
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return null;
}
/** Whether deep focus is the root or inside it. */
export function focusInside(root: Element): boolean {
  return composedContains(root, deepActiveElement(root.ownerDocument));
}
const nowhere = (document: Document) => {
  const active = deepActiveElement(document);
  return !active || active === document.body;
};

function tracker(document: Document): Tracker {
  let found = trackers.get(document);
  if (found) return found;
  const created: Tracker = { origins: new Set(), last: null };
  found = created;
  trackers.set(document, created);
  document.addEventListener(
    "focusin",
    (event) => {
      const target = deepTarget(event) as Element | null;
      created.last = target;
      for (const origin of created.origins)
        if (
          !composedContains(origin.root, target) &&
          !origin.owned.some((element) => composedContains(element, target))
        ) {
          origin.valid = false;
          created.origins.delete(origin);
        }
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (event) => {
      const element = deepTarget(event) as Element | null;
      if ((event as FocusEvent).relatedTarget) return;
      // Focus given up to nothing while the element stays: the user left
      // (a removal disconnects it first). Not from an open modal drawer:
      // there Tab passes through the browser's own controls and back.
      queueMicrotask(() => {
        if (!element?.isConnected || !nowhere(document)) return;
        const modal = contained.get(document)?.at(-1)?.drawer;
        if (modal && composedContains(modal, element)) return;
        created.last = null;
        for (const origin of created.origins) origin.valid = false;
        created.origins.clear();
      });
    },
    true,
  );
  // A press made while the focused control is gone and focus is nowhere
  // (on text that takes no focus): the user acted, so the removal handoff
  // ends rather than moving focus whenever a destination appears.
  document.addEventListener(
    "pointerdown",
    () => {
      if (created.last && !created.last.isConnected && nowhere(document))
        created.last = null;
    },
    true,
  );
  return created;
}
/** Ends an origin: it authorizes nothing more and is no longer kept. */
export function retireOrigin(origin: FocusOrigin | undefined): void {
  if (!origin) return;
  origin.valid = false;
  trackers.get(origin.root.ownerDocument)?.origins.delete(origin);
}
/** Ends every origin of a chat root that is going away. */
export function forgetRoot(root: Element): void {
  const found = trackers.get(root.ownerDocument);
  if (!found) return;
  for (const origin of found.origins)
    if (composedContains(root, origin.root)) retireOrigin(origin);
}
/** How many origins a document keeps (for lifetime checks). */
export function keptOrigins(document: Document): number {
  return trackers.get(document)?.origins.size ?? 0;
}
/** Starts watching a document's focus, so origins and removals can be judged. */
export function watchFocus(document: Document): void {
  tracker(document);
}

/**
 * Records an origin from a press or key event handled in the chat; none when
 * the event really started outside the chat root.
 */
export function recordOrigin(
  event: Event | { nativeEvent: Event },
  root: Element,
  owner: string,
  action: string,
): FocusOrigin | undefined {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  const target = deepTarget(native) as Element | null;
  if (!composedContains(root, target)) return undefined;
  const origin: FocusOrigin = {
    owner,
    action,
    root,
    control: invokingControl(target, root) ?? target,
    owned: [],
    valid: true,
  };
  tracker(root.ownerDocument).origins.add(origin);
  return origin;
}

const modalRemovals = new WeakMap<Element, Element>();
/** Remembers focus ownership before a modal's portaled descendants unmount. */
export function rememberModalRemoval(element: HTMLElement): void {
  const active = deepActiveElement(element.ownerDocument);
  if (active && composedContains(element, active)) {
    tracker(element.ownerDocument).last = active;
    modalRemovals.set(element, active);
  }
}

/** The handoff after the focused control was removed (G3). */
function handoff(removed: Element | null | undefined, document: Document) {
  if (!removed) return false;
  const { last } = tracker(document);
  return (
    !!last &&
    // Focus may have been deep in a shadow tree inside the removed element.
    (composedContains(removed, last) || modalRemovals.get(removed) === last) &&
    !last.isConnected &&
    nowhere(document)
  );
}

export interface MoveFocusOptions {
  root: Element;
  // Whose move this is, compared with the origin's owner.
  owner: string;
  origin?: FocusOrigin;
  // The control whose removal this move hands focus on from.
  removed?: Element | null;
  // The action (plan, record, drawer, switch) is still current.
  stillCurrent?: () => boolean;
  preventScroll?: boolean;
  // Only entry into the modal itself.
  enterModal?: boolean;
  // Called when the move was authorized but focus did not land (the target
  // cannot take focus), so the caller may try a fallback.
  missed?: () => void;
}
/** Moves focus to `target` only when authorized now; otherwise nothing. */
export function moveFocus(
  target: HTMLElement | null | undefined,
  options: MoveFocusOptions,
): boolean {
  const { root, origin, removed } = options;
  if (!target || !target.isConnected) return false;
  const document = root.ownerDocument;
  tracker(document);
  if (options.stillCurrent && !options.stillCurrent()) return false;
  const authorized = origin
    ? origin.valid &&
      origin.owner === options.owner &&
      (focusInside(root) || handoff(removed ?? origin.control, document))
    : handoff(removed, document) ||
      (options.enterModal === true &&
        target === root &&
        target.matches(MODAL_DIALOG_SELECTOR));
  if (!authorized) return false;
  target.focus({ preventScroll: options.preventScroll ?? false });
  // Only a focus that landed counts as moved.
  const landed = deepActiveElement(document) === target;
  // Within one shadow root, focus events may not reach the document.
  if (landed) tracker(document).last = target;
  else options.missed?.();
  return landed;
}
// The removal handoffs of a document still waiting for their destination.
const waitingByDocument = new WeakMap<Document, Set<object>>();
const waitingHandoffs = (document: Document) => {
  let found = waitingByDocument.get(document);
  if (!found) waitingByDocument.set(document, (found = new Set()));
  return found;
};
/** How many removal handoffs a document has waiting (for lifetime checks). */
export function pendingHandoffs(document: Document): number {
  return waitingByDocument.get(document)?.size ?? 0;
}
/**
 * A removal handoff (G3) for a region: remembers the element focus entered;
 * after a render that removed it while focus went nowhere, the first target
 * still there takes focus.
 */
export function useHandoff(targets: () => (Element | null | undefined)[]) {
  const last = useRef<Element | null>(null);
  const self = useRef({});
  // The guard sees focus from the start, so a later removal can be judged.
  useLayoutEffect(() => {
    watchFocus(document);
    const waiting = waitingHandoffs(document);
    const token = self.current;
    return () => void waiting.delete(token);
  }, []);
  useLayoutEffect(() => {
    const waiting = waitingHandoffs(document);
    const removed = last.current;
    if (!removed || removed.isConnected)
      return void waiting.delete(self.current);
    // Once focus went elsewhere the guard can never allow this handoff
    // again: stop waiting for a destination.
    if (!handoff(removed, document)) {
      last.current = null;
      return void waiting.delete(self.current);
    }
    // No target yet (the content that replaces it is still loading): wait
    // for a later render while focus is still nowhere.
    const target = targets().find((element) => element?.isConnected);
    if (!(target instanceof HTMLElement)) return void waiting.add(self.current);
    last.current = null;
    waiting.delete(self.current);
    moveFocus(target, { root: target, owner: "", removed });
  });
  return (event: { target: EventTarget }) => {
    last.current = event.target as Element;
  };
}
