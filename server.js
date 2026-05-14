const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const rootDir = path.join(__dirname, "public");
const dataDir = path.join(rootDir, "data");
const itemsPath = path.join(__dirname, "data", "items.json");
const port = Number(process.env.PORT || 4173);
const adminPassword = process.env.ADMIN_PASSWORD || "change-moi";
const sessions = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

if (!process.env.ADMIN_PASSWORD) {
  console.warn("ADMIN_PASSWORD non defini. Mot de passe local temporaire: change-moi");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const itemDeleteMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);

    if (url.pathname === "/api/items" && request.method === "GET") {
      return sendJson(response, 200, await readItems());
    }

    if (url.pathname === "/api/session" && request.method === "GET") {
      return sendJson(response, 200, { isAdmin: isAdminRequest(request) });
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (!body || body.password !== adminPassword) {
        return sendJson(response, 401, { error: "Mot de passe incorrect." });
      }

      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, Date.now());
      response.setHeader("Set-Cookie", makeSessionCookie(token));
      return sendJson(response, 200, { isAdmin: true });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getSessionToken(request);
      if (token) sessions.delete(token);
      response.setHeader("Set-Cookie", "archive_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      return sendJson(response, 200, { isAdmin: false });
    }

    if (url.pathname === "/api/items" && request.method === "POST") {
      if (!isAdminRequest(request)) {
        return sendJson(response, 403, { error: "Acces admin requis." });
      }

      const item = validateItem(await readJsonBody(request));
      const items = await readItems();
      const newItem = {
        id: crypto.randomUUID(),
        ...item,
        createdAt: Date.now(),
      };

      items.unshift(newItem);
      await writeItems(items);
      return sendJson(response, 201, newItem);
    }

    if (url.pathname === "/api/delete-item" && request.method === "POST") {
      if (!isAdminRequest(request)) {
        return sendJson(response, 403, { error: "Session admin expiree. Reconnecte-toi." });
      }

      const body = await readJsonBody(request);
      const itemId = String(body.id || "").trim();
      if (!itemId) {
        return sendJson(response, 400, { error: "Article invalide." });
      }

      const items = await readItems();
      const nextItems = items.filter((item) => item.id !== itemId);

      if (nextItems.length === items.length) {
        return sendJson(response, 404, { error: "Article introuvable." });
      }

      await writeItems(nextItems);
      return sendJson(response, 200, { deleted: true });
    }

    if (itemDeleteMatch && request.method === "DELETE") {
      if (!isAdminRequest(request)) {
        return sendJson(response, 403, { error: "Acces admin requis." });
      }

      const itemId = decodeURIComponent(itemDeleteMatch[1]);
      const items = await readItems();
      const nextItems = items.filter((item) => item.id !== itemId);

      if (nextItems.length === items.length) {
        return sendJson(response, 404, { error: "Article introuvable." });
      }

      await writeItems(nextItems);
      return sendJson(response, 200, { deleted: true });
    }

    if (request.method === "GET") {
      return serveStatic(url.pathname, response);
    }

    return sendJson(response, 405, { error: "Methode non autorisee." });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Archive Bak disponible sur http://127.0.0.1:${port}`);
});

async function readItems() {
  const content = await fs.readFile(itemsPath, "utf8");
  return JSON.parse(content);
}

async function writeItems(items) {
  await fs.mkdir(path.dirname(itemsPath), { recursive: true });
  await fs.writeFile(itemsPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 200_000) throw new Error("Payload trop volumineux.");
  }
  return raw ? JSON.parse(raw) : {};
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

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = path.normalize(path.join(rootDir, cleanPath));

  if (!requestedPath.startsWith(rootDir) || requestedPath.includes(`${path.sep}data${path.sep}`)) {
    return sendText(response, 404, "Not found");
  }

  try {
    const content = await fs.readFile(requestedPath);
    const contentType = mimeTypes[path.extname(requestedPath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  } catch {
    sendText(response, 404, "Not found");
  }
}

function isAdminRequest(request) {
  const token = getSessionToken(request);
  return Boolean(token && sessions.has(token));
}

function getSessionToken(request) {
  const cookie = request.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)archive_session=([^;]+)/);
  return match ? match[1] : "";
}

function makeSessionCookie(token) {
  const maxAge = 60 * 60 * 24 * 30;
  return `archive_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
