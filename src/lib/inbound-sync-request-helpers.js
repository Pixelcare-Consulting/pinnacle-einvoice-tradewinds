function getInboundSyncSessionKey(session) {
  const userId = session?.user?.id;
  const sessionId = session?.id ?? session?.sessionID;
  return String(userId ?? sessionId ?? "anon");
}

function isStaleInboundSyncRequest(activeSyncRequestId, requestSyncRequestId) {
  if (!requestSyncRequestId) return false;
  return Boolean(
    activeSyncRequestId && activeSyncRequestId !== requestSyncRequestId
  );
}

/**
 * Per-session coalesce: concurrent callers await the same in-flight promise.
 * @param {Map<string, Promise<unknown>>} inFlightMap
 */
function coalesceInboundForceRefresh(inFlightMap, sessionKey, factory) {
  let pending = inFlightMap.get(sessionKey);
  if (!pending) {
    pending = Promise.resolve()
      .then(factory)
      .finally(() => {
        if (inFlightMap.get(sessionKey) === pending) {
          inFlightMap.delete(sessionKey);
        }
      });
    inFlightMap.set(sessionKey, pending);
  }
  return pending;
}

module.exports = {
  getInboundSyncSessionKey,
  isStaleInboundSyncRequest,
  coalesceInboundForceRefresh,
};
