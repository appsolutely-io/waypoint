// The composer's file picker: the button that opens the file dialog, the
// files the user picked and the reasons a file was refused. A lazy chunk,
// loaded when a client that can attach files shows its composer, so a chat
// that never attaches one pays nothing for it.
import { useRef, useState } from "react";
import type { AttachmentUpload, WaypointClient } from "../core/client";
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
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
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
}: {
  client: WaypointClient;
  files: readonly AttachmentUpload[];
  onFiles(files: readonly AttachmentUpload[]): void;
}) {
  const { format: t, primitives: ui } = context();
  const B = ui.button;
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // What the picker said last, read out where the picker is.
  const [status, setStatus] = useState("");
  // The host's policy is fixed for this client: the port it was given.
  const policy = client.getSnapshot().attachmentPolicy;
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
  const pick = async (chosen: readonly File[]) => {
    const taken: AttachmentUpload[] = [];
    const refused: string[] = [];
    for (const file of chosen) {
      const mediaType = file.type || "application/octet-stream";
      if (policy?.accept && !policy.accept.includes(mediaType)) {
        refused.push(t("composer.refusedType", { name: file.name }));
        continue;
      }
      if (policy?.maxBytes !== undefined && file.size > policy.maxBytes) {
        refused.push(t("composer.refusedSize", { name: file.name }));
        continue;
      }
      taken.push({
        name: file.name,
        mediaType,
        data: await read(file),
      });
    }
    if (taken.length)
      onFiles([...files, ...taken].map((file) => ({ ...file })));
    const said = [
      ...refused,
      ...taken.map((file) => t("composer.added", { name: file.name })),
    ].join(" ");
    if (said) setStatus(said);
  };
  return (
    <>
      <p role="status" className="wp-composer-status">
        {status}
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
        <B onPress={() => input.current?.click()}>{t("composer.attach")}</B>
      </div>
      <ul
        ref={list}
        onFocus={(event) => {
          index(event);
          recordList(event);
        }}
        className="wp-attachments"
      >
        {files.map((file, index) => (
          <li key={`${file.name}-${index}`}>
            <span>{file.name}</span>
            <span>
              {t("composer.fileSize", { size: size(file.data.byteLength) })}
            </span>
            <B
              onPress={() => {
                onFiles(files.filter((kept) => kept !== file));
                setStatus(t("composer.removed", { name: file.name }));
              }}
            >
              {t("composer.remove", { name: file.name })}
            </B>
          </li>
        ))}
      </ul>
    </>
  );
}
