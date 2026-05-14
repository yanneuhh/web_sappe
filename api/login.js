const { createSession, getJsonBody, makeSessionCookie, methodNotAllowed, sendJson } = require("./_shared.cjs");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return methodNotAllowed(response);
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return sendJson(response, 500, { error: "ADMIN_PASSWORD manquant sur Vercel." });
    }

    const body = getJsonBody(request);
    if (body.password !== adminPassword) {
      return sendJson(response, 401, { error: "Mot de passe incorrect." });
    }

    const token = await createSession();
    response.setHeader("Set-Cookie", makeSessionCookie(token));
    return sendJson(response, 200, { isAdmin: true });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Erreur serveur." });
  }
};
