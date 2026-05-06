import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BUILD_INFO, ROOM_NAME, SERVER_PORT } from "@openspace/shared";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const PORT = Number(process.env.PORT ?? SERVER_PORT);
const CLIENT_DIST = process.env.CLIENT_DIST
  ? resolve(process.env.CLIENT_DIST)
  : resolve(process.cwd(), "packages/client/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function tryServeFile(absPath: string): Promise<{ data: Buffer; type: string } | null> {
  try {
    const s = await stat(absPath);
    if (!s.isFile()) return null;
    const data = await readFile(absPath);
    return { data, type: MIME[extname(absPath)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

// Pre-stringify BUILD_INFO once: it's invariant across the process
// lifetime and the /build-info handler runs on every reconnect poll
// from every disconnected client.
const BUILD_INFO_JSON = JSON.stringify(BUILD_INFO);

const httpServer = createServer(async (req, res) => {
  if (!req.url || req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const urlPath = decodeURIComponent((req.url.split("?")[0] ?? "/") || "/");
  // Build-info probe: serves the embedded git SHA + recent commits as
  // JSON. Clients hit this on disconnect to detect a redeploy and to
  // fetch release notes for the update modal. no-store because the SHA
  // is the very thing we need to be live.
  if (urlPath === "/build-info") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(BUILD_INFO_JSON);
    return;
  }
  // Block path traversal: normalize then ensure resolved path stays within CLIENT_DIST.
  const safe = normalize(urlPath).replace(/^[/\\]+/, "");
  const candidate = resolve(join(CLIENT_DIST, safe));
  if (!candidate.startsWith(CLIENT_DIST)) {
    res.writeHead(403).end();
    return;
  }
  const direct = await tryServeFile(candidate);
  if (direct) {
    res.writeHead(200, { "content-type": direct.type, "cache-control": "public, max-age=3600" });
    res.end(direct.data);
    return;
  }
  // SPA fallback to index.html
  const fallback = await tryServeFile(join(CLIENT_DIST, "index.html"));
  if (fallback) {
    res.writeHead(200, { "content-type": fallback.type, "cache-control": "no-cache" });
    res.end(fallback.data);
    return;
  }
  res.writeHead(404).end("not found");
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ROOM_NAME, ArenaRoom);

gameServer
  .listen(PORT)
  .then(() => {
    console.log(
      `[server] listening on port ${PORT}, build=${BUILD_INFO.sha}, serving client from ${CLIENT_DIST}`,
    );
  })
  .catch((err) => {
    console.error("[server] failed to start", err);
    process.exit(1);
  });
