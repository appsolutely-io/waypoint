// A host's message version controls, as `docs/message-versions.md`
// describes. A host imports from "@appsolutely-io/waypoint" and
// "@appsolutely-io/waypoint/react"; this copy imports the sources so the
// repository's tests run it as written.
import { useState } from "react";
import { versionWalk } from "../../src/core/client";
import { useWaypointClient, type PartProps } from "../../src/react/ui";

interface ShownMessage {
  id: string;
  role: "user" | "assistant";
  status?: string;
  versionIndex?: number | null;
  versionCount?: number | null;
}
/** The `messageActions` part: Previous / Next version, Regenerate, Edit. */
export function MessageVersionActions({ data }: PartProps) {
  const client = useWaypointClient();
  const message = (data as { message?: ShownMessage } | undefined)?.message;
  // One call at a time from these buttons. The client also sends one
  // request (one stable clientReplyId) for identical calls in flight.
  const [busy, setBusy] = useState(false);
  if (!message) return null;
  const walk = versionWalk(message);
  // A reply still being written has nothing to act on yet.
  const unavailable = busy || message.status === "writing";
  const act = (call: () => Promise<void>) => {
    if (unavailable) return;
    setBusy(true);
    // The client reports a failed call itself; this only ends the wait.
    void call()
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  // Unavailable buttons stay focusable, so a press never drops focus.
  const action = (label: string, off: boolean, run: () => Promise<void>) => (
    <button
      type="button"
      aria-disabled={off || undefined}
      onClick={() => {
        if (!off) act(run);
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Message versions">
      {walk ? (
        <>
          {action(
            "Previous version",
            unavailable || walk.previous === null,
            () => client.selectVersion(message.id, walk.previous!),
          )}
          <span>
            {walk.index} / {walk.count}
          </span>
          {action("Next version", unavailable || walk.next === null, () =>
            client.selectVersion(message.id, walk.next!),
          )}
        </>
      ) : null}
      {message.role === "assistant"
        ? action("Regenerate", unavailable, () => client.regenerate(message.id))
        : // Only a sent message is edited (a queued send is a pending row,
          // which gets no actions, and is withdrawn instead).
          action("Edit", unavailable, async () => {
            const content = window.prompt("Edit message");
            if (content) await client.editMessage(message.id, content);
          })}
    </div>
  );
}
