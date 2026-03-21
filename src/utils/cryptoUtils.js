const crypto = require("crypto");

/**
 * Constant-time string comparison to reduce timing leaks when checking secrets.
 */
function timingSafeEqualStrings(secret, attempt) {
  if (typeof secret !== "string" || typeof attempt !== "string") return false;
  if (secret.length !== attempt.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(attempt, "utf8"));
  } catch {
    return false;
  }
}

module.exports = { timingSafeEqualStrings };
