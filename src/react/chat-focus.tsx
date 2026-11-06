// The chat's focus context: which element is the chat, which conversation
// it shows, and the user event it is handling now, so a press or key
// handler can record the origin a later focus move needs.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
  type SyntheticEvent,
} from "react";
import type { DrawerProps } from "./ui";
import {
  composedContains,
  deepActiveElement,
  focusable,
  forgetRoot,
  moveFocus,
  recordOrigin,
  rememberModalRemoval,
  retireOrigin,
  containFocus,
  watchFocus,
  type FocusOrigin,
} from "./focus";

export interface ChatFocus {
  root(): HTMLElement | null;
  /** Who the chat's actions belong to now: its client and shown conversation. */
  owner(): string;
  /**
   * The owner a conversation of the chat's current client would have. Take
   * it in the handler of the press, never after an await: by then the chat
   * may show another client.
   */
  ownerOf(conversationId: string): string;
  /** An origin from the user event being handled now, if it began in the chat. */
  originFor(action: string, owner?: string): FocusOrigin | undefined;
  composer(): HTMLElement | null;
  transcript(): HTMLElement | null;
}
export const ChatFocusContext = createContext<ChatFocus | null>(null);
export const useChatFocus = () => useContext(ChatFocusContext);

// Each client instance gets its own tag, so two clients that show the
// same conversation id still own their actions apart.
const clientTags = new WeakMap<object, number>();
let nextClientTag = 0;
/** The owner key of a conversation as shown by one client instance. */
export function ownerKey(client: object, conversationId: string): string {
  let tag = clientTags.get(client);
  if (tag === undefined) clientTags.set(client, (tag = ++nextClientTag));
  return `${tag}:${conversationId}`;
}

/** The chat root's focus wiring: its context and its capture handlers. */
export function useChatFocusRoot(
  root: RefObject<HTMLElement | null>,
  owner: string,
  composer: RefObject<HTMLElement | null>,
  transcript: RefObject<HTMLElement | null>,
  ownerOf: (conversationId: string) => string = (id) => id,
) {
  const interaction = useRef<Event | null>(null);
  const shown = useRef(owner);
  shown.current = owner;
  const of = useRef(ownerOf);
  of.current = ownerOf;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    watchFocus(element.ownerDocument);
    return () => forgetRoot(element);
  }, [root]);
  const value = useMemo<ChatFocus>(
    () => ({
      root: () => root.current,
      owner: () => shown.current,
      ownerOf: (id) => of.current(id),
      originFor(action, key) {
        const event = interaction.current;
        const element = root.current;
        return event && element
          ? recordOrigin(event, element, key ?? shown.current, action)
          : undefined;
      },
      composer: () => composer.current,
      transcript: () => transcript.current,
    }),
    // A new value per owner, so what it opened can retire.
    [root, composer, transcript, owner],
  );
  // The event is the one being handled until the task that dispatched it
  // ends: its listeners and the renders it causes. A browser drains
  // microtasks between the native listeners of one trusted event (React's
  // capture and bubble listeners among them) and commits a press's update
  // in a microtask, so a microtask is too soon to forget it.
  const capture = (event: SyntheticEvent) => {
    const native = event.nativeEvent;
    interaction.current = native;
    untilTaskEnds(() => {
      if (interaction.current === native) interaction.current = null;
    });
  };
  return {
    value,
    captureProps: {
      onClickCapture: capture,
      onKeyDownCapture: capture,
      onPointerDownCapture: capture,
    },
  };
}

/**
 * Retires what was opened in one conversation once another is shown: while
 * `active`, a change of `conversationId` calls `retire` once and the result
 * is true until the next opening.
 */
export function useRetiredOnSwitch(
  active: boolean,
  conversationId: string | undefined,
  retire: () => void,
): boolean {
  const [opening, setOpening] = useState({ active, conversationId });
  if (opening.active !== active) setOpening({ active, conversationId });
  const retired =
    active && opening.active && opening.conversationId !== conversationId;
  const latest = useRef(retire);
  latest.current = retire;
  useEffect(() => {
    if (retired) latest.current();
  }, [retired]);
  return retired;
}

/** Runs `forget` once the current task, and its microtasks, are done. */
const untilTaskEnds = (forget: () => void) => setTimeout(forget, 0);

