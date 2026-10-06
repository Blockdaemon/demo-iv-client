import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultHost = "payments-demo.api.dev.blockdaemon-wallet.com";
const port = 8787;
const dir = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(dir, ".env");

function loadEnv() {
  const env = {};
  let text = "";
  try {
    text = fs.readFileSync(envFile, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function settings() {
  const env = loadEnv();
  return {
    apiKey: (env.IV_API_KEY || "").trim(),
    host: (env.IV_API_HOST || defaultHost).trim(),
    tenantId: (env.IV_TENANT_ID || "default").trim(),
  };
}

function applyAuth(headers) {
  const current = settings();
  if (!current.apiKey) return null;
  headers.host = current.host;
  headers.authorization = "Bearer " + current.apiKey;
  headers["x-tenant-id"] = current.tenantId;
  return current;
}

function missingKey(res) {
  res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
  res.end("Set IV_API_KEY in bank-console/.env");
}

function proxy(req, res) {
  const headers = { ...req.headers };
  delete headers["accept-encoding"];
  const current = applyAuth(headers);
  if (!current) {
    missingKey(res);
    return;
  }
  const upstream = https.request(
    {
      hostname: current.host,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (res.headersSent) return;
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(err.message);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  fs.createReadStream(path.join(dir, "index.html")).pipe(res);
});

server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/api/")) {
    socket.destroy();
    return;
  }
  const headers = { ...req.headers };
  const current = applyAuth(headers);
  if (!current) {
    socket.write("HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain\r\n\r\nSet IV_API_KEY in bank-console/.env");
    socket.destroy();
    return;
  }
  const upstream = https.request({
    hostname: current.host,
    path: req.url,
    method: "GET",
    headers,
  });
  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`];
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) lines.push(`${name}: ${item}`);
      } else if (value) {
        lines.push(`${name}: ${value}`);
      }
    }
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(port, "127.0.0.1", () => {
  const current = settings();
  const keyState = current.apiKey ? "set" : "missing";
  console.log(`Bank console http://127.0.0.1:${port} (${current.host}, IV_API_KEY ${keyState})`);
});
