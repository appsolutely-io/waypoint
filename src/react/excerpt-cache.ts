// Excerpts already made, for the messages the chat shows now. An entry
// belongs to one owner (client and conversation), one policy and one
// message's current source; anything else is dropped when a render begins,
// so no source of a message no longer shown is kept. Projection stays lazy:
// an entry exists only once something asked for it.
interface Entry {
  source: unknown;
  value: string | undefined;
}

export class ExcerptCache {
  private owner: string | undefined;
  private policy: readonly unknown[] = [];
  private byId = new Map<string, Entry>();

  /**
   * Starts a render for this owner, policy and the messages shown, each
   * with the source its excerpt would be made from.
   */
  begin(
    owner: string,
    policy: readonly unknown[],
    shown: readonly { id: string; source: unknown }[],
  ): void {
    if (
      owner !== this.owner ||
      policy.length !== this.policy.length ||
      policy.some((value, at) => value !== this.policy[at])
    ) {
      this.owner = owner;
      this.policy = policy;
      this.byId = new Map();
      return;
    }
    if (!this.byId.size) return;
    // A message no longer shown, or shown with another source, takes its
    // old source with it now, whether or not its excerpt is asked for.
    const sources = new Map(
      shown.map((message) => [message.id, message.source]),
    );
    for (const [id, entry] of this.byId)
      if (!sources.has(id) || sources.get(id) !== entry.source)
        this.byId.delete(id);
  }

  /** The excerpt of a shown message, projected once per source. */
  get<S>(
    id: string,
    source: S,
    project: (source: S) => string | undefined,
  ): string | undefined {
    const entry = this.byId.get(id);
    if (entry && entry.source === source) return entry.value;
    const value = project(source);
    this.byId.set(id, { source, value });
    return value;
  }

  /** What the cache holds (for lifetime checks). */
  entries(): { id: string; source: unknown }[] {
    return [...this.byId].map(([id, entry]) => ({ id, source: entry.source }));
  }
}
