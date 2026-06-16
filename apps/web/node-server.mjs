// Node.js HTTP adapter for TanStack Start's fetch-style SSR handler.
// Serves dist/client/* as static files; everything else is SSR.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const { default: handler } = await import("./dist/server/server.js");
const STATIC_DIR = join(__dirname, "dist", "client");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

async function tryStaticFile(pathname) {
  const filePath = join(STATIC_DIR, pathname);
  if (!filePath.startsWith(STATIC_DIR)) return null;
  try {
    await stat(filePath);
    const content = await readFile(filePath);
    const ext = extname(pathname).toLowerCase();
    return { content, mimeType: MIME[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const base = `http://${req.headers.host ?? "localhost"}`;
  const url = new URL(req.url, base);

  const staticFile = await tryStaticFile(url.pathname);
  if (staticFile) {
    res.statusCode = 200;
    res.setHeader("Content-Type", staticFile.mimeType);
    if (url.pathname.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    res.end(staticFile.content);
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    if (Array.isArray(val)) val.forEach((v) => headers.append(key, v));
    else headers.set(key, val);
  }

  const fetchReq = new Request(url.toString(), {
    method: req.method,
    headers,
    body: bodyBuf?.length ? bodyBuf : undefined,
    duplex: bodyBuf?.length ? "half" : undefined,
  });

  try {
    const fetchRes = await handler.fetch(fetchReq);
    res.statusCode = fetchRes.status;
    for (const [key, value] of fetchRes.headers) {
      res.setHeader(key, value);
    }
    if (fetchRes.body) {
      Readable.fromWeb(fetchRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("SSR error:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`Stwrd listening on http://localhost:${PORT}`);
});
