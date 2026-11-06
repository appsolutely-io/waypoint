// The globals the renderer-neutral hooks may use beyond the ES library:
// timers, which browsers, Node and React Native all provide. Anything else
// a DOM would supply fails the hooks' typecheck.
declare function setTimeout(handler: () => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;