/** Whether an element accepts typing (button-like inputs do not). */
export function isEditable(element: Element | null): boolean {
  return Boolean(
    element?.closest(
      'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="image"])',
    ),
  );
}
/** Deep focus is inside `element` and not where the user is typing. */
export function focusRestsIn(element: Element | null): boolean {
  if (!element) return false;
  const active = deepActiveElement(element.ownerDocument);
  return composedContains(element, active) && !isEditable(active);
}
export interface FocusForOptions {
  // The press or key action this move answers, if any.
  origin?: FocusOrigin;
  // Whose move this is (`ChatFocus.owner()` or `ownerOf()`).
  owner: string;
  stillCurrent?: () => boolean;
  // The focused element whose removal hands focus on (G3).
  removed?: Element | null;
  // Where to go instead when `target` cannot take focus, under the same
  // guards; a refusal tries nothing else.
  fallback?: HTMLElement | null;
  // The origin is needed again (a drawer's or an alert's way back);
  // otherwise this move settles it.
  keep?: boolean;
}
/** Moves focus to `target` for an action the user started in this chat. */
export function focusFor(
  focus: ChatFocus | null,
  target: HTMLElement | null | undefined,
  options: FocusForOptions,
): boolean {
  const { origin, removed, fallback } = options;
  const root = focus?.root();
  const attempt = (
    element: HTMLElement | null | undefined,
    missed?: () => void,
  ) =>
    !!root &&
    (!!origin || !!removed) &&
    moveFocus(element, {
      root,
      origin,
      removed,
      owner: options.owner,
      stillCurrent: options.stillCurrent,
      preventScroll: true,
      missed,
    });
  let missed = false;
  let moved = attempt(target, () => (missed = true));
  if (!moved && missed && fallback && fallback !== target)
    moved = attempt(fallback);
  if (!options.keep || !moved) retireOrigin(origin);
  return moved;
}

interface ModalOpening {
  element: HTMLElement;
  opener: Element | null;
}
function enterModal(
  element: HTMLElement,
  saved: RefObject<ModalOpening | undefined>,
  stillCurrent?: () => boolean,
  beforeFocus?: () => void,
) {
  // A skin unmounts on close, so the same element is the same opening.
  if (saved.current?.element !== element)
    saved.current = {
      element,
      opener: deepActiveElement(element.ownerDocument),
    };
  beforeFocus?.();
  moveFocus(element, {
    root: element,
    owner: "",
    enterModal: true,
    stillCurrent,
  });
}
function restoreModal(
  saved: RefObject<ModalOpening | undefined>,
  stillCurrent?: () => boolean,
  fallback?: () => HTMLElement | null | undefined,
) {
  const was = saved.current;
  if (!was) return;
  queueMicrotask(() => {
    if (saved.current !== was) return;
    const destination = fallback?.();
    const target = focusable(was.opener) ? was.opener : destination;
    const options = {
      root: was.element,
      owner: "",
      removed: was.element,
      stillCurrent,
      preventScroll: true,
    };
    moveFocus(target, {
      ...options,
      missed: () => {
        if (destination !== target) moveFocus(destination, options);
      },
    });
    if (!was.element.isConnected) saved.current = undefined;
  });
}

/**
 * A drawer primitive rendered as a modal: while it is open, the page
 * outside the element it reports is unreachable, as behind a modal dialog,
 * whoever renders it, in a chat or not, whatever skin drew it. The
 * caller's own focus callbacks run as given: on opening before the page
 * is enclosed, on closing after it is released, so focus can return to the
 * opener.
 */
export function ModalDrawer({
  as: Drawer,
  focusInto,
  restoreFocus,
  ...props
}: DrawerProps & { as: ComponentType<DrawerProps> }) {
  const stop = useRef<(() => void) | undefined>(undefined);
  const opening = useRef<ModalOpening | undefined>(undefined);
  // A drawer that unmounts without reporting its close releases too.
  useEffect(
    () => () => {
      stop.current?.();
      stop.current = undefined;
    },
    [],
  );
  return (
    <Drawer
      {...props}
      focusInto={(element) => {
        stop.current?.();
        if (focusInto) {
          let enclosed = false;
          const enclose = () => {
            stop.current = containFocus(element);
            enclosed = true;
          };
          // Internal no-press entry captures its opener before enclosing;
          // ordinary caller callbacks keep their pre-containment ordering.
          const enter: (
            element: HTMLElement,
            beforeFocus?: () => void,
          ) => void = focusInto;
          enter(element, enclose);
          if (!enclosed) enclose();
        } else {
          enterModal(element, opening, undefined, () => {
            stop.current = containFocus(element);
          });
        }
      }}
      restoreFocus={(element) => {
        rememberModalRemoval(element);
        stop.current?.();
        stop.current = undefined;
        if (restoreFocus) restoreFocus(element);
        else restoreModal(opening);
      }}
    />
  );
}
/**
 * Focus for a drawer of this chat: enter on opening unless its recorded
 * press is no longer current; return only while focus still belongs to it.
 */
