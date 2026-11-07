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
    // 3% above the measured size, rounded down. Measured at 20,767 B with
    // the reply stop, the wait for an overdue reply and the feedback port.
    limit: "21.390 kB",
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
    // Besides the read-handler failure reported once per load, the frozen
    // read-only Keep review and the bounded read after a reply, a stopped
    // reply's dropped text, the version each stop is for and the wait an
    // overdue reply is given again must act on frames and timers here.
    // Measured with Node 22's zlib: 15,756 B; the limit is 3% above it,
    // rounded down.
    limit: "16.228 kB",
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
    // The reply stop check, with its stop of another version and its
    // agreement check: measured with Node 22's zlib at 5,371 B, the limit
    // is 3% above it, rounded down.
    limit: "5.532 KB",
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
    // The budget covers eager form controls and modal feedback. Besides the layout,
    // token, target-size and narrow conversation list work, the entry holds
    // what a chat needs before any chunk loads: the saved requests' drawer
    // opening on the press, the read-only plan state, held announcements,
    // the form fields' typed editors and guarded Regenerate, the focus
    // handoffs, the shared load-failure notice whose Retry stays while
    // it loads again, and a card that stays answered once the host accepted
    // its answer. Stopping a reply needs the stopped mark in the bubble and
    // the loader of the lazy reply controls in the entry. What keeps a long
    // conversation cheap is here too, since the first render needs it: the
    // memoised message row, the provider's stable props, the selector hooks,
    // the cache of what was made from each shown message, the idle preload
    // of the Markdown chunk, and the transcript's window with its feed keys
    // and the outline's filter, which reach messages it has not mounted.
    // Measured with size-limit under Node 26 at 43,315 B; the limit is 3%
    // above it, rounded down. Node 22's zlib, as CI runs it, measures the
    // same bundle about 0.5% larger: 44,254 B against 44,036 B with the
    // outline's idle search.
    limit: "44.614 KB",
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
      "../reply-controls-*",
      "./reply-controls-*",
      "../message-actions-*",
      "./message-actions-*",
    ],
  },
  {
    name: "hooks",
    path: "dist/hooks/index.js",
    // The renderer-neutral hooks with the client code they import: keys
    // only, no strings and no formatter (those are `messages` and a
    // locale); React is the host's. With problemView and replyRowView,
    // which a native UI needs to word a problem and the reply row as the
    // web chat does, and the selector hooks that let a native list follow
    // one message: measured with Node 22's zlib at 5,828 B. The limit is 3%
    // above it, rounded down.
    limit: "6.002 kB",
    gzip: true,
    brotli: false,
    ignore: ["react"],
  },
  {
    name: "messages",
    path: "dist/messages/index.js",
    // The formatter a host without the web chat formats keys with, and the
    // ICU runtime it needs. Measured (12,244 B), plus 3%, rounded down.
    limit: "12.611 kB",
    gzip: true,
    brotli: false,
  },
  {
    name: "messages en",
    path: "dist/messages/en/index.js",
    // English text of every key the hooks return, the reply row's and the
    // message actions' included (replyRowView returns them). Measured with
    // Node 22's zlib: 5,195 B; the limit is 3% above it, rounded down.
    limit: "5.35 kB",
    gzip: true,
    brotli: false,
  },
  {
    name: "messages zh-Hans",
    path: "dist/messages/zh-Hans/index.js",
    // Simplified Chinese text of the same keys. Measured with Node 22's
    // zlib: 6,092 B; the limit is 3% above it, rounded down.
    limit: "6.274 kB",
    gzip: true,
    brotli: false,
  },
  {
    name: "lazy markdown",
    path: "dist/markdown-*.js",
    // Measured with Node 22's zlib: 43.40 kB with the supported GFM
    // (tables, strikethrough, task lists, autolinks) parsed in it. The limit
    // is 10% above an earlier 43.12 kB.
    limit: "47.4 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom"],
  },
  {
    name: "lazy blocks",
    path: "dist/blocks-*.js",
    // The plan steps, the required-field and empty-answer rules, the value
    // formatting, form fill values, an answered card's chosen answer and
    // their messages ship in this chunk, not the entry. Measured with Node
    // 22's zlib: 2.22 kB. The limit is 10% above an earlier 2.64 kB.
    limit: "2.9 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy form extras",
    path: "dist/form-extras-*.js",
    // Suggestions, fill reverts, the popup's status, generation and
    // attachments. Measured with Node 22's zlib: 4.69 kB. The limit is 10%
    // above an earlier 4.38 kB.
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
    name: "lazy reply controls",
    path: "dist/reply-controls-*.js",
    // The tool steps, Stop, Keep waiting and Retry: 969 B measured, plus
    // 3%, rounded down.
    limit: "998 B",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy message actions",
    path: "dist/message-actions-*.js",
    // Copy, Regenerate, Edit, feedback and the version walk, and saying
    // when Copy fails: 1,463 B measured, plus 3%, rounded down.
    limit: "1.506 KB",
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
    // also bundles the form session and the form fields. With the reply
    // stop in the scripted host, the transcript's window and the outline's
    // idle search, measured with Node 22's zlib (size-limit's own bundle,
    // gzipped at level 9 in Node 22.23) at 64,146 B; the limit is 3% above
    // it, rounded down.
    limit: "66.07 KB",
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
      "../reply-controls-*",
      "./reply-controls-*",
      "../message-actions-*",
      "./message-actions-*",
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
      name: "lazy reply messages",
      source: "src/react/reply-messages.ts",
      // 613 B measured.
      limit: "631 B",
      gzip: true,
      brotli: false,
      ignore: ["react", "react-dom", "./chunk-*"],
    },
    {
      name: "lazy block messages",
      source: "src/react/block-messages.ts",
      // 1,019 B measured, with an answered card's texts and a failed
      // step's "It can (not) be tried again"; the limit is 3% above it.
      limit: "1049 B",
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
      // 417 B measured; the limit is 3% above an earlier 418 B.
      limit: "430 B",
      gzip: true,
      brotli: false,
      ignore: ["react", "react-dom", "./chunk-*"],
    },
  ],
});
