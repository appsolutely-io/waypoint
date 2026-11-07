// The transcript's window: past a length, only the messages in and near
// view are mounted, with one spacer standing for each run of messages that
// is not. Rows have their own heights: each mounted row is measured, and a
// row never measured counts as the average of those that were.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * From this many messages the transcript mounts only a window of them.
 * Below it every message is mounted, so the browser's find in page finds
 * any of them; past it, the outline's filter does.
 */
export const WINDOW_FROM = 500;
/** How far beyond the box, in CSS pixels, rows stay mounted. */
export const OVERSCAN = 1200;
// A row's height before any row was measured.
const FIRST_ESTIMATE = 160;

/** A run of rows to mount, or a spacer for a run that is not. */
export type Segment =
  | { kind: "rows"; from: number; to: number }
  | { kind: "gap"; from: number; to: number; height: number };

/**
 * The rows to mount, first to last (inclusive), for a box `top` scrolled
 * and `height` tall: those within `overscan` of the box. Pinned, the box
 * rests at the end, so the window is counted from the last row.
 */
export function windowRange(
  sizes: readonly number[],
  view: { top: number; height: number },
  pinned: boolean,
  overscan = OVERSCAN,
): [number, number] {
  const count = sizes.length;
  if (!count) return [0, -1];
  if (pinned) {
    let first = count - 1;
    let covered = sizes[first]!;
    while (first > 0 && covered < view.height + overscan)
      covered += sizes[--first]!;
    return [first, count - 1];
  }
  const from = view.top - overscan;
  const to = view.top + view.height + overscan;
  let offset = 0;
  let first = -1;
  let last = count - 1;
  for (let index = 0; index < count; index++) {
    const end = offset + sizes[index]!;
    if (first < 0 && end > from) first = index;
    if (offset >= to) {
      last = index - 1;
      break;
    }
    offset = end;
  }
  // Scrolled past every row (sizes shrank under the box): the last ones.
  if (first < 0) return windowRange(sizes, view, true, overscan);
  return [first, Math.max(first, last)];
}

/** The segments for a window, with any kept rows mounted in their place. */
export function segmentsOf(
  sizes: readonly number[],
  [first, last]: [number, number],
  kept: readonly number[] = [],
): Segment[] {
  const mounted = new Set<number>();
  for (let index = first; index <= last; index++) mounted.add(index);
  for (const index of kept)
    if (index >= 0 && index < sizes.length) mounted.add(index);
  const segments: Segment[] = [];
  let gap = 0;
  let gapFrom = 0;
  for (let index = 0; index < sizes.length; index++) {
    if (mounted.has(index)) {
      if (gap) {
        segments.push({
          kind: "gap",
          from: gapFrom,
          to: index - 1,
          height: gap,
        });
        gap = 0;
      }
      const previous = segments.at(-1);
      if (previous?.kind === "rows" && previous.to === index - 1)
        previous.to = index;
      else segments.push({ kind: "rows", from: index, to: index });
    } else {
      if (!gap) gapFrom = index;
      gap += sizes[index]!;
    }
  }
  if (gap)
    segments.push({
      kind: "gap",
      from: gapFrom,
      to: sizes.length - 1,
      height: gap,
    });
  return segments;
}

export interface TranscriptWindow {
  /** Whether only a window is mounted. */
  windowed: boolean;
  /** A row is being mounted to be shown, and is not in the document yet. */
  busy: boolean;
  segments: Segment[];
  /**
   * Mounts the row for `id` and calls `then` once it is in the document,
   * at once when it already is.
   */
  reveal(id: string, then: () => void): void;
}

const ROW = "article[data-message-id]";

