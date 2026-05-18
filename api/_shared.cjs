const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const localItemsPath = path.join(process.cwd(), "data", "items.json");

async function readItems() {
  const edgeConfig = getEdgeConfigConnection();
  if (edgeConfig) {
    try {
      return await fetchEdgeConfigItems(edgeConfig);
    } catch (error) {
      if (error.code !== "EDGE_CONFIG_READ_FAILED") throw error;
      if (process.env.VERCEL) throw error;
    }
  }

  return readLocalItems();
}

async function writeItems(items) {
  const edgeConfig = getEdgeConfigConnection();
  if (edgeConfig) {
    await writeEdgeConfigItems(edgeConfig, items, await readEdgeConfigItemsForWrite(edgeConfig));
    return;
  }

  assertWritableLocalStorage();
  await fs.mkdir(path.dirname(localItemsPath), { recursive: true });
  await fs.writeFile(localItemsPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function updateItems(updater) {
  const edgeConfig = getEdgeConfigConnection();
  if (edgeConfig) {
    const currentItems = await readEdgeConfigItemsForWrite(edgeConfig);
    const nextItems = await updater(currentItems.map((item) => ({ ...item })));
    if (!Array.isArray(nextItems)) {
      throw new Error("Mise a jour catalogue invalide.");
    }

    await writeEdgeConfigItems(edgeConfig, nextItems, currentItems);
    return nextItems;
  }

  const currentItems = await readLocalItems();
  const nextItems = await updater(currentItems.map((item) => ({ ...item })));
  if (!Array.isArray(nextItems)) {
    throw new Error("Mise a jour catalogue invalide.");
  }

  assertWritableLocalStorage();
  await fs.mkdir(path.dirname(localItemsPath), { recursive: true });
  await fs.writeFile(localItemsPath, `${JSON.stringify(nextItems, null, 2)}\n`, "utf8");
  return nextItems;
}

async function readLocalItems() {
  try {
    const content = await fs.readFile(localItemsPath, "utf8");
    const items = JSON.parse(content);
    return Array.isArray(items) ? items : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function createSession() {
  return createSignedSessionToken();
}

async function destroySession(token) {
  return token;
}

async function isAdminRequest(request) {
  const token = getSessionToken(request);
  return verifySignedSessionToken(token);
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

function createSignedSessionToken() {
  const payload = {
    role: "admin",
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signValue(encodedPayload)}`;
}

function verifySignedSessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;

  const expected = signValue(encodedPayload);
  if (!timingSafeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    return payload.role === "admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function signValue(value) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "archive-bak-local-secret";
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
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

function getEdgeConfigConnection() {
  const raw = process.env.EDGE_CONFIG;
  if (!raw) return null;

  try {
    if (raw.startsWith("edge-config:")) {
      const params = new URLSearchParams(raw.slice("edge-config:".length));
      const id = params.get("id") || params.get("edgeConfigId") || "";
      const token = params.get("token") || params.get("readToken") || "";
      if (!id || !token) return null;
      return { id, token };
    }

    const url = new URL(raw);
    const id = url.pathname.split("/").filter(Boolean)[0] || url.searchParams.get("id") || url.searchParams.get("edgeConfigId") || "";
    const token = url.searchParams.get("token") || url.searchParams.get("readToken") || "";
    if (!id || !token) return null;
    return { id, token };
  } catch {
    return null;
  }
}

async function fetchEdgeConfigItems(edgeConfig) {
  const response = await fetch(`https://edge-config.vercel.com/${edgeConfig.id}/items`, {
    headers: {
      Authorization: `Bearer ${edgeConfig.token}`,
    },
  });

  if (!response.ok) {
    const error = new Error(`Erreur lecture Edge Config (${response.status}). Verifie EDGE_CONFIG.`);
    error.code = "EDGE_CONFIG_READ_FAILED";
    throw error;
  }

  const rawItems = await response.json();
  const catalog = parseEdgeCatalog(rawItems);
  if (!Array.isArray(catalog)) return [];

  return normalizeCatalogItems(catalog);
}

async function readEdgeConfigItemsForWrite(edgeConfig) {
  const token = getVercelWriteToken();
  const response = await fetch(createEdgeConfigApiUrl(edgeConfig, `item/${encodeURIComponent("catalog")}`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) return [];

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const error = new Error(`Erreur lecture Edge Config (${response.status}). Verifie VERCEL_TOKEN et EDGE_CONFIG. ${details}`.trim());
    error.code = "EDGE_CONFIG_READ_FAILED";
    throw error;
  }

  const rawItem = await response.json();
  const catalog = parseEdgeValue(rawItem?.value);
  return Array.isArray(catalog) ? normalizeCatalogItems(catalog) : [];
}

async function writeEdgeConfigItems(edgeConfig, items, previousItems = []) {
  const token = getVercelWriteToken();
  const backup = {
    savedAt: new Date().toISOString(),
    itemCount: previousItems.length,
    items: previousItems,
  };

  const response = await fetch(createEdgeConfigApiUrl(edgeConfig, "items"), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      items: [
        {
          operation: "upsert",
          key: "catalog_backup",
          value: backup,
          description: "Archive Bak catalog backup",
        },
        {
          operation: "upsert",
          key: "catalog",
          value: items,
          description: "Archive Bak catalog",
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const error = new Error(`Erreur ecriture Edge Config (${response.status}). Verifie VERCEL_TOKEN et EDGE_CONFIG. ${details}`.trim());
    error.code = "EDGE_CONFIG_WRITE_FAILED";
    throw error;
  }
}

function getVercelWriteToken() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    const error = new Error("VERCEL_TOKEN manquant. Ajoute un token Vercel pour ecrire dans Edge Config.");
    error.code = "EDGE_CONFIG_WRITE_UNAUTHORIZED";
    throw error;
  }

  return token;
}

function createEdgeConfigApiUrl(edgeConfig, suffix) {
  const apiUrl = new URL(`https://api.vercel.com/v1/edge-config/${encodeURIComponent(edgeConfig.id)}/${suffix}`);
  if (process.env.VERCEL_TEAM_ID) {
    apiUrl.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  }
  if (process.env.VERCEL_TEAM_SLUG) {
    apiUrl.searchParams.set("slug", process.env.VERCEL_TEAM_SLUG);
  }

  return apiUrl;
}

function parseEdgeValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseEdgeCatalog(rawItems) {
  if (Array.isArray(rawItems)) {
    const catalogItem = rawItems.find((item) => item && item.key === "catalog");
    return catalogItem ? parseEdgeValue(catalogItem.value) : [];
  }

  if (rawItems && typeof rawItems === "object" && Object.hasOwn(rawItems, "catalog")) {
    return parseEdgeValue(rawItems.catalog);
  }

  return [];
}

function normalizeCatalogItems(catalog) {
  return catalog
    .filter((entry) => entry && !entry.deleted)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function assertWritableLocalStorage() {
  if (process.env.VERCEL) {
    const error = new Error("Edge Config non configure pour l'ecriture. Ajoute VERCEL_TOKEN et EDGE_CONFIG.");
    error.code = "EDGE_CONFIG_WRITE_REQUIRED";
    throw error;
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
  updateItems,
  validateItem,
  writeItems,
};
