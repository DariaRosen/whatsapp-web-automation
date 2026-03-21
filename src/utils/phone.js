/**
 * Normalize phone for storage (matches WhatsApp direct-chat ids without @c.us).
 * @param {string} raw
 * @returns {string}
 */
function normalizePhoneInput(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/@c\.us$/i, "").trim();
}

module.exports = { normalizePhoneInput };
