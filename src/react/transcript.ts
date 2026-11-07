// Where the transcript box rests: at the latest message while pinned, and
// otherwise wherever the user put it, with the message at the top of the
// box staying put while content above or below it changes. Only the user's
// own scrolls (a wheel, touch, pointer or scrolling key followed by a box
// scroll) change the pin; every scroll the chat or the browser's layout
// makes is geometry and leaves it alone.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { composedContains, deepActiveElement } from "./focus";

/** How near the end, in CSS pixels, a downward user scroll pins. */
export const PIN_DISTANCE = 24;
/** How long after its last input or scroll a user gesture lasts, in ms. */
export const GESTURE_IDLE_MS = 150;
// How long a position the chat set is recognised as its own scroll.
const OWN_SCROLL_MS = 100;
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
const MESSAGE = "[data-message-id]";

interface Token {
  used: boolean;
  held: boolean;
  lastInput: number;
  lastScroll: number;
  timer?: ReturnType<typeof setTimeout>;
}
interface Anchor {
  id: string;
  offset: number;
  order: string[];
}

export const maxTop = (box: Element) =>
  Math.max(0, box.scrollHeight - box.clientHeight);
export const endDistance = (box: Element) =>
  box.scrollHeight - box.clientHeight - box.scrollTop;
const now = () => performance.now();
const nextFrame = (callback: () => void) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 16);
const messagesIn = (box: Element) =>
  [...box.querySelectorAll<HTMLElement>(MESSAGE)].filter(
    (element) => element.closest(".wp-transcript") === box,
  );
const idOf = (element: Element) => element.getAttribute("data-message-id")!;

export interface TranscriptPosition {
  pinned: boolean;
  /** T8: to the end, pinned. */
  toLatest(): void;
  /** T9: the message's top to the top of the box; false when it is gone. */
  toMessage(messageId: string): HTMLElement | undefined;
  /** The message the box keeps in place while not pinned, if any. */
  anchorId(): string | undefined;
}

