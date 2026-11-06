// Bundle size limits, checked by `npm run size`. The build's metafile adds
// a budget for each shared lazy chunk and refuses a build with an ESM
// browser output no budget measures.
const { withSharedChunks } = require("./scripts/size-budgets.cjs");
const budgets = [
  {
    name: "core with lazy recovery",
    path: "dist/index.js",
    // One esbuild bundle deduplicates reachable static/dynamic dependencies.
    // gzip level 9 minus size-limit's 32-byte empty-project deduction:
    // 3% above the measured size, rounded down.
    limit: "20.603 kB",
    gzip: true,
    brotli: false,
    ignore: [
      "./flow-parser.js",
      "./flow-parser-*",
      "./form-session.js",
      "./form-session-*",
      "./conformance.js",
      "./conformance-*",
    ],
  },
  {
    name: "core",
    path: "dist/index.js",
    // Measured with Node 22's zlib (14,706 B, with the read-handler failure
    // reported once per load and the frozen read-only Keep review), plus
    // 3%, rounded down.
    limit: "15.147 kB",
    gzip: true,
    brotli: false,
    ignore: [
      "./flow-parser.js",
      "./flow-parser-*",
      "./form-session.js",
      "./form-session-*",
      "./conformance.js",
      "./conformance-*",
      "./intent.js",
      "./intent-*",
      "./on-demand.js",
      "./on-demand-*",
      "./stream-reads.js",
      "./stream-reads-*",
      "./storage-commit.js",
      "./storage-commit-*",
      "./frame-decoder.js",
      "./frame-decoder-*",
    ],
  },
  {
    name: "lazy intent client",
    path: "dist/intent.js",
    limit: "4 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy client actions",
    path: "dist/on-demand.js",
    // Measured plus 10%: 2.3 kB with the prepared flow document and the
    // confirmation's send and run start.
    limit: "2.55 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy stream reads",
    path: "dist/stream-reads.js",
    limit: "1 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy frame decoder",
    path: "dist/frame-decoder.js",
    // Measured with Node 22's zlib (356 B), plus 3%, rounded down.
    limit: "366 B",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy storage commit",
    path: "dist/storage-commit.js",
    limit: "1 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy conformance runners",
    path: "dist/conformance.js",
    limit: "5 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy form session",
    path: "dist/form-session.js",
    limit: "2 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy YAML parser",
    path: "dist/flow-parser.js",
    limit: "15 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "react",
    path: "dist/react/index.js",
    // The budget covers eager form controls and modal feedback.
    // Measured with Node 22's zlib, as CI measures it. Besides the layout,
    // token, target-size and narrow conversation list work, the entry holds
    // what a chat needs before any chunk loads: the saved requests' drawer
    // opening on the press, the read-only plan state, held announcements,
    // the form fields' typed editors and guarded Regenerate, the focus
    // handoffs and the shared load-failure notice whose Retry stays while
    // it loads again.
    limit: "39.527 KB",
    gzip: true,
    brotli: false,
    ignore: [
      "react",
      "react-dom",
      "../markdown-*",
      "./markdown-*",
      "../recovery-panel-*",
      "./recovery-panel-*",
      "../confirmation-view-*",
      "./confirmation-view-*",
      "../problem-messages-*",
      "./problem-messages-*",
      "../blocks-*",
      "./blocks-*",
      "../form-extras-*",
      "./form-extras-*",
      "../flows-panel-*",
      "./flows-panel-*",
    ],
  },
  {
    name: "hooks",
    path: "dist/hooks/index.js",
    // The renderer-neutral hooks with the client code they import, and
    // the formatter with every catalogue a host needs for their text (a
    // host that never calls it drops it); React is the host's. Measured
    // with Node 22's zlib (27,749 B), plus 3%, rounded down.
    limit: "28.581 kB",
    gzip: true,
    brotli: false,
    ignore: ["react"],
  },
  {
    name: "lazy markdown",
    path: "dist/markdown-*.js",
    // Measured at 43.12 kB with the supported GFM (tables, strikethrough,
    // task lists, autolinks) parsed in it, plus 10%.
    limit: "47.4 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom"],
  },
  {
    name: "lazy blocks",
    path: "dist/blocks-*.js",
    // Measured plus 10%: 2.64 kB with the plan steps, the required-field
    // and empty-answer rules, the value formatting and their messages,
    // which ship in this chunk, not the entry.
    limit: "2.9 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy form extras",
    path: "dist/form-extras-*.js",
    // Measured plus 10%: 4.38 kB with suggestions, fill reverts, the
    // popup's status, generation and attachments.
    limit: "4.8 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy flows panel",
    path: "dist/flows-panel-*.js",
    limit: "3 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy recovery panel",
    path: "dist/recovery-panel-*.js",
    limit: "8 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy confirmation",
    path: "dist/confirmation-view-*.js",
    limit: "3 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy problem messages",
    path: "dist/problem-messages-*.js",
    limit: "2 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "styles",
    path: "dist/styles.css",
    limit: "8 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "neutral skin",
    path: "dist/skin-default/index.js",
    limit: "2 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "antd skin",
    path: "dist/skin-antd/index.js",
    // The skin's own code, measured with Node 22's zlib as CI measures it,
    // plus 10%, rounded down: 3,498 B measured, with the button that keeps
    // antd's control height.
    limit: "3.847 kB",
    gzip: true,
    brotli: false,
    // dayjs is antd's own dependency, shipped by every antd host; the skin
    // only builds the dayjs value antd's DatePicker takes. It is also in
    // waypoint's dependencies, and dist keeps it an external import.
    ignore: ["react", "react-dom", "antd", "dayjs"],
  },
  {
    name: "testing",
    path: "dist/testing/index.js",
    // The testing entry is opt-in and never reaches end users; the
    // focus, transcript and announcement contracts need the space, and it
    // bundles the react entry, so it grows with the react entry above. It
    // also bundles the form session and the form fields. Measured with
    // Node 22's zlib.
    limit: "58.395 KB",
    gzip: true,
    brotli: false,
    ignore: [
      "react",
      "react-dom",
      "@testing-library/react",
      "../stream-reads.js",
      "./stream-reads.js",
      "../storage-commit.js",
      "./storage-commit.js",
      "../frame-decoder.js",
      "./frame-decoder.js",
      "../markdown-*",
      "./markdown-*",
      "../recovery-panel-*",
      "./recovery-panel-*",
      "../confirmation-view-*",
      "./confirmation-view-*",
      "../problem-messages-*",
      "./problem-messages-*",
      "../blocks-*",
      "./blocks-*",
      "../form-extras-*",
      "./form-extras-*",
      "../flows-panel-*",
      "./flows-panel-*",
    ],
  },
  {
    name: "schema",
    path: "dist/schema.json",
    limit: "8 KB",
    gzip: true,
    brotli: false,
  },
];
module.exports = withSharedChunks(budgets, {
  dist: "dist",
  // Chunks the build splits out of lazy chunks only, named by hash; each is
  // found by a source module it holds. The lazy chunks that import them
  // leave them out ("./chunk-*"). Each measured with Node 22's zlib, plus
  // 3%, rounded down.
  shared: [
    {
      name: "lazy block messages",
      source: "src/react/block-messages.ts",
      // 924 B measured.
      limit: "951 B",
      gzip: true,
      brotli: false,
      ignore: ["react", "react-dom", "./chunk-*"],
    },
    {
      name: "lazy value formatting",
      source: "src/react/value.tsx",
      // 383 B measured.
      limit: "394 B",
      gzip: true,
      brotli: false,
      ignore: ["react", "react-dom", "./chunk-*"],
    },
    {
      name: "lazy guarded submit",
      source: "src/react/submit.tsx",
      // 418 B measured.
      limit: "430 B",
      gzip: true,
      brotli: false,
      ignore: ["react", "react-dom", "./chunk-*"],
    },
  ],
});
