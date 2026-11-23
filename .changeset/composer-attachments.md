---
"@appsolutely-io/waypoint": minor
---

Attach files to a message in the composer. Hosts that give the client an upload port store the files and give each an id; hosts that do not keep working unchanged. The `AttachmentPort` shape changed: each upload carries the file's place in the message (`index`), and the port no longer takes a `remove` method, so a host that passes one drops it. `send()` takes the files as an optional argument, so a host that sends no files needs no change.
