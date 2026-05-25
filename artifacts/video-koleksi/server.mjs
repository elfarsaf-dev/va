import http from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamically import worker from repo root
const workerPath = path.resolve(__dirname, "../../worker.js");
const { default: worker } = await import(workerPath);

const PORT = process.env.PORT;
if (!PORT) throw new Error("PORT env var required");

const env = {
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
  SESSION_SECRET: process.env.SESSION_SECRET || "dev-preview-secret-changeme-32chars!",
};

const server = http.createServer(async (nodeReq, nodeRes) => {
  const chunks = [];
  for await (const chunk of nodeReq) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const host = nodeReq.headers.host || `localhost:${PORT}`;
  const proto = nodeReq.headers["x-forwarded-proto"] || "http";
  const url = `${proto}://${host}${nodeReq.url}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }

  const request = new Request(url, {
    method: nodeReq.method,
    headers,
    body: body.length > 0 && nodeReq.method !== "GET" && nodeReq.method !== "HEAD" ? body : undefined,
  });

  try {
    const response = await worker.fetch(request, env);
    nodeRes.statusCode = response.status;
    response.headers.forEach((v, k) => nodeRes.setHeader(k, v));
    const buffer = await response.arrayBuffer();
    nodeRes.end(Buffer.from(buffer));
  } catch (e) {
    console.error("Worker error:", e);
    nodeRes.statusCode = 500;
    nodeRes.end(`<pre>Worker Error: ${e.message}\n${e.stack}</pre>`);
  }
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`VideoKoleksi dev server running on port ${PORT}`);
});
