/**
 * True when the client connection is HTTPS (including behind Render / other reverse proxies).
 */
function isHttpsRequest(req) {
  if (req.secure) return true;
  const xf = req.headers["x-forwarded-proto"];
  if (!xf) return false;
  return String(xf).split(",")[0].trim().toLowerCase() === "https";
}

module.exports = { isHttpsRequest };
