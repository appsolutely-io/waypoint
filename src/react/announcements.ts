// What the chat's one message live region says. Assistant messages that
// were not already there when the conversation was shown are announced as
// they arrive, complete or fail, batched for a second and checked again
// against the current transcript before anything is said.
import { useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "../protocol/generated";
import type { FormatMessage } from "./i18n";

/** How long the first pending announcement waits for others, in ms. */
export const ANNOUNCEMENT_BATCH_MS = 1000;
type Stage = "arrived" | "completed" | "failed";
// Isolates an excerpt's direction inside the announced text.
const isolate = (text: string) => `⁨${text}⁩`;
const frames = () => typeof requestAnimationFrame === "function";
const nextFrame = (
  callback: () => void,
): number | ReturnType<typeof setTimeout> =>
  frames() ? requestAnimationFrame(callback) : setTimeout(callback, 16);
const cancelFrame = (handle: number | ReturnType<typeof setTimeout>) => {
  if (frames()) cancelAnimationFrame(handle as number);
  else clearTimeout(handle as ReturnType<typeof setTimeout>);
};

/** The stage a message is at for announcing; none while it is written. */
export function stageOf(message: Message): Stage | undefined {
  if (message.role !== "assistant") return undefined;
  const status = (message as { status?: string }).status;
  if (status === undefined || status === null) return "arrived";
  if (status === "completed") return "completed";
  if (status === "failed" || status === "unavailable") return "failed";
  return undefined;
}

/** The text the live region shows; a new emission empties it for a frame. */
export function useAnnouncements(
  // The client the conversation belongs to: the baseline is per client
  // and conversation, so a replaced client starts over.
  client: object,
  conversation: Conversation | null,
  excerptOf: (message: Message) => string | undefined,
  t: FormatMessage,
  // The live region: while a modal drawer makes it inert, what is due waits.
  region?: { current: Element | null },
): string {
  const [text, setText] = useState("");
  const state = useRef({
    baselineFor: undefined as string | undefined,
    baseline: new Set<string>(),
    announced: new Map<string, Set<Stage>>(),
    // Replies seen being written: their stream's end says them, and one
    // that ends with no status is not a new arrival.
    writing: new Set<string>(),
    held: undefined as MutationObserver | undefined,
    pending: new Map<string, Stage>(),
    batchFor: undefined as string | undefined,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    frame: undefined as number | ReturnType<typeof setTimeout> | undefined,
    // Each newly shown conversation (a switch, also back to an earlier
    // one) starts a new showing; a batch belongs to the showing it began in.
    showing: 0,
    batchShowing: 0,
    client: undefined as object | undefined,
  }).current;
  const latest = useRef({ conversation, excerptOf, t });
  latest.current = { conversation, excerptOf, t };

  const eligible = (id: string, stage: Stage) => {
    const said = state.announced.get(id);
    const terminal = !!said && (said.has("completed") || said.has("failed"));
    return stage === "arrived"
      ? !terminal && !said?.has("arrived") && !state.writing.has(id)
      : !terminal;
  };
  // The batch is due: the region is emptied now, and what it says is
  // decided at the frame that says it, from the transcript shown then.
  const emit = () => {
    state.timer = undefined;
    const pending = [...state.pending];
    const batchFor = state.batchFor;
    const batchShowing = state.batchShowing;
    state.pending.clear();
    if (state.frame !== undefined) cancelFrame(state.frame);
    setText("");
    state.frame = nextFrame(() => {
      state.frame = undefined;
      if (batchShowing === state.showing) deliver(pending, batchFor);
    });
  };
  const deliver = (pending: [string, Stage][], batchFor?: string) => {
    const element = region?.current;
    if (element?.closest("[inert]")) {
      // Said once the region is live again, from the transcript shown then.
      for (const [id, stage] of pending) state.pending.set(id, stage);
      state.held ??= new MutationObserver(() => {
        if (element.closest("[inert]")) return;
        state.held?.disconnect();
        state.held = undefined;
        emit();
      });
      state.held.observe(element.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: ["inert"],
        subtree: true,
      });
      return;
    }
    const {
      conversation: shown,
      excerptOf: excerptFor,
      t: format,
    } = latest.current;
    if (!shown || shown.id !== batchFor) return;
    const byId = new Map(
      shown.messages.map((message) => [message.id, message]),
    );
    const entries = pending.flatMap(([id]) => {
      const message = byId.get(id);
      const stage = message && stageOf(message);
      return message && stage && eligible(id, stage)
        ? [{ id, stage, message }]
        : [];
    });
    if (!entries.length) return;
    // Transcript order, so "latest" is the newest of them.
    const order = new Map(
      shown.messages.map((message, at) => [message.id, at]),
    );
    entries.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const count = entries.length;
    const failed = entries.filter((entry) => entry.stage === "failed").length;
    const completed = entries.filter((entry) => entry.stage === "completed");
    const excerptFrom = (message: Message) => {
      const value = excerptFor(message);
      return value === undefined ? undefined : isolate(value);
    };
    let said: string;
    if (count === 1) {
      const [entry] = entries;
      const excerpt =
        entry!.stage === "completed" ? excerptFrom(entry!.message) : undefined;
      said =
        entry!.stage === "failed"
          ? format("chat.arrivalFailed")
          : excerpt !== undefined
            ? format("chat.arrivalExcerpt", { excerpt })
            : format("chat.arrival");
    } else if (completed.length === count) {
      const excerpt = excerptFrom(completed.at(-1)!.message);
      said =
        excerpt !== undefined
          ? format("chat.arrivalMany", { count, excerpt })
          : format("chat.arrivalManyPlain", { count });
    } else if (failed === count)
      said = format("chat.arrivalAllFailed", { count });
    else if (failed) said = format("chat.arrivalManyFailed", { count, failed });
    else said = format("chat.arrivalManyPlain", { count });
    for (const entry of entries) {
      const stages = state.announced.get(entry.id) ?? new Set<Stage>();
      stages.add(entry.stage);
      state.announced.set(entry.id, stages);
    }
    // Emptied a frame before, so the same text twice is two changes.
    setText(said);
  };

  useEffect(() => {
    if (state.client !== client) {
      state.client = client;
      state.baselineFor = undefined;
    }
    if (!conversation) {
      // A switch or a held read: the next shown read sets a new baseline.
      state.baselineFor = undefined;
      return;
    }
    if (state.baselineFor !== conversation.id) {
      state.baselineFor = conversation.id;
      state.showing++;
      state.baseline = new Set(
        conversation.messages.map((message) => message.id),
      );
      state.announced.clear();
      state.writing.clear();
      state.pending.clear();
      clearTimeout(state.timer);
      state.timer = undefined;
      if (state.frame !== undefined) cancelFrame(state.frame);
      state.frame = undefined;
      return;
    }
    for (const message of conversation.messages) {
      if (state.baseline.has(message.id)) continue;
      if ((message as { status?: string }).status === "writing")
        state.writing.add(message.id);
      const stage = stageOf(message);
      if (!stage || !eligible(message.id, stage)) continue;
      if (!state.pending.size) {
        state.batchFor = conversation.id;
        state.batchShowing = state.showing;
      }
      state.pending.set(message.id, stage);
    }
    if (state.pending.size && state.timer === undefined)
      state.timer = setTimeout(emit, ANNOUNCEMENT_BATCH_MS);
  }, [client, conversation]);
  useEffect(
    () => () => {
      clearTimeout(state.timer);
      if (state.frame !== undefined) cancelFrame(state.frame);
      state.held?.disconnect();
    },
    [state],
  );
  return text;
}

/**
 * `value` while `region` is live; while a modal drawer makes it inert, the
 * value it last showed, so the latest one is said once it is live again.
 */
export function useHeldWhileInert<T>(
  value: T,
  region: { current: Element | null },
): T {
  const [inert, setInert] = useState(false);
  const kept = useRef(value);
  useEffect(() => {
    const element = region.current;
    if (!element || typeof MutationObserver !== "function") return;
    const check = () => setInert(!!element.closest("[inert]"));
    check();
    const watch = new MutationObserver(check);
    watch.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["inert"],
      subtree: true,
    });
    return () => watch.disconnect();
  }, [region]);
  if (!inert) kept.current = value;
  return kept.current;
}