export function useTranscriptWindow(
  box: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  ids: readonly string[],
  pinned: boolean,
  // The message the reader is at while not pinned: it stays mounted, so
  // the position can keep it where it was.
  anchorId?: string,
): TranscriptWindow {
  const windowed = ids.length >= WINDOW_FROM;
  // Rows are measured and the box read at every length, so the render
  // that first mounts only a window already knows where the reader is.
  const measured = useRef(new Map<string, number>()).current;
  const view = useRef({ top: 0, height: 0 });
  const windowedNow = useRef(windowed);
  windowedNow.current = windowed;
  const [, viewChanged] = useState(0);
  const [, remeasured] = useState(0);
  // A row kept mounted wherever the box is: the one holding focus, so the
  // keyboard never loses its place, and one being revealed.
  const [focused, setFocused] = useState<string>();
  const [revealing, setRevealing] = useState<{
    id: string;
    then: () => void;
  }>();

  // Heights of rows that left the conversation are not kept.
  if (measured.size > ids.length * 2) {
    const shown = new Set(ids);
    for (const id of measured.keys()) if (!shown.has(id)) measured.delete(id);
  }
  let sum = 0;
  for (const height of measured.values()) sum += height;
  const estimate = measured.size ? sum / measured.size : FIRST_ESTIMATE;
  const sizes = windowed ? ids.map((id) => measured.get(id) ?? estimate) : [];
  const kept = windowed
    ? [focused, revealing?.id, anchorId]
        .filter((id): id is string => id !== undefined)
        .map((id) => ids.indexOf(id))
    : [];
  const segments: Segment[] = windowed
    ? segmentsOf(sizes, windowRange(sizes, view.current, pinned), kept)
    : ids.length
      ? [{ kind: "rows", from: 0, to: ids.length - 1 }]
      : [];

  // The box's position, read as it scrolls or resizes, once a frame; only
  // a windowed transcript renders again for it.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    let frame: number | undefined;
    const read = () => {
      frame = undefined;
      const was = view.current;
      const next = { top: element.scrollTop, height: element.clientHeight };
      if (Math.abs(was.top - next.top) < 1 && was.height === next.height)
        return;
      view.current = next;
      if (windowedNow.current) viewChanged((count) => count + 1);
    };
    const schedule = () => {
      if (frame !== undefined) return;
      frame =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(read)
          : (setTimeout(read, 16) as unknown as number);
    };
    read();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : undefined;
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (frame !== undefined)
        (typeof cancelAnimationFrame === "function"
          ? cancelAnimationFrame
          : clearTimeout)(frame);
    };
  }, [box]);

  // The row holding focus stays mounted until focus leaves it.
  useLayoutEffect(() => {
    const element = content.current;
    if (!windowed || !element) return;
    const idOf = (target: EventTarget | null) =>
      (target instanceof Element ? target.closest(ROW) : null)?.getAttribute(
        "data-message-id",
      ) ?? undefined;
    const enter = (event: FocusEvent) => setFocused(idOf(event.target));
    const leave = (event: FocusEvent) => {
      if (!element.contains(event.relatedTarget as Node | null))
        setFocused(undefined);
    };
    element.addEventListener("focusin", enter);
    element.addEventListener("focusout", leave);
    return () => {
      element.removeEventListener("focusin", enter);
      element.removeEventListener("focusout", leave);
    };
  }, [content, windowed]);

  // Each mounted row's height: from its top to the next element's, so the
  // space between rows is counted with the row before it.
  // One layout read per element.
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    let changed = false;
    const children = [...element.children] as HTMLElement[];
    const rects = children.map((child) => child.getBoundingClientRect());
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (!child.matches(ROW)) continue;
      const next = rects[index + 1];
      const height = next ? next.top - rects[index]!.top : rects[index]!.height;
      const id = child.getAttribute("data-message-id")!;
      if (height > 0 && Math.abs((measured.get(id) ?? -1) - height) > 1) {
        measured.set(id, height);
        changed = true;
      }
    }
    if (changed && windowed) remeasured((count) => count + 1);
  });

  // A row being revealed is mounted now: hand over, then let it go.
  useLayoutEffect(() => {
    if (!revealing) return;
    const mounted = [...(content.current?.querySelectorAll(ROW) ?? [])].some(
      (row) => row.getAttribute("data-message-id") === revealing.id,
    );
    if (!mounted) return;
    setRevealing(undefined);
    revealing.then();
    // Where the hand-over put the box, so the row stays in the window.
    const element = box.current;
    if (element) {
      view.current = { top: element.scrollTop, height: element.clientHeight };
      viewChanged((count) => count + 1);
    }
  }, [revealing, content, box]);

  return {
    windowed,
    busy: revealing !== undefined,
    segments,
    reveal(id, then) {
      const mounted = [...(content.current?.querySelectorAll(ROW) ?? [])].some(
        (row) => row.getAttribute("data-message-id") === id,
      );
      if (!windowed || mounted || !ids.includes(id)) then();
      else setRevealing({ id, then });
    },
  };
}
