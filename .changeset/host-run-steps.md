---
"@appsolutely-io/waypoint": minor
---

Display host-run reply steps from protocol 1.2 frames and conversation reads, including signal transports and reloads. Steps share the existing progress line and disclosure with client reads without executing or answering host work. Clarify that host problem detail must contain only information the user may see.

### Upgrading

- Exhaustive switches over `Frame` must add a `case "step"` for display-only progress metadata; do not dispatch it as a client tool read. This union addition is source-breaking under the package's pre-1.0 version convention.
- Hosts may negotiate protocol `1.2` and persist `Message.steps` for reloads. Omit the new frames and fields when a client negotiates `1.1` or `1.0`; existing hosts may keep their current versions. Form fill remains available under both `1.1` and `1.2`.
