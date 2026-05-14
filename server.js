const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const itemsHandler = require("./api/items");
const loginHandler = require("./api/login");
const logoutHandler = require("./api/logout");
const sessionHandler = require("./api/session");
const deleteItemHandler = require("./api/delete-item");

const rootDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);

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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/items") {
      request.body = await readJsonBody(request);
      return itemsHandler(request, response);
    }

    if (url.pathname === "/api/login") {
      request.body = await readJsonBody(request);
      return loginHandler(request, response);
    }

    if (url.pathname === "/api/logout") {
      request.body = await readJsonBody(request);
      return logoutHandler(request, response);
    }

    if (url.pathname === "/api/session") {
      return sessionHandler(request, response);
    }

    if (url.pathname === "/api/delete-item") {
      request.body = await readJsonBody(request);
      return deleteItemHandler(request, response);
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

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 200_000) throw new Error("Payload trop volumineux.");
  }

  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = path.normalize(path.join(rootDir, cleanPath));

  if (requestedPath !== rootDir && !requestedPath.startsWith(`${rootDir}${path.sep}`)) {
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

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
