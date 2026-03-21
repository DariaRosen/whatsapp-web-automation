/**
 * In-memory WhatsApp auth state for the dashboard QR page (not persisted).
 */
let latestQrString = null;
let isReady = false;
let lastDisconnectReason = null;

function setQr(qrString) {
  latestQrString = qrString;
  isReady = false;
}

function clearQr() {
  latestQrString = null;
}

function setReady(ready) {
  isReady = Boolean(ready);
  if (ready) {
    latestQrString = null;
    lastDisconnectReason = null;
  }
}

function setDisconnected(reason) {
  isReady = false;
  lastDisconnectReason = reason || "unknown";
}

function getState() {
  return {
    ready: isReady,
    hasQr: Boolean(latestQrString),
    qrString: latestQrString,
    lastDisconnectReason,
  };
}

module.exports = {
  setQr,
  clearQr,
  setReady,
  setDisconnected,
  getState,
};
