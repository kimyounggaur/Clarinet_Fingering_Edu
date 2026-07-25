import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectDir = path.resolve(process.argv[2] || ".");
const htmlPath = path.join(projectDir, "clarinet_solfege_trainer.html");
const workerPath = path.join(projectDir, "dist", "server", "index.js");
const html = await readFile(htmlPath, "utf8");

const workerSource = `const HTML = ${JSON.stringify(html)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    if (url.pathname !== "/" && url.pathname !== "/clarinet_solfege_trainer.html") {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(request.method === "HEAD" ? null : HTML, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  },
};
`;

await mkdir(path.dirname(workerPath), { recursive: true });
await writeFile(workerPath, workerSource, "utf8");
