import { createServer } from "vite";
import { createFixtureServer } from "../fixtures/server/index.ts";
const fixture = await createFixtureServer({ testMode: true });
const server = await createServer({
  root: process.cwd(),
  server: {
    host: "127.0.0.1",
    port: 43197,
    strictPort: true,
    proxy: {
      "/api": {
        target: fixture.url,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
await server.listen();
const stop = async () => {
  await server.close();
  await fixture.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
