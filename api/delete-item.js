const { getJsonBody, isAdminRequest, methodNotAllowed, readItems, sendJson, writeItems } = require("./_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return methodNotAllowed(response);
    }

    if (!(await isAdminRequest(request))) {
      return sendJson(response, 403, { error: "Session admin expiree. Reconnecte-toi." });
    }

    const { id } = getJsonBody(request);
    const itemId = String(id || "").trim();
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
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
};
