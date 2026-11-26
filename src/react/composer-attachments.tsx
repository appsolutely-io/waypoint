// The composer's file picker: the button that opens the file dialog, the
// files the user picked and the reasons a file was refused. A lazy chunk,
// loaded when a client that can attach files shows its composer, so a chat
// that never attaches one pays nothing for it.
import { useEffect, useRef, useState } from "react";
import type { AttachmentUpload, WaypointClient } from "../core/client";
import {
  acceptsMediaType,
  acceptsSize,
  MAX_ATTACHMENTS,
} from "../core/attachment-shape";
import { useHandoff } from "./focus";
import { addMessages } from "./i18n";
import {
  composerEnglish,
  composerSimplifiedChinese,
} from "./composer-messages";
import { context, fileSize } from "./ui";

addMessages(composerEnglish, composerSimplifiedChinese);

/**
 * A file's bytes. The file reader is the one every browser has, and the
 * one a host's own tests have.
 */
function read(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

export function ComposerAttachments({
  client,
  files,
  onFiles,
  onReading,
  disabled,
  pickDisabled,
  statusId,
  describedBy,
  reset,
}: {
  client: WaypointClient;
  files: readonly AttachmentUpload[];
  onFiles(
    update: (files: readonly AttachmentUpload[]) => readonly AttachmentUpload[],
  ): void;
  /** Says whether a file is still being read; the send waits for it. */
  onReading?(busy: boolean, conversation?: string): void;
  /** No file can be taken or put down: the conversation is gone or a send is on its way. */
  disabled?: boolean;
  /** The message already carries all the files one message may take. */
  pickDisabled?: boolean;
  /** The id the composer gives the picker's status region. */
  statusId: string;
  /** The ids the pick button's description names: the news and, beside it outside the live region, why it waits. */
  describedBy: string;
  /** Counts the sends: the picker's news belongs to the message before. */
  reset?: number;
}) {
  const { format: t, primitives: ui, lang } = context();
  const joined = new Intl.ListFormat(lang);
  const B = ui.button;
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // What the picker said last, read out where the picker is. A new
  // conversation starts the news over: a pick that settles after the
  // switch says what it refused and what it dropped, since the file it
  // read belongs to no conversation now.
  const [status, setStatus] = useState("");
  useEffect(() => {
    setStatus("");
  }, [client.getSnapshot().conversationId]);
  // The words are said again when they repeat: the status carries a number
  // so the region changes even when the words do not.
  const [revision, setRevision] = useState(0);
  // The host's policy is fixed for this client: the port it was given.
  const policy = client.getSnapshot().attachmentPolicy;
  // The picker forgets what it said when the composer sends.
  useEffect(() => {
    setStatus("");
  }, [reset]);
  // A removed row hands focus to the row now at its place, else the one
  // before it, else the button that opens the picker.
  const at = useRef(0);
  const near = (box: Element | null | undefined) => {
    const buttons = box?.querySelectorAll("button") ?? [];
    return [buttons[at.current], buttons[at.current - 1]];
  };
  const index = (event: { target: EventTarget; currentTarget: Element }) => {
    at.current = [...event.currentTarget.querySelectorAll("button")].indexOf(
      event.target as HTMLButtonElement,
    );
  };
  const recordList = useHandoff(() => [
    ...near(list.current),
    picker.current?.querySelector("button"),
  ]);
  const say = (text: string) => {
    setStatus(text);
    setRevision((count) => count + 1);
  };
  // Each picked file keeps one key of its own, so removing one does not
  // move the rest.
  const picked = useRef(new WeakMap<AttachmentUpload, number>());
  const next = useRef(0);
  const keyOf = (file: AttachmentUpload) => {
    const known = picked.current.get(file);
    if (known !== undefined) return known;
    const id = ++next.current;
    picked.current.set(file, id);
    return id;
  };
  // Picks in flight: the composer's send waits for the last read.
  const picks = useRef(0);
  const pick = async (chosen: readonly File[]) => {
    // Files that settle after their message left, or after the
    // conversation changed, belong to neither: they are dropped.
    const conversation = client.getSnapshot().conversationId;
    if (++picks.current === 1) onReading?.(true, conversation);
    try {
      const taken: AttachmentUpload[] = [];
      const refused: string[] = [];
      // The files the host takes are the ones that are read; the rest are
      // refused, and the reading line names only what it waits on.
      const readable: File[] = [];
      for (const file of chosen) {
        const mediaType = file.type || "application/octet-stream";
        if (!acceptsMediaType(policy?.accept, mediaType)) {
          refused.push(
            t("composer.refusedType", {
              name: file.name,
              types: joined.format(policy?.accept ?? []),
            }),
          );
          continue;
        }
        if (!acceptsSize(policy?.maxBytes, file.size)) {
          refused.push(
            t("composer.refusedSize", {
              name: file.name,
              max: fileSize(policy?.maxBytes ?? 0),
            }),
          );
          continue;
        }
        readable.push(file);
      }
      if (readable.length)
        say(
          t("composer.reading", {
            name: joined.format(readable.map((each) => each.name)),
          }),
        );
      for (const file of readable) {
        const mediaType = file.type || "application/octet-stream";
        let data: Uint8Array;
        try {
          data = await read(file);
        } catch {
          refused.push(t("composer.readFailed", { name: file.name }));
          continue;
        }
        taken.push({ name: file.name, mediaType, data });
      }
      // What stays is decided against the files the composer holds now,
      // not the ones this pick started from. A send cannot leave while a
      // read is open (the composer holds it), so the only way to be late is
      // the conversation changing under the read — into another one, or
      // into a form.
      let kept: readonly AttachmentUpload[] = [];
      const now = client.getSnapshot();
      const late =
        now.conversationId !== conversation ||
        now.conversation?.mode === "form-fill";
      if (taken.length && !late)
        onFiles((current) => {
          const merged = [...current, ...taken].slice(0, MAX_ATTACHMENTS);
          kept = merged.slice(current.length);
          return merged;
        });
      // A pick that overflows names the files that did not fit; the limit
      // itself is said once, beside the composer, where it explains the
      // list above it.
      if (!late)
        for (const file of taken.slice(kept.length))
          refused.push(t("composer.notAdded", { name: file.name }));
      const words = late
        ? [
            ...refused,
            ...taken.map((file) => t("composer.notAdded", { name: file.name })),
          ].join(" ")
        : [
            ...refused,
            ...kept.map((file) => t("composer.added", { name: file.name })),
          ].join(" ");
      if (words) say(words);
    } finally {
      if (--picks.current === 0) onReading?.(false);
    }
  };
  // The status region carries the news; why the picker waits is rendered
  // beside it by the composer, outside the live region, so a wait never
  // rides an announcement and an announcement never hides the wait.
  return (
    <>
      <p id={statusId} role="status" className="wp-composer-status">
        {status ? <span key={revision}>{status}</span> : null}
      </p>
      <input
        ref={input}
        type="file"
        accept={policy?.accept?.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = "";
          void pick(chosen);
        }}
      />
      <div ref={picker}>
        <B
          disabled={disabled || pickDisabled}
          aria-describedby={describedBy}
          onPress={() => input.current?.click()}
        >
          {t("composer.attach")}
        </B>
      </div>
      <ul
        ref={list}
        onFocus={(event) => {
          index(event);
          recordList(event);
        }}
        className="wp-attachments wp-composer-files"
      >
        {files.map((file) => (
          <li key={keyOf(file)}>
            <span className="wp-attachment-name">{file.name}</span>
            <span>{fileSize(file.data.byteLength)}</span>
            <B
              disabled={disabled}
              aria-label={t("composer.removeNamed", { name: file.name })}
              onPress={() => {
                onFiles((current) => current.filter((kept) => kept !== file));
                say(t("composer.removed", { name: file.name }));
              }}
            >
              {t("composer.remove")}
            </B>
          </li>
        ))}
      </ul>
    </>
  );
}
