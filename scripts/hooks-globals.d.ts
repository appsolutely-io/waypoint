// The globals the renderer-neutral hooks may use beyond the ES library:
// timers, which browsers, Node and React Native all provide. Anything else
// a DOM would supply fails the hooks' typecheck.
declare function setTimeout(handler: () => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;
// The build-time switch a host's bundler replaces (`process.env.NODE_ENV`);
// read only inside a try, so it may be missing at run time.
declare const process: { env: Record<string, string | undefined> };
