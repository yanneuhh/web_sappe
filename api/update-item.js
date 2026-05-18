const { getJsonBody, isAdminRequest, methodNotAllowed, sendJson, updateItems, validateItem } = require("./_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return methodNotAllowed(response);
    }

    if (!(await isAdminRequest(request))) {
      return sendJson(response, 403, { error: "Session admin expiree. Reconnecte-toi." });
    }

    const body = getJsonBody(request);
    const itemId = String(body?.id || "").trim();
    if (!itemId) {
      return sendJson(response, 400, { error: "Article invalide." });
    }

    let item;
    try {
      item = validateItem(body);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }

    let updatedItem;
    await updateItems((items) => {
      const index = items.findIndex((candidate) => candidate.id === itemId);
      if (index === -1) {
        const error = new Error("Article introuvable.");
        error.code = "ITEM_NOT_FOUND";
        throw error;
      }

      updatedItem = {
        ...items[index],
        ...item,
        id: items[index].id,
        createdAt: items[index].createdAt,
        updatedAt: Date.now(),
      };

      return items.map((candidate, candidateIndex) => (candidateIndex === index ? updatedItem : candidate));
    });

    return sendJson(response, 200, updatedItem);
  } catch (error) {
    console.error(error);
    if (error.code === "ITEM_NOT_FOUND") {
      return sendJson(response, 404, { error: error.message });
    }
    if (
      error.code === "EDGE_CONFIG_WRITE_REQUIRED" ||
      error.code === "EDGE_CONFIG_WRITE_UNAUTHORIZED" ||
      error.code === "EDGE_CONFIG_WRITE_FAILED" ||
      error.code === "EDGE_CONFIG_READ_FAILED"
    ) {
      return sendJson(response, 503, { error: error.message });
    }
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
};
