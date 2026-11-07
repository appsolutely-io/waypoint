// `npm run perf`: measures the chat in the playground, in headless
// Chromium, at long histories and through one long streamed reply.
//
//   npm run perf                      every scenario
//   npm run perf -- long:1000         one scenario: long:N, stream:N,
//                                     refstream:N (a streamed reply citing
//                                     link definitions given at its end) or
//                                     filter:N (the outline's first keystroke)
//   npm run perf -- --runs 3          the median of three runs each
//   npm run perf -- --json out.json   also writes every run
//
// Absolute times depend on the machine and its load, which is printed with
// each scenario; with a 1-minute load above 40 and no --runs, each scenario
// runs three times and the median is shown.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";

const DEFAULT_SCENARIOS = [
  "long:200",
  "long:1000",
  "long:5000",
  "stream:15000",
  "refstream:15000",
  "filter:5000",
];
// Streamed replies arrive at this many tokens a second.
const STREAM_RATE = 200;
// History before the streamed reply, so a delta has other messages to spare.
const STREAM_HISTORY = 40;
const TYPED = "how many orders";
// The first key typed in the outline's filter.
const FILTER_KEY = "q";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [value] = args.splice(at, 2).slice(1);
  return value;
};
const json = option("--json");
const runsOption = option("--runs");
const scenarios = args.length ? args : DEFAULT_SCENARIOS;
for (const scenario of scenarios)
  if (!/^(long|stream|refstream|filter):\d+$/.test(scenario))
    throw new Error(
      `Unknown scenario ${scenario}: use long:N, stream:N, refstream:N or filter:N`,
    );

