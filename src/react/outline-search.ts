// The outline's search: each message's text folded for matching, made in
// idle slices once the outline is open, so no keystroke waits for every
// message of a long conversation.
import { ShownCache } from "./excerpt-cache";

// Accents of the Latin, Greek and Cyrillic scripts once decomposed: the
// combining diacritical mark blocks. Marks other scripts spell with (a
// virama, a vowel sign) are kept.
const ACCENTS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

/**
 * Text as the outline's filter compares it: compatibility forms decomposed
 * (so full-width "ＡＢＣ" matches "abc"), case folded in the chat's
 * language (upper then lower case, so "ß" matches "SS" and a Turkish
 * dotted "İ" matches "i"), accents dropped after canonical decomposition,
 * then in Unicode NFC with whitespace collapsed. Comparing at the base
 * letter follows `Intl.Collator`'s `sensitivity: "base"`, which compares
 * whole strings only, never a part of one. A language tag that is not
 * valid folds with the root locale rather than throwing.
 */
export function foldForSearch(text: string, lang?: string): string {
  const locale = validLocale(lang);
  return text
    .normalize("NFKD")
    .toLocaleUpperCase(locale)
    .toLocaleLowerCase(locale)
    .normalize("NFD")
    .replace(ACCENTS, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function validLocale(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  try {
    return Intl.getCanonicalLocales(lang)[0];
  } catch {
    return undefined;
  }
}

interface Shown<M> {
  id: string;
  source: unknown;
  message: M;
}

// How long one slice runs when the browser gives no idle deadline.
const SLICE_MS = 8;

/**
 * The folded text of each message shown, once per version of what it
 * says. Texts are made in idle slices while the outline is open, never
 * all in one task; a message no longer shown takes its text with it.
 */
export class SearchIndex<M> {
  private texts = new ShownCache<string>();
  private shown: readonly Shown<M>[] = [];
  private make: (message: M) => string = () => "";
  // Where the next slice looks for a text still to make.
  private cursor = 0;
  private pending: (() => void) | undefined;
  private version = 0;
  private listeners = new Set<() => void>();

  /**
   * Starts a render for this owner, policy and the messages shown, each
   * with the source its text is made from and how to make it. The index
   * is rebuilt whenever one of its inputs changes: a message's version
   * (its source), the owner, or the policy (the chat's language, the
   * parser being ready, what the parser is told). Any text dropped sends
   * the walk back to the first message, so the index is never complete
   * while a shown message has no text.
   */
  sync(
    owner: string,
    policy: readonly unknown[],
    shown: readonly Shown<M>[],
    make: (message: M) => string,
  ): void {
    const dropped = this.texts.begin(owner, policy, shown);
    if (dropped || shown !== this.shown) this.cursor = 0;
    this.shown = shown;
    this.make = make;
  }

  /** The message's folded text, or nothing while it is still to make. */
  textOf(id: string, source: unknown): string | undefined {
    return this.texts.peek(id, source);
  }

  /** Whether every message shown has its text. */
  complete(): boolean {
    for (; this.cursor < this.shown.length; this.cursor++) {
      const { id, source } = this.shown[this.cursor]!;
      if (this.texts.peek(id, source) === undefined) return false;
    }
    return true;
  }

  /** Makes texts in idle slices until every message shown has one. */
  start(): void {
    if (this.pending || this.complete()) return;
    const run = (deadline?: IdleDeadline) => {
      this.pending = undefined;
      const until = performance.now() + SLICE_MS;
      const room = deadline
        ? () => deadline.timeRemaining() > 1
        : () => performance.now() < until;
      let made = false;
      // At least one text a slice, so a busy page still gets there.
      do {
        if (this.complete()) break;
        const { id, source, message } = this.shown[this.cursor]!;
        this.texts.get(id, source, () => this.make(message));
        made = true;
      } while (room());
      if (made) {
        this.version++;
        for (const listener of this.listeners) listener();
      }
      this.start();
    };
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(run, { timeout: 200 });
      this.pending = () => cancelIdleCallback(handle);
    } else {
      const handle = setTimeout(run, 0);
      this.pending = () => clearTimeout(handle);
    }
  }

  /** Stops making texts; what was made is kept. */
  stop(): void {
    this.pending?.();
    this.pending = undefined;
  }

  /** For `useSyncExternalStore`: told after each slice. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** For `useSyncExternalStore`: changes after each slice. */
  snapshot = (): number => this.version;
}
