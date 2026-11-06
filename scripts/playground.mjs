import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createFixtureServer } from "../fixtures/server/index.ts";
import { playgroundPort } from "../playground/port.ts";
import { startupMessage } from "../playground/startup.ts";
import { seed } from "../playground/seed.ts";

const root = fileURLToPath(new URL("../playground", import.meta.url));
let port;
let fixture;
let server;
try {
  port = playgroundPort();
  fixture = await createFixtureServer({ testMode: true });
  await seed(fixture.url);
  server = await createServer({
    configFile: false,
    root,
    esbuild: { jsx: "automatic" },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      open: false,
      fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
      proxy: {
        "/api": {
          target: fixture.url,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  });
  await server.listen();
  process.stdout.write(`Playground: http://127.0.0.1:${port}/\n`);
} catch (error) {
  await server?.close();
  await fixture?.close();
  process.stderr.write(startupMessage(error, port) + "\n");
  process.exitCode = 1;
}
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server?.close();
  await fixture?.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
