// Bundle size limits, checked by `npm run size`. The build's metafile adds
// a budget for each shared lazy chunk and refuses a build with an ESM
// browser output no budget measures.
const { withSharedChunks } = require("./scripts/size-budgets.cjs");
const budgets = [
  {
    name: "core with lazy recovery",
    path: "dist/index.js",
    // Reachable reply recovery and frame reconciliation remain covered by the deduplicated aggregate guard, which also counts the
    // attachments' lazy upload chunk — the upload of a message's files, and the settle it leaves on the conversation it started in
    // when that conversation moves on — and the reply steps a host runs.
    // Measured across lockfile and lowest peers with Node 22's zlib, as CI measures it.
    limit: "28 KB",
    gzip: true,
    brotli: false,
    ignore: [
      "./conversation-pages-*",
      "../conversation-pages-*",
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
    // Synchronous reply state, recovery eligibility, frame reconciliation, cancellation ownership, the host-run reply steps and the
    // composer attachments — the row's references, the upload at send time, the pick-time policy, the shape rule a restored row is
    // validated with, the guards around the upload and the release of the staged bytes — belong to every core consumer, as does the
    // send that settles where it started: it resolves once its row is queued, refuses an over-limit message under its own id before
    // the middleware runs, and leaves a withdrawn message's file names on its restored item.
    // Measured across lockfile and lowest peers with Node 22's zlib, as CI measures it.
    limit: "21.1 KB",
    gzip: true,
    brotli: false,
    ignore: [
      "./conversation-pages-*",
      "../conversation-pages-*",
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
      "./attachment-upload.js",
      "./attachment-upload-*",
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
    // Host failure observation joins scoped recovery and other optional client actions behind the on-demand entry.
    // Node 22 maximum across lockfile/lowest peers: 3,240 B;
    // add 5% and round up to 100 B.
    limit: "3.5 KB",
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
    name: "lazy attachment upload",
    path: "dist/attachment-upload.js",
    // The chunk carries the upload of a message's files and the settle an
    // abandoned upload leaves on its own conversation, which goes through
    // the shared committed write and reports a write that failed; the
    // commit code it loads on demand is measured by its own budget and
    // left out here, as every other lazy chunk leaves out such pieces.
    limit: "1.1 KB",
    gzip: true,
    brotli: false,
    ignore: ["./storage-commit.js", "./storage-commit-*", "./chunk-*"],
  },
  {
    name: "lazy conformance runners",
    path: "dist/conformance.js",
    // Authenticated sessions, safe adapter failures and negotiated scenario selection stay in the opt-in runner.
    // Node 22 maximum across lockfile/lowest peers: 6,225 B;
    // add 5% and round up to 100 B.
    limit: "6.6 KB",
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
    // Reply recovery, host activity, named senders, notice rows and paged navigation retain synchronous UI behavior.
    // Node 22 maximum across lockfile/lowest peers: 46,755 B;
    // add 5% and round up to 100 B.
    limit: "49.1 KB",
    gzip: true,
    brotli: false,
    ignore: [
      "./conversation-pages-*",
      "../conversation-pages-*",
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
      "../composer-attachments-*",
      "./composer-attachments-*",
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
    // Renderer-neutral reply presentations share recovery eligibility and host-activity decisions with the web UI.
    // Node 22 maximum across lockfile/lowest peers: 6,136 B;
    // add 5% and round up to 100 B.
    limit: "6.5 KB",
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
    // English reply recovery, host activity and named-sender/notice text is available to renderer-neutral hosts,
    // and its messages name what was lost: the files to pick again, the file being read, and what a form did.
    // Measured across lockfile and lowest peers with Node 22's zlib, as CI measures it.
    limit: "5.8 KB",
    gzip: true,
    brotli: false,
  },
  {
    name: "messages zh-Hans",
    path: "dist/messages/zh-Hans/index.js",
    // Simplified Chinese reply recovery, host activity and named-sender/notice text matches the English catalogue, and its
    // composer adds the words for a file that arrived too late and for the files a withdrawn message names to pick again.
    // Measured across lockfile and lowest peers with Node 22's zlib, as CI measures it.
    limit: "6.8 KB",
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
    name: "lazy composer attachments",
    path: "dist/composer-attachments-*.js",
    // A pick that settles after the conversation changed says only what it
    // dropped, a form under a read counts as gone, and the attach button's
    // state is described by the picker's status region.
    limit: "2.1 KB",
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
    // Independent recovery and host-activity controls retain their focus handoffs in the optional reply chunk.
    // Node 22 maximum across lockfile/lowest peers: 1,600 B;
    // add 5% and round up to 100 B.
    limit: "1.7 KB",
    gzip: true,
    brotli: false,
    ignore: ["react", "react-dom", "./chunk-*"],
  },
  {
    name: "lazy message actions",
    path: "dist/message-actions-*.js",
    // Host-selected regeneration shares message actions and their scoped recovery guard.
    // Node 22 maximum across lockfile/lowest peers: 1,543 B;
    // add 5% and round up to 100 B.
    limit: "1.7 KB",
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
    // The scripted host and React test fixtures include reply recovery, reconciliation and the expanded presentation contracts.
    // Node 22 maximum across lockfile/lowest peers: 70,774 B;
    // add 5% and round up to 100 B.
    limit: "74.4 KB",
    gzip: true,
    brotli: false,
    ignore: [
      "./conversation-pages-*",
      "../conversation-pages-*",
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
      "../composer-attachments-*",
      "./composer-attachments-*",
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
  // leave them out ("./chunk-*"). Each entry records its Node 22
  // measurement and headroom.
  shared: [
    {
      name: "lazy conversation pages",
      source: "src/core/conversation-pages.ts",
      // Paged history loads only when the host provides readPage. Node 22
      // measures 2,233 B at the lowest peers; add 5% and round up to 100 B.
      limit: "2.4 KB",
      gzip: true,
      brotli: false,
      ignore: ["./chunk-*"],
    },
    {
      name: "lazy reply messages",
      source: "src/react/reply-messages.ts",
      // With the Copy failure text: 639 B measured under Node 22; the limit
      // is 3% above it, rounded down.
      limit: "658 B",
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
