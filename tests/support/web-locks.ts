// A minimal Web Locks manager for test runtimes without one (Node 22):
// exclusive requests by name, one at a time per name, in order.
type Callback = (lock: { name: string; mode: "exclusive" }) => unknown;

export function webLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(name: string, ...rest: unknown[]): Promise<unknown> {
      const callback = rest.at(-1) as Callback;
      const options = rest.length > 1 ? (rest[0] as object) : undefined;
      if (options && Object.keys(options).length)
        throw new Error(
          `The test Web Locks manager takes no options (${Object.keys(options).join(", ")})`,
        );
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(() => callback({ name, mode: "exclusive" }));
      const tail = run.then(
        () => {},
        () => {},
      );
      tails.set(name, tail);
      void tail.then(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
      return run;
    },
  };
}
