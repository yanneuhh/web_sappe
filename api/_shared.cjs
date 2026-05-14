const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const itemsKey = "archive-bak:items";
const sessionPrefix = "archive-bak:session:";
const localItemsPath = path.join(process.cwd(), "data", "items.json");

async function readItems() {
  if (hasKv()) {
    const stored = await kvGet(itemsKey);
    if (Array.isArray(stored)) return stored;

    const seed = await readLocalItems();
    await kvSet(itemsKey, seed);
    return seed;
  }

  return readLocalItems();
}

async function writeItems(items) {
  if (hasKv()) {
    await kvSet(itemsKey, items);
    return;
  }

  assertWritableLocalStorage();
  await fs.mkdir(path.dirname(localItemsPath), { recursive: true });
  await fs.writeFile(localItemsPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function readLocalItems() {
  const content = await fs.readFile(localItemsPath, "utf8");
  return JSON.parse(content);
}

async function createSession() {
  const token = crypto.randomBytes(32).toString("hex");

  if (hasKv()) {
    await kvSet(`${sessionPrefix}${token}`, { createdAt: Date.now() }, 60 * 60 * 24 * 30);
  } else {
    assertWritableLocalStorage();
    await writeLocalSession(token);
  }

  return token;
}

async function destroySession(token) {
  if (!token) return;
  if (hasKv()) {
    await kvDel(`${sessionPrefix}${token}`);
  } else {
    await deleteLocalSession(token);
  }
}

async function isAdminRequest(request) {
  const token = getSessionToken(request);
  if (!token) return false;

  if (hasKv()) {
    return Boolean(await kvGet(`${sessionPrefix}${token}`));
  }

  return localSessionExists(token);
}

function getSessionToken(request) {
  const cookie = request.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)archive_session=([^;]+)/);
  return match ? match[1] : "";
}

function makeSessionCookie(token) {
  const maxAge = 60 * 60 * 24 * 30;
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `archive_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `archive_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function validateItem(body) {
  const item = {
    name: String(body?.name || "").trim(),
    price: Number(body?.price),
    category: String(body?.category || "").trim(),
    source: String(body?.source || "Lien externe").trim(),
    url: String(body?.url || "").trim(),
    image: String(body?.image || "").trim(),
  };

  const categories = new Set(["tops", "outerwear", "pants", "shoes", "accessories"]);
  if (!item.name || item.name.length > 120) throw new Error("Nom invalide.");
  if (!Number.isFinite(item.price) || item.price < 0 || item.price > 100000) throw new Error("Prix invalide.");
  if (!categories.has(item.category)) throw new Error("Categorie invalide.");
  if (!isHttpUrl(item.url) || !isHttpUrl(item.image)) throw new Error("URL invalide.");
  if (item.source.length > 80) throw new Error("Source invalide.");
  return item;
}

function getJsonBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }

  return request.body;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function methodNotAllowed(response) {
  return sendJson(response, 405, { error: "Methode non autorisee." });
}

function hasKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function assertWritableLocalStorage() {
  if (process.env.VERCEL) {
    throw new Error("KV_REST_API_URL et KV_REST_API_TOKEN sont requis pour les actions admin sur Vercel.");
  }
}

async function kvGet(key) {
  const result = await kvRequest(["get", key]);
  return result;
}

async function kvSet(key, value, exSeconds) {
  const command = exSeconds ? ["set", key, JSON.stringify(value), "EX", String(exSeconds)] : ["set", key, JSON.stringify(value)];
  await kvRequest(command);
}

async function kvDel(key) {
  await kvRequest(["del", key]);
}

async function kvRequest(command) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
  });

  if (!response.ok) {
    throw new Error(`KV request failed: ${response.status}`);
  }

  const [entry] = await response.json();
  if (entry.error) throw new Error(entry.error);
  return parseKvValue(entry.result);
}

function parseKvValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function writeLocalSession(token) {
  const sessionDir = path.join(process.cwd(), ".sessions");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, `${token}.json`), JSON.stringify({ createdAt: Date.now() }), "utf8");
}

async function deleteLocalSession(token) {
  try {
    await fs.unlink(path.join(process.cwd(), ".sessions", `${token}.json`));
  } catch {
    // Session already gone.
  }
}

async function localSessionExists(token) {
  try {
    await fs.access(path.join(process.cwd(), ".sessions", `${token}.json`));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  clearSessionCookie,
  createSession,
  destroySession,
  getJsonBody,
  getSessionToken,
  isAdminRequest,
  makeSessionCookie,
  methodNotAllowed,
  readItems,
  sendJson,
  validateItem,
  writeItems,
};
