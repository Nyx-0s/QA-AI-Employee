/* Fresh-port no-store static server for the laptop rebuild (local only).
 * Serves startup-kit/site with Cache-Control: no-store on EVERY response.
 * Usage: node scripts/serve-laptop-nostore.cjs [port]  (port 0 = auto-pick) */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "startup-kit", "site");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "text/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath.endsWith("/")) urlPath += "index-laptop.html";
    const file = path.normalize(path.join(ROOT, urlPath.replace(/^\/+/, "")));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 404, "not found", "text/plain; charset=utf-8");
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": body.length,
    });
    res.end(body);
  } catch (e) {
    try { send(res, 500, "server error", "text/plain; charset=utf-8"); } catch (_) {}
  }
});

const want = parseInt(process.argv[2] || "0", 10) || 0;
server.listen(want, "127.0.0.1", () => {
  const a = server.address();
  console.log(`LAPTOP-NOSTORE-READY port=${a.port} root=${ROOT}`);
});
