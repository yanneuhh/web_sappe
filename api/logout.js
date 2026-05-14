const { clearSessionCookie, destroySession, getSessionToken, methodNotAllowed, sendJson } = require("./_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return methodNotAllowed(response);
    }

    await destroySession(getSessionToken(request));
    response.setHeader("Set-Cookie", clearSessionCookie());
    return sendJson(response, 200, { isAdmin: false });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
};
