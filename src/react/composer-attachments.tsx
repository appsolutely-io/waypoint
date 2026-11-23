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
import { context } from "./ui";

addMessages(composerEnglish, composerSimplifiedChinese);

/** A file's size, as a person reads it. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) return `${kilobytes} kB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

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
  disabled,
  reset,
}: {
  client: WaypointClient;
  files: readonly AttachmentUpload[];
  onFiles(
    update: (files: readonly AttachmentUpload[]) => readonly AttachmentUpload[],
  ): void;
  disabled?: boolean;
  /** Counts the sends: the picker's news belongs to the message before. */
  reset?: number;
}) {
  const { format: t, primitives: ui } = context();
  const B = ui.button;
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // What the picker said last, read out where the picker is.
  const [status, setStatus] = useState("");
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
  const pick = async (chosen: readonly File[]) => {
    if (chosen.length) say(t("composer.reading"));
    const taken: AttachmentUpload[] = [];
    const refused: string[] = [];
    for (const file of chosen) {
      const mediaType = file.type || "application/octet-stream";
      if (!acceptsMediaType(policy?.accept, mediaType)) {
        refused.push(
          t("composer.refusedType", {
            name: file.name,
            types: policy?.accept?.join(", ") ?? "",
          }),
        );
        continue;
      }
      if (!acceptsSize(policy?.maxBytes, file.size)) {
        refused.push(
          t("composer.refusedSize", {
            name: file.name,
            max: size(policy?.maxBytes ?? 0),
          }),
        );
        continue;
      }
      if (files.length + taken.length >= MAX_ATTACHMENTS) {
        refused.push(t("composer.tooMany", { max: String(MAX_ATTACHMENTS) }));
        continue;
      }
      let data: Uint8Array;
      try {
        data = await read(file);
      } catch {
        refused.push(t("composer.readFailed", { name: file.name }));
        continue;
      }
      taken.push({ name: file.name, mediaType, data });
    }
    if (taken.length)
      onFiles((current) => [...current, ...taken].map((file) => ({ ...file })));
    const words = [
      ...refused,
      ...taken.map((file) => t("composer.added", { name: file.name })),
    ].join(" ");
    if (words) say(words);
  };
  return (
    <>
      <p role="status" className="wp-composer-status">
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
        <B disabled={disabled} onPress={() => input.current?.click()}>
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
        {files.map((file, index) => (
          <li key={`${file.name}-${index}`}>
            <span className="wp-attachment-name">{file.name}</span>
            <span>{size(file.data.byteLength)}</span>
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