export function useDrawerFocus(
  action: string,
  current?: () => boolean,
  // Where the way back goes when the opener is gone, instead of the
  // transcript.
  fallback?: () => HTMLElement | null | undefined,
) {
  const focus = useChatFocus();
  const opened = useRef<{ origin?: FocusOrigin; key: string } | undefined>(
    undefined,
  );
  const unpressed = useRef<ModalOpening | undefined>(undefined);
  const still = useRef(current);
  still.current = current;
  const back = useRef(fallback);
  back.current = fallback;
  return useMemo(() => {
    if (!focus) return {};
    return {
      focusInto(element: HTMLElement, beforeFocus?: () => void) {
        const key = focus.owner();
        const origin = focus.originFor(`drawer:${action}`, key);
        opened.current = { origin, key };
        if (!origin) {
          enterModal(
            element,
            unpressed,
            () => focus.owner() === key && (still.current?.() ?? true),
            beforeFocus,
          );
          return;
        }
        unpressed.current = undefined;
        focusFor(focus, element, {
          origin,
          owner: key,
          stillCurrent: () =>
            focus.owner() === key && (still.current?.() ?? true),
          keep: true,
        });
      },
      restoreFocus(element: HTMLElement) {
        const was = opened.current;
        opened.current = undefined;
        if (!was) return;
        if (!was.origin) {
          restoreModal(
            unpressed,
            () => focus.owner() === was.key,
            () => {
              const destination = back.current?.();
              return focusable(destination ?? null)
                ? destination
                : focus.transcript();
            },
          );
          return;
        }
        // After the commit that closes the drawer: React restores the element
        // focused before a commit, which would undo a move made during it.
        const entry = { origin: was.origin, key: was.key };
        queueMicrotask(() =>
          restoreDrawer(focus, element, entry, back.current?.()),
        );
      },
      // The drawer closed in a way that moves focus itself: its opening
      // record ends without a restore.
      release() {
        const was = opened.current;
        opened.current = undefined;
        retireOrigin(was?.origin);
      },
    };
  }, [focus, action]);
}
function restoreDrawer(
  focus: ChatFocus,
  element: HTMLElement,
  was: { origin: FocusOrigin; key: string },
  fallback?: HTMLElement | null,
) {
  // Only while focus is in this drawer, or was until it was removed.
  const active = deepActiveElement(element.ownerDocument);
  if (
    !composedContains(element, active) &&
    active &&
    active !== element.ownerDocument.body
  )
    return retireOrigin(was.origin);
  const control = was.origin.control;
  // An opener that can no longer take focus counts as gone.
  const gone = focusable(fallback ?? null) ? fallback! : focus.transcript();
  const opener = focusable(control) ? control : gone;
  focusFor(focus, opener, {
    origin: was.origin,
    owner: was.key,
    stillCurrent: () => focus.owner() === was.key,
    removed: element,
    // It may still turn out unable to take focus: then as if it were gone.
    fallback: gone,
  });
}

// The press on a form field's own adornment being handled now, with the
// field it belongs to: a popup it opens may take focus.
interface FieldPress {
  origin: FocusOrigin;
  claimed: boolean;
  // Called once when what the press started is over: it opened nothing, or
  // the popup it opened has closed and its way back is done or refused.
  settled?: () => void;
}
let fieldPress: FieldPress | null = null;
/**
 * Records a press on a field's adornment, scoped to that field; `settled`
 * runs once that press's popup lifecycle is over.
 */
export function recordFieldPress(
  event: SyntheticEvent,
  scope: Element,
  settled?: () => void,
) {
  const origin = recordOrigin(event.nativeEvent, scope, "form-field", "open");
  if (!origin) return settled?.();
  const press: FieldPress = { origin, claimed: false, settled };
  fieldPress = press;
  untilTaskEnds(() => {
    if (fieldPress === press) fieldPress = null;
    // A press that opened nothing is settled.
    if (!press.claimed) {
      retireOrigin(origin);
      press.settled?.();
    }
  });
}
/** Focus for a popup opened from a field's adornment (not the chat). */
export function usePopupFocus() {
  const opened = useRef<FieldPress | undefined>(undefined);
  const unpressed = useRef<ModalOpening | undefined>(undefined);
  return useMemo(
    () => ({
      focusInto(element: HTMLElement) {
        const press = fieldPress ?? undefined;
        opened.current = press;
        if (!press) {
          enterModal(element, unpressed);
          return;
        }
        unpressed.current = undefined;
        const origin = press.origin;
        press.claimed = true;
        origin.owned.push(element);
        moveFocus(element, {
          root: origin.root,
          origin,
          owner: origin.owner,
          preventScroll: true,
        });
      },
      restoreFocus(element: HTMLElement) {
        const press = opened.current;
        opened.current = undefined;
        if (!press) {
          restoreModal(unpressed);
          return;
        }
        // After the closing commit, as for the chat's drawers.
        queueMicrotask(() => {
          restorePopup(element, press.origin);
          press.settled?.();
        });
      },
    }),
    [],
  );
}
// Back to the adornment only while focus is in the popup, or was until it
// was removed: the popup is the root the move is judged against.
// An adornment that can no longer take focus gives way to the first control
// of its field that can.
function restorePopup(element: HTMLElement, origin: FocusOrigin) {
  const field = [...origin.root.querySelectorAll("*")].find(focusable);
  const options = {
    root: element,
    origin,
    removed: element,
    owner: origin.owner,
    preventScroll: true,
  };
  let missed = !focusable(origin.control);
  if (!missed)
    moveFocus(origin.control as HTMLElement, {
      ...options,
      missed: () => (missed = true),
    });
  if (missed && field && field !== origin.control) moveFocus(field, options);
  retireOrigin(origin);
}
