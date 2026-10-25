import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(".");
const types = { ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".json":"application/json" };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    let path = url.pathname;
    if (path === "/" || path === "/index.html") path = "/apps/web-user/index.html";
    else if (path === "/admin" || path === "/admin/") path = "/apps/web-admin/index.html";
    else if (path.startsWith("/web-user/")) path = "/apps/" + path.slice(1);
    else if (path.startsWith("/web-admin/")) path = "/apps/" + path.slice(1);
    else if (path === "/config.js") path = "/apps/web-user/config.js";
    else if (!path.startsWith("/apps/")) path = "/apps/web-user" + (path.startsWith("/") ? path : "/" + path);
    const file = resolve(root, "." + path);
    if (!file.startsWith(root + sep)) throw new Error("Unsafe path");
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "X-Content-Type-Options":"nosniff", "Cache-Control":"no-store" });
    res.end(bytes);
  } catch {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8" }); res.end("Not found. Local mode does not emulate Cloudflare Access or the backend API.");
  }
}).listen(Number(process.env.PORT || 4173), "127.0.0.1", () => console.log("Hendy local preview on http://127.0.0.1:" + (process.env.PORT || 4173)));