export function useTranscriptPosition(
  box: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  conversationId: string | undefined,
  count: number,
  // Changes with each snapshot; geometry is reconciled after each.
  snapshot: unknown,
): TranscriptPosition {
  const [pinned, setPinnedState] = useState(true);
  const state = useRef({
    pinned: true,
    token: undefined as Token | undefined,
    expected: [] as { top: number; at: number }[],
    lastTop: 0,
    sizeFrame: false,
    anchor: undefined as Anchor | undefined,
    shown: undefined as string | undefined,
  }).current;
  const setPinned = (value: boolean) => {
    state.pinned = value;
    setPinnedState(value);
  };
  const endToken = () => {
    clearTimeout(state.token?.timer);
    state.token = undefined;
  };
  // T10: every scroll the chat starts is instant.
  const setTop = (element: HTMLElement, top: number) => {
    const target = Math.min(Math.max(0, top), maxTop(element));
    state.expected.push({ top: target, at: now() });
    if (typeof element.scrollTo === "function")
      element.scrollTo({ top: target, behavior: "instant" });
    else element.scrollTop = target;
    state.lastTop = element.scrollTop;
  };
  const recordAnchor = (element: HTMLElement) => {
    const top = element.getBoundingClientRect().top;
    const messages = messagesIn(element);
    const first = messages.find(
      (message) => message.getBoundingClientRect().bottom > top + 0.5,
    );
    state.anchor = first && {
      id: idOf(first),
      offset: first.getBoundingClientRect().top - top,
      order: messages.map(idOf),
    };
  };
  // T5: the anchor message, or the nearest remaining one, keeps its offset.
  const restoreAnchor = (element: HTMLElement) => {
    const anchor = state.anchor;
    if (!anchor) return recordAnchor(element);
    const byId = new Map(
      messagesIn(element).map((message) => [idOf(message), message]),
    );
    const at = anchor.order.indexOf(anchor.id);
    const target =
      byId.get(anchor.id) ??
      anchor.order
        .slice(at + 1)
        .map((id) => byId.get(id))
        .find(Boolean) ??
      anchor.order
        .slice(0, Math.max(0, at))
        .reverse()
        .map((id) => byId.get(id))
        .find(Boolean);
    if (!target) setTop(element, 0);
    else {
      const delta =
        target.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        anchor.offset;
      if (Math.abs(delta) > 0.5) setTop(element, element.scrollTop + delta);
    }
    recordAnchor(element);
  };
  const reconcile = () => {
    const element = box.current;
    if (!element) return;
    // An input that has scrolled nothing ends here, unless its pointer or
    // touch is still held: a drag may rest before it moves.
    if (state.token && !state.token.used && !state.token.held) endToken();
    if (state.pinned) {
      if (endDistance(element) > 0.5) setTop(element, maxTop(element));
    } else restoreAnchor(element);
  };
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;

  // T1, T6 and the geometry reconciliation after each snapshot.
  useLayoutEffect(() => {
    const empty = count === 0;
    // While empty there is nothing to scroll, so empty to non-empty starts
    // pinned too.
    if (conversationId !== state.shown || empty) {
      state.shown = conversationId;
      state.anchor = undefined;
      endToken();
      if (!state.pinned) setPinned(true);
    }
    reconcile();
  }, [snapshot, conversationId, count]);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const document = element.ownerDocument;
    const scheduleEnd = (token: Token) => {
      clearTimeout(token.timer);
      const check = () => {
        if (state.token !== token || token.held) return;
        const idle = now() - Math.max(token.lastInput, token.lastScroll);
        if (idle >= GESTURE_IDLE_MS) state.token = undefined;
        else token.timer = setTimeout(check, GESTURE_IDLE_MS - idle);
      };
      token.timer = setTimeout(check, GESTURE_IDLE_MS);
    };
    const input = (held?: boolean) => {
      const token = (state.token ??= {
        used: false,
        held: false,
        lastInput: 0,
        lastScroll: 0,
      });
      token.lastInput = now();
      if (held) token.held = true;
      scheduleEnd(token);
    };
    const release = () => {
      const token = state.token;
      if (!token?.held) return;
      token.held = false;
      scheduleEnd(token);
    };
    const onWheel = () => input();
    const onHeld = () => input(true);
    const onKey = (event: KeyboardEvent) => {
      if (
        SCROLL_KEYS.has(event.key) &&
        composedContains(element, deepActiveElement(document))
      )
        input();
    };
    const onScroll = () => {
      const top = element.scrollTop;
      const previous = state.lastTop;
      state.lastTop = top;
      const at = now();
      state.expected = state.expected.filter(
        (entry) => at - entry.at < OWN_SCROLL_MS,
      );
      const own = state.expected.findIndex(
        (entry) => Math.abs(entry.top - top) <= 1,
      );
      const token = state.token;
      const max = maxTop(element);
      // A browser clamp: content shrank under the position, which is now the
      // new maximum. Its event can arrive frames after the size change.
      const clamped = Math.abs(top - max) <= 1 && previous > max + 0.5;
      const geometry =
        own >= 0 ||
        !token ||
        clamped ||
        (state.sizeFrame && Math.abs(top - max) <= 1);
      if (own >= 0) state.expected.splice(0, own + 1);
      if (!geometry) {
        token.used = true;
        token.lastScroll = at;
        scheduleEnd(token);
        if (top < previous - 0.5) setPinned(false);
        else if (
          top > previous + 0.5 &&
          endDistance(element) <= PIN_DISTANCE &&
          !state.pinned
        )
          setPinned(true);
      }
      if (!state.pinned) recordAnchor(element);
    };
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("touchstart", onHeld, { passive: true });
    element.addEventListener("touchmove", onWheel, { passive: true });
    element.addEventListener("pointerdown", onHeld);
    element.addEventListener("keydown", onKey);
    element.addEventListener("scroll", onScroll, { passive: true });
    for (const type of [
      "pointerup",
      "pointercancel",
      "touchend",
      "touchcancel",
    ])
      document.addEventListener(type, release, true);
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            state.sizeFrame = true;
            nextFrame(() => (state.sizeFrame = false));
            reconcileRef.current();
          })
        : undefined;
    observer?.observe(element);
    if (content.current) observer?.observe(content.current);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchstart", onHeld);
      element.removeEventListener("touchmove", onWheel);
      element.removeEventListener("pointerdown", onHeld);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("scroll", onScroll);
      for (const type of [
        "pointerup",
        "pointercancel",
        "touchend",
        "touchcancel",
      ])
        document.removeEventListener(type, release, true);
      observer?.disconnect();
      endToken();
    };
  }, [box, content]);

  return {
    pinned,
    anchorId: () => (state.pinned ? undefined : state.anchor?.id),
    toLatest() {
      const element = box.current;
      if (!element) return;
      endToken();
      setTop(element, maxTop(element));
      setPinned(true);
    },
    toMessage(messageId) {
      const element = box.current;
      const message =
        element &&
        messagesIn(element).find((candidate) => idOf(candidate) === messageId);
      if (!element || !message) return undefined;
      endToken();
      const target = Math.min(
        maxTop(element),
        element.scrollTop +
          message.getBoundingClientRect().top -
          element.getBoundingClientRect().top,
      );
      setTop(element, target);
      const pin = maxTop(element) - target <= PIN_DISTANCE;
      setPinned(pin);
      if (!pin) recordAnchor(element);
      return message;
    },
  };
}
