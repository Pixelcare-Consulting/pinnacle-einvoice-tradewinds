const NON_TERMINAL_INBOUND_STATUSES = new Set([
  "submitted",
  "pending",
  "processing",
]);

function getSubmissionUidFromDoc(doc) {
  return doc?.submissionUid ?? doc?.submissionuid ?? null;
}

function extractUniqueSubmissionUids(documents) {
  return [
    ...new Set((documents || []).map(getSubmissionUidFromDoc).filter(Boolean)),
  ];
}

function isNonTerminalInboundStatus(status) {
  return NON_TERMINAL_INBOUND_STATUSES.has((status || "").toLowerCase());
}

module.exports = {
  NON_TERMINAL_INBOUND_STATUSES,
  getSubmissionUidFromDoc,
  extractUniqueSubmissionUids,
  isNonTerminalInboundStatus,
};