const load = () => Number(loadavg()[0].toFixed(2));
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// The playground, on a port of its own, until the measurements end.
async function startPlayground() {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/playground.mjs"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PLAYGROUND_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The playground did not start:\n${output}`)),
      120_000,
    );
    const read = (chunk) => {
      output += chunk;
      if (output.includes("Playground:")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The playground exited (${code}):\n${output}`));
    });
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => child.kill() };
}

// Recorded in the page from its first script: long tasks, frame intervals
// and the event timing of key presses.
const RECORDER = `(() => {
  const perf = (window.__wpPerf = { longTasks: [], frames: [], events: [] });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        perf.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.interactionId)
          perf.events.push([entry.startTime, entry.duration, entry.interactionId]);
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {}
  let last = 0;
  const frame = (time) => {
    if (last) perf.frames.push([time, time - last]);
    last = time;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();`;

async function open(base, query) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(RECORDER);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(`${base}?scenario=chat&layout=page&${query}`);
  return { browser, page, cdp };
}
async function metrics(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const value = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  return {
    heapMB: +(value.JSHeapUsedSize / 1e6).toFixed(1),
    domNodes: value.Nodes,
    listeners: value.JSEventListeners,
  };
}
const longTasks = (entries, from = 0, to = Infinity) => {
  const within = entries.filter(([at]) => at >= from && at <= to);
  return {
    count: within.length,
    totalMs: Math.round(within.reduce((sum, [, ms]) => sum + ms, 0)),
    maxMs: Math.round(Math.max(0, ...within.map(([, ms]) => ms))),
  };
};
// A frame interval over 1.5 frames at 60 Hz drops at least one frame.
const frames = (entries, from, to) => {
  const within = entries.filter(([at]) => at >= from && at <= to);
  return {
    frames: within.length,
    dropped: within.reduce(
      (sum, [, ms]) => sum + Math.max(0, Math.round(ms / 16.7) - 1),
      0,
    ),
    over100ms: within.filter(([, ms]) => ms > 100).length,
  };
};
const resetCommits = (page) =>
  page.evaluate(
    () => (window.__wpPerfCommits = { count: 0, total: 0, max: 0 }),
  );
const commits = (page) =>
  page.evaluate(() => {
    const { count, total, max } = window.__wpPerfCommits;
    return { count, totalMs: Math.round(total), maxMs: Math.round(max) };
  });

async function long(base, size) {
  const { browser, page, cdp } = await open(base, `perfMessages=${size}`);
  try {
    const rendered = await (
      await page.waitForFunction(
        (id) =>
          document.querySelector(`article[data-message-id="${id}"]`) &&
          performance.now(),
        `perf-${size - 1}`,
        { timeout: 600_000, polling: 50 },
      )
    ).jsonValue();
    await page.waitForTimeout(1500);
    const memory = await metrics(cdp);
    const initial = longTasks(
      await page.evaluate(() => window.__wpPerf.longTasks),
      0,
      rendered + 1500,
    );
    // Typing: each key's event timing (input to next paint) and the
    // chat's React commits while it lasts.
    const field = page.locator("textarea").first();
    await field.click();
    await resetCommits(page);
    const typingFrom = await page.evaluate(() => performance.now());
    const started = Date.now();
    await page.keyboard.type(TYPED, { delay: 0 });
    await page.waitForFunction(
      (typed) => document.querySelector("textarea").value === typed,
      TYPED,
      { timeout: 600_000 },
    );
    const typingMs = Date.now() - started;
    await page.waitForTimeout(500);
    const keyEvents = await page.evaluate(
      (from) => window.__wpPerf.events.filter(([at]) => at >= from),
      typingFrom,
    );
    const byInteraction = new Map();
    for (const [, ms, id] of keyEvents)
      byInteraction.set(id, Math.max(byInteraction.get(id) ?? 0, ms));
    const latencies = [...byInteraction.values()].sort((a, b) => a - b);
    const typingCommits = await commits(page);
    // One message sent, until the mock reply has finished.
    const before = await page.evaluate(
      () => window.__wpPerfClient.getSnapshot().conversation.messages.length,
    );
    const sentAt = await page.evaluate(() => performance.now());
    await page.keyboard.press("Enter");
    const appended = await (
      await page.waitForFunction(
        (count) => {
          const { messages } = window.__wpPerfClient.getSnapshot().conversation;
          // The question and its finished reply, both shown.
          return (
            messages.length >= count + 2 &&
            messages.at(-1).status !== "writing" &&
            document.querySelector(
              `article[data-message-id="${messages.at(-1).id}"]`,
            ) &&
            !document.querySelector("article[aria-busy]") &&
            performance.now()
          );
        },
        before,
        { timeout: 600_000, polling: 50 },
      )
    ).jsonValue();
    const sendTasks = longTasks(
      await page.evaluate(() => window.__wpPerf.longTasks),
      sentAt,
      appended,
    );
    return {
      renderMs: Math.round(rendered),
      ...memory,
      initialLongTasks: initial,
      typing: {
        keys: TYPED.length,
        totalMs: typingMs,
        // Key presses under 16 ms report no event timing.
        slowKeys: latencies.length,
        maxKeyMs: Math.round(latencies.at(-1) ?? 0),
        medianKeyMs: Math.round(
          latencies.length > TYPED.length / 2
            ? latencies[latencies.length - Math.ceil(TYPED.length / 2)]
            : 0,
        ),
        commits: typingCommits,
      },
      sendToReplyMs: Math.round(appended - sentAt),
      sendLongTasks: sendTasks,
    };
  } finally {
    await browser.close();
  }
}

async function stream(base, tokens, references = false) {
  const { browser, page, cdp } = await open(
    base,
    `state=streaming&perfTokens=${tokens}&perfRate=${STREAM_RATE}&perfMessages=${STREAM_HISTORY}${references ? "&perfRefs=1" : ""}`,
  );
  try {
    // The reply being written is the busy article.
    const busyAt = await (
      await page.waitForFunction(
        () => document.querySelector("article[aria-busy]") && performance.now(),
        null,
        { timeout: 600_000, polling: 16 },
      )
    ).jsonValue();
    const firstText = await (
      await page.waitForFunction(
        () =>
          (document
            .querySelector("article[aria-busy] .wp-markdown")
            ?.textContent?.trim().length ?? 0) > 0 && performance.now(),
        null,
        { timeout: 600_000, polling: 16 },
      )
    ).jsonValue();
    await resetCommits(page);
    await page.waitForFunction(
      () => !document.querySelector("article[aria-busy]"),
      null,
      { timeout: 1_800_000, polling: 250 },
    );
    const ended = await page.evaluate(() => performance.now());
    const recorded = await page.evaluate(() => window.__wpPerf);
    const final = await page.evaluate(() => {
      const last = window.__wpPerfClient
        ?.getSnapshot()
        .conversation?.messages.at(-1);
      return {
        status: last?.status,
        complete: last?.content === window.__wpPerfExpected,
      };
    });
    return {
      firstTextMs: Math.round(firstText),
      busyToFirstTextMs: Math.round(firstText - busyAt),
      streamMs: Math.round(ended - firstText),
      longTasks: longTasks(recorded.longTasks, firstText, ended),
      frames: frames(recorded.frames, firstText, ended),
      commits: await commits(page),
      ...(await metrics(cdp)),
      final,
    };
  } finally {
    await browser.close();
  }
}

// The outline at a long history: opening it, then the first key typed in
// its filter right away, until the filter says how many messages match.
async function filter(base, size) {
  const { browser, page } = await open(base, `perfMessages=${size}`);
  try {
    await page.waitForFunction(
      (id) => document.querySelector(`article[data-message-id="${id}"]`),
      `perf-${size - 1}`,
      { timeout: 600_000, polling: 50 },
    );
    await page.waitForTimeout(1500);
    const openFrom = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Message outline" }).click();
    const opened = await (
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll("[data-outline-link]").length >= count &&
          performance.now(),
        size,
        { timeout: 600_000, polling: 16 },
      )
    ).jsonValue();
    const field = page.getByRole("searchbox", { name: "Filter messages" });
    await field.focus();
    const typedFrom = await page.evaluate(() => performance.now());
    await page.keyboard.type(FILTER_KEY, { delay: 0 });
    const settled = await (
      await page.waitForFunction(
        () =>
          /match/.test(
            document.querySelector("nav[data-outline] [role=status]")
              ?.textContent ?? "",
          ) && performance.now(),
        null,
        { timeout: 600_000, polling: 16 },
      )
    ).jsonValue();
    await page.waitForTimeout(500);
    const recorded = await page.evaluate(() => window.__wpPerf);
    const keyMs = Math.max(
      0,
      ...recorded.events.filter(([at]) => at >= typedFrom).map(([, ms]) => ms),
    );
    return {
      openMs: Math.round(opened - openFrom),
      openLongTasks: longTasks(recorded.longTasks, openFrom, opened),
      // A key under 16 ms reports no event timing.
      keyMs: Math.round(keyMs),
      resultsMs: Math.round(settled - typedFrom),
      keyLongTasks: longTasks(recorded.longTasks, typedFrom, settled),
      matches: await page.evaluate(
        () => document.querySelectorAll("[data-outline-link]").length,
      ),
    };
  } finally {
    await browser.close();
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
// The median of each number across runs.
function combine(results) {
  if (results.length === 1) return results[0];
  const walk = (values) =>
    typeof values[0] === "number"
      ? median(values)
      : values[0] && typeof values[0] === "object"
        ? Object.fromEntries(
            Object.keys(values[0]).map((key) => [
              key,
              walk(values.map((value) => value[key])),
            ]),
          )
        : values[0];
  return walk(results);
}

function print(name, result, loads) {
  const rows =
    "openMs" in result
      ? [
          ["open the outline", `${result.openMs} ms`],
          [
            "open long tasks: count / total / max",
            `${result.openLongTasks.count} / ${result.openLongTasks.totalMs} / ${result.openLongTasks.maxMs} ms`,
          ],
          ["first filter key: event latency", `${result.keyMs} ms`],
          ["first filter key: until matches said", `${result.resultsMs} ms`],
          [
            "key long tasks: count / total / max",
            `${result.keyLongTasks.count} / ${result.keyLongTasks.totalMs} / ${result.keyLongTasks.maxMs} ms`,
          ],
          ["messages matching", result.matches],
        ]
      : "renderMs" in result
        ? [
            ["initial render, to the last message", `${result.renderMs} ms`],
            ["DOM nodes", result.domNodes],
            ["JS heap after GC", `${result.heapMB} MB`],
            ["event listeners", result.listeners],
            [
              "initial long tasks: count / total / max",
              `${result.initialLongTasks.count} / ${result.initialLongTasks.totalMs} / ${result.initialLongTasks.maxMs} ms`,
            ],
            [
              `type ${result.typing.keys} keys: total`,
              `${result.typing.totalMs} ms`,
            ],
            [
              "key latency: median / max (keys over 16 ms)",
              `${result.typing.medianKeyMs} / ${result.typing.maxKeyMs} ms (${result.typing.slowKeys})`,
            ],
            [
              "while typing: commits / total / max",
              `${result.typing.commits.count} / ${result.typing.commits.totalMs} / ${result.typing.commits.maxMs} ms`,
            ],
            ["send to reply finished", `${result.sendToReplyMs} ms`],
            [
              "send long tasks: count / max",
              `${result.sendLongTasks.count} / ${result.sendLongTasks.maxMs} ms`,
            ],
          ]
        : [
            [
              "time to first text (from navigation)",
              `${result.firstTextMs} ms`,
            ],
            ["busy to first text", `${result.busyToFirstTextMs} ms`],
            ["stream duration", `${result.streamMs} ms`],
            [
              "long tasks: count / total / max",
              `${result.longTasks.count} / ${result.longTasks.totalMs} / ${result.longTasks.maxMs} ms`,
            ],
            [
              "frames / dropped / over 100 ms",
              `${result.frames.frames} / ${result.frames.dropped} / ${result.frames.over100ms}`,
            ],
            [
              "commits: count / total / max",
              `${result.commits.count} / ${result.commits.totalMs} / ${result.commits.maxMs} ms`,
            ],
            ["DOM nodes at the end", result.domNodes],
            ["JS heap after GC", `${result.heapMB} MB`],
            [
              "reply complete",
              `${result.final.complete ? "yes" : "no"} (${result.final.status})`,
            ],
          ];
  const width = Math.max(...rows.map(([label]) => label.length));
  process.stdout.write(`\n${name}  (1-minute load: ${loads.join(", ")})\n`);
  for (const [label, value] of rows)
    process.stdout.write(`  ${label.padEnd(width)}  ${value}\n`);
}

const playground = await startPlayground();
const all = {};
try {
  for (const scenario of scenarios) {
    const [kind, size] = scenario.split(":");
    const runs = Number(runsOption ?? (load() > 40 ? 3 : 1));
    const results = [];
    const loads = [];
    for (let run = 0; run < runs; run++) {
      loads.push(load());
      results.push(
        kind === "long"
          ? await long(playground.url, Number(size))
          : kind === "filter"
            ? await filter(playground.url, Number(size))
            : await stream(playground.url, Number(size), kind === "refstream"),
      );
    }
    const result = combine(results);
    all[scenario] = { loads, runs: results, median: result };
    print(scenario, result, loads);
  }
} finally {
  playground.stop();
}
if (json) writeFileSync(json, JSON.stringify(all, null, 1));
