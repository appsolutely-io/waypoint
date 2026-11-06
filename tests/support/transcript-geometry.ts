// A controlled layout for the chat's transcript box in jsdom: each message
// row has a height, the box has a client height, scrolling clamps like a
// browser and dispatches its scroll event a task later, and a fake
// ResizeObserver reports size changes when the test says layout happened.
type Callback = () => void;
const observers = new Set<{ callback: Callback; targets: Set<Element> }>();
class FakeResizeObserver {
  private entry: { callback: Callback; targets: Set<Element> };
  constructor(callback: Callback) {
    this.entry = { callback, targets: new Set() };
    observers.add(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.add(target);
  }
  unobserve(target: Element) {
    this.entry.targets.delete(target);
  }
  disconnect() {
    observers.delete(this.entry);
  }
}
/** Runs every installed observer's callback, as a layout pass would. */
export function notifyResize(): void {
  for (const observer of [...observers]) observer.callback();
}
export function installResizeObserver(): () => void {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = previous;
    observers.clear();
  };
}

const rowKey = (row: Element) =>
  row.getAttribute("data-message-id") ?? row.getAttribute("data-role") ?? "";

export interface Geometry {
  box(): HTMLElement;
  /** Heights by message id (a pending row is keyed "pending"). */
  heights: Map<string, number>;
  clientHeight: number;
  /** Every behavior the chat's own scrolls asked for. */
  behaviors: (string | undefined)[];
  top(): number;
  end(): number;
  /** The browser's layout pass: clamping, then size observers. */
  layout(): void;
  /** A user's scroll, by input kind. */
  user(kind: "wheel" | "key" | "drag" | "touch", delta: number): void;
  /** A scroll with no user input (a browser or script scroll). */
  scrollTo(top: number): void;
  restore(): void;
}

const BOX = "wp-transcript";
const GAP = "[data-transcript-gap]";
const ROWS = `article, ${GAP}`;
/**
 * Every transcript box (class `wp-transcript`) gets this layout from its
 * first render on; other elements keep jsdom's.
 */
export function installGeometry({
  clientHeight = 300,
  defaultHeight = 100,
} = {}): Geometry {
  const tops = new WeakMap<Element, number>();
  const isBox = (element: Element) => element.classList.contains(BOX);
  // Messages, and the spacers a windowed transcript puts for the rest.
  const rows = (box: Element) => [...box.querySelectorAll(ROWS)];
  const height = (row: Element) =>
    row.matches(GAP)
      ? parseFloat((row as HTMLElement).style.blockSize) || 0
      : (geometry.heights.get(rowKey(row)) ?? defaultHeight);
  const scrollHeight = (box: Element) =>
    Math.max(
      geometry.clientHeight,
      rows(box).reduce((sum, row) => sum + height(row), 0),
    );
  const max = (box: Element) =>
    Math.max(0, scrollHeight(box) - geometry.clientHeight);
  const fire = (box: Element) =>
    setTimeout(() => box.dispatchEvent(new Event("scroll")), 0);
  const top = (box: Element) => tops.get(box) ?? 0;
  const set = (box: Element, next: number) => {
    const clamped = Math.min(Math.max(0, next), max(box));
    if (clamped === top(box)) return;
    tops.set(box, clamped);
    fire(box);
  };
  const clamp = (box: Element) => {
    if (top(box) > max(box)) {
      tops.set(box, max(box));
      fire(box);
    }
  };
  const proto = HTMLElement.prototype;
  const saved = (
    [
      "scrollTop",
      "scrollHeight",
      "clientHeight",
      "scrollTo",
      "getBoundingClientRect",
    ] as const
  ).map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  const inherited = (key: string) => {
    for (
      let at = Object.getPrototypeOf(proto);
      at;
      at = Object.getPrototypeOf(at)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(at, key);
      if (descriptor) return descriptor;
    }
    return undefined;
  };
  const base = {
    scrollTop: inherited("scrollTop"),
    scrollHeight: inherited("scrollHeight"),
    clientHeight: inherited("clientHeight"),
    scrollTo: inherited("scrollTo"),
    rect: inherited("getBoundingClientRect"),
  };
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (!isBox(this)) return base.scrollTop?.get?.call(this) ?? 0;
      clamp(this);
      return top(this);
    },
    set(this: HTMLElement, value: number) {
      if (isBox(this)) set(this, value);
      else base.scrollTop?.set?.call(this, value);
    },
  });
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isBox(this)
        ? scrollHeight(this)
        : (base.scrollHeight?.get?.call(this) ?? 0);
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isBox(this)
        ? geometry.clientHeight
        : (base.clientHeight?.get?.call(this) ?? 0);
    },
  });
  Object.defineProperty(proto, "scrollTo", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, options?: ScrollToOptions) {
      if (!isBox(this)) return;
      geometry.behaviors.push(options?.behavior);
      set(this, options?.top ?? top(this));
    },
  });
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (isBox(this))
        return DOMRect.fromRect({ y: 0, height: geometry.clientHeight });
      const box = this.closest(`.${BOX}`);
      if (box && this.matches(ROWS)) {
        clamp(box);
        let y = -top(box);
        for (const row of rows(box)) {
          if (row === this) break;
          y += height(row);
        }
        return DOMRect.fromRect({ y, height: height(this) });
      }
      return (base.rect?.value as (this: Element) => DOMRect).call(this);
    },
  });
  const box = () => document.querySelector<HTMLElement>(`.${BOX}`)!;
  const geometry: Geometry = {
    box,
    heights: new Map(),
    clientHeight,
    behaviors: [],
    top: () => box().scrollTop,
    end: () => scrollHeight(box()) - geometry.clientHeight - box().scrollTop,
    layout() {
      const element = box();
      clamp(element);
      for (const observer of [...observers])
        if ([...observer.targets].some((target) => element.contains(target)))
          observer.callback();
    },
    user(kind, delta) {
      const element = box();
      if (kind === "wheel") element.dispatchEvent(new Event("wheel"));
      if (kind === "key") {
        element.focus();
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: delta < 0 ? "ArrowUp" : "ArrowDown",
            bubbles: true,
          }),
        );
      }
      if (kind === "drag") element.dispatchEvent(new Event("pointerdown"));
      if (kind === "touch") {
        element.dispatchEvent(new Event("touchstart"));
        element.dispatchEvent(new Event("touchmove"));
      }
      set(element, top(element) + delta);
      if (kind === "drag")
        setTimeout(() => document.dispatchEvent(new Event("pointerup")), 0);
      if (kind === "touch")
        setTimeout(() => document.dispatchEvent(new Event("touchend")), 0);
    },
    scrollTo: (value) => set(box(), value),
    restore() {
      for (const [key, descriptor] of saved)
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[key];
    },
  };
  return geometry;
}
