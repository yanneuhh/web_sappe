const { isAdminRequest, methodNotAllowed, sendJson, updateItems } = require("../_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "DELETE") {
      return methodNotAllowed(response);
    }

    if (!(await isAdminRequest(request))) {
      return sendJson(response, 403, { error: "Acces admin requis." });
    }

    const itemId = request.query.id;
    await updateItems((items) => {
      const nextItems = items.filter((item) => item.id !== itemId);

      if (nextItems.length === items.length) {
        const error = new Error("Article introuvable.");
        error.code = "ITEM_NOT_FOUND";
        throw error;
      }

      return nextItems;
    });
    return sendJson(response, 200, { deleted: true });
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
