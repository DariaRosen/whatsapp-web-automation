/**
 * Service type keys stored in MongoDB (multi-select per lead). Labels in UI (en/he).
 */
const SERVICE_TYPE_KEYS = [
  "business_card",
  "landing_page",
  "website",
  "lead_management_system",
  "ai_agent",
];

const allowed = new Set(SERVICE_TYPE_KEYS);

function isValidServiceTypesArray(arr) {
  if (!Array.isArray(arr)) return false;
  return arr.every((x) => typeof x === "string" && allowed.has(x));
}

module.exports = {
  SERVICE_TYPE_KEYS,
  isValidServiceTypesArray,
};
