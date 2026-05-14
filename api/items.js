const crypto = require("node:crypto");
const { getJsonBody, isAdminRequest, methodNotAllowed, readItems, sendJson, validateItem, writeItems } = require("./_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method === "GET") {
      return sendJson(response, 200, await readItems());
    }

    if (request.method === "POST") {
      if (!(await isAdminRequest(request))) {
        return sendJson(response, 403, { error: "Acces admin requis." });
      }

      const item = validateItem(getJsonBody(request));
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

    return methodNotAllowed(response);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
};
