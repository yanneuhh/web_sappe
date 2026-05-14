const { isAdminRequest, methodNotAllowed, sendJson } = require("./_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      return methodNotAllowed(response);
    }

    return sendJson(response, 200, { isAdmin: await isAdminRequest(request) });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
};
