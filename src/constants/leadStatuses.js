/**
 * Stable keys stored in MongoDB. Labels are translated in the UI (en/he).
 */
const LEAD_STATUS_KEYS = [
  "none",
  "didnt_answer",
  "not_interested",
  "callback_later",
  "waiting_more_details",
  "from_me",
  "waiting_client_details",
];

const LEAD_STATUS_DEFAULT = "none";

module.exports = {
  LEAD_STATUS_KEYS,
  LEAD_STATUS_DEFAULT,
  isValidStatus: (value) => LEAD_STATUS_KEYS.includes(value),
};
