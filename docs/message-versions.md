# Message versions

The chat ships no built-in edit, regenerate or version controls: the host decides which of them a product offers and how they look. The library supplies the pieces they need and keeps them safe to call.

## The port

A host that lets users edit, regenerate or switch message versions passes a `MessageVersionPort` as `versions`:

```ts
import {
  createWaypointClient,
  type MessageVersionPort,
} from "@appsolutely-io/waypoint";

const versions: MessageVersionPort = {
  edit: ({ conversationId, messageId, clientReplyId, content }) =>
    api.editMessage(conversationId, messageId, content, clientReplyId),
  regenerate: ({ conversationId, messageId, clientReplyId }) =>
    api.regenerate(conversationId, messageId, clientReplyId),
  select: ({ conversationId, messageId, clientReplyId, index }) =>
    api.selectVersion(conversationId, messageId, index, clientReplyId),
};
const client = createWaypointClient({ ...config, versions });
```

The client calls it through `client.editMessage(id, content)`, `client.regenerate(id)` and `client.selectVersion(id, index)`. Each refuses what does not fit (edit on a user message only, regenerate on an assistant message only, an index within `versionCount`) with the `refused` / `message-version` problem, sends one request with one stable `clientReplyId` for identical calls while one is in flight (the host deduplicates retries by that id), and reads the conversation again after the host answered, so the transcript always shows the host's versions.

## The controls

The `messageActions` part is rendered for every message with its data, `{ message: { id, role, status, versionIndex, versionCount } }`, so a host part knows which message it is on. `versionWalk(message)` gives the index, the count and the previous and next index, or `null` when there is only one version.

A complete part is in [`examples/message-versions.tsx`](examples/message-versions.tsx); the repository's tests render it as written. It shows Previous version and Next version when there are several, Regenerate on assistant messages and Edit on user messages, and it:

- makes its buttons unavailable (`aria-disabled`, so they keep focus) while its own call is in flight, and while the message's `status` is `writing` (a new version is still streaming);
- edits only sent user messages: a send still queued in the outbox is withdrawn from the chat's own controls, never edited;
- leaves every authority with the host: it calls the client, and the transcript shows what the next read says.

While a new version streams, `versionIndex` and `versionCount` keep the previous version's values until the next read.

```tsx
import { WaypointChat } from "@appsolutely-io/waypoint/react";
import { MessageVersionActions } from "./examples/message-versions";

<WaypointChat
  client={client}
  parts={{ messageActions: MessageVersionActions }}
/>;
```
