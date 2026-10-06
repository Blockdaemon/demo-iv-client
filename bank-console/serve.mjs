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
    initiatorId: (env.IV_INITIATOR_ID || "").trim(),
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

const ETH_CAIP19 = "eip155:11155111/slip44:60";
const USDC_CAIP19 = "eip155:11155111/erc20:0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const USDC_CONTRACT = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

function apiJson(method, urlPath, body) {
  const current = settings();
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      accept: "application/json",
      authorization: "Bearer " + current.apiKey,
      host: current.host,
      "x-tenant-id": current.tenantId,
    };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(payload.length);
    }
    const req = https.request(
      {
        hostname: current.host,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch {
              json = { raw: text };
            }
          }
          const result = { status: res.statusCode || 0, json };
          if (result.status >= 200 && result.status < 300) {
            resolve(result);
            return;
          }
          const err = new Error(method + " " + urlPath + " " + result.status);
          err.status = result.status;
          err.json = json;
          reject(err);
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameText(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function hasAsset(vault, caip19) {
  return (vault.Assets || []).some((asset) => sameText(asset.CAIP19, caip19));
}

async function listVaults() {
  const vaults = [];
  for (let page = 1; page <= 20; page++) {
    const result = await apiJson("GET", "/api/vaults?page=" + page + "&pageSize=100");
    const batch = (result.json && result.json.Vaults) || [];
    vaults.push(...batch);
    const total = Number(result.json && result.json.TotalCount);
    if (batch.length === 0 || (Number.isFinite(total) && vaults.length >= total)) break;
  }
  return vaults;
}

async function ensureAsset(vault, caip19, symbol) {
  if (hasAsset(vault, caip19)) {
    console.log(vault.Name + " already has " + symbol);
    return;
  }
  try {
    await apiJson("POST", "/api/vaults/" + encodeURIComponent(vault.ID) + "/addAsset", {
      CAIP19: caip19,
    });
    console.log("Added " + symbol + " to " + vault.Name);
  } catch (err) {
    if (err.status === 409) {
      console.log(vault.Name + " already has " + symbol);
      return;
    }
    throw err;
  }
}

function operationOutcome(status) {
  const value = String((status && status.Status) || "");
  if (value === "Succeeded" || value === "Success" || value === "Finished") return "ok";
  if (value === "Failed" || value === "Failure" || value === "Rejected" || value.startsWith("Failed")) {
    return "bad";
  }
  return "";
}

async function waitOperation(id) {
  for (let i = 0; i < 40; i++) {
    const result = await apiJson("GET", "/api/cwp/operations/id/" + encodeURIComponent(id) + "/status");
    const outcome = operationOutcome(result.json);
    if (outcome === "ok" || outcome === "bad") return result.json;
    await sleep(3000);
  }
  throw new Error("Timed out waiting for " + id);
}

async function ensureUsdcRegistered() {
  const listed = await apiJson("GET", "/api/supported-assets");
  const rows = (listed.json && listed.json.SupportedAssets) || [];
  const present = rows.some(
    (row) => sameText(row.CAIP19, USDC_CAIP19) || sameText(row.ContractAddress, USDC_CONTRACT),
  );
  if (present) {
    console.log("USDC already registered");
    return;
  }
  let started;
  try {
    started = await apiJson("POST", "/api/supported-assets", {
      Blockchain: "ethereum",
      CAIP2: "eip155:11155111",
      ContractAddress: USDC_CONTRACT,
    });
  } catch (err) {
    if (err.status === 409) {
      console.log("USDC already registered");
      return;
    }
    throw err;
  }
  const id = started.json && started.json.AsyncOperationID;
  if (!id) throw new Error("USDC registration did not return an operation id");
  console.log("Registering USDC, operation " + id);
  const status = await waitOperation(id);
  if (operationOutcome(status) !== "ok") {
    throw new Error("USDC registration " + (status.Status || "failed"));
  }
  console.log("USDC registered");
}

async function prepareDemoAssets() {
  const current = settings();
  if (!current.apiKey) {
    console.log("Skipping asset setup: IV_API_KEY missing");
    return;
  }
  const vaults = await listVaults();
  const byName = new Map(vaults.map((vault) => [vault.Name, vault]));
  for (const name of ["collections", "gas-sponsor", "payout-hot"]) {
    const vault = byName.get(name);
    if (!vault) {
      console.log("Account missing: " + name);
      continue;
    }
    await ensureAsset(vault, ETH_CAIP19, "ETH");
  }
  await ensureUsdcRegistered();
  for (const name of ["collections", "payout-hot"]) {
    const vault = byName.get(name);
    if (!vault) continue;
    await ensureAsset(vault, USDC_CAIP19, "USDC");
  }
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
  if (url === "/console-config") {
    const current = settings();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ initiatorId: current.initiatorId }));
    return;
  }
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
  prepareDemoAssets().catch((err) => {
    const detail = err.json ? " " + JSON.stringify(err.json) : "";
    console.error("Asset setup failed: " + err.message + detail);
  });
});
