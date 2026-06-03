/**
 * Token Refresh Middleware
 * Proactively refreshes LHDN access tokens before they expire (session expiry only).
 */

const { logger } = require('../utils/logger');
const {
  getTokenSession,
  syncSessionLhdnToken,
  resolveLhdnAccessToken,
} = require('../services/token-prisma.service');

const tokenRefreshMiddleware = async (req, res, next) => {
  try {
    if (!req.session?.user) {
      return next();
    }

    const tokenExpiryTime = req.session.tokenExpiryTime;
    if (!tokenExpiryTime || tokenExpiryTime <= 0) {
      return next();
    }

    const refreshThreshold = 10 * 60 * 1000;
    const now = Date.now();
    const timeUntilExpiry = tokenExpiryTime - now;

    if (timeUntilExpiry >= refreshThreshold) {
      return next();
    }

    logger.info(
      `LHDN token expires in ${Math.floor(timeUntilExpiry / 1000)}s — refreshing via token service`
    );

    try {
      const token = await getTokenSession({ forceRefresh: true });
      if (token) {
        syncSessionLhdnToken(req, token, 3600);
        logger.info('LHDN token refreshed successfully');
      }
    } catch (refreshError) {
      logger.error('Error refreshing LHDN token:', refreshError);
      const existing = await resolveLhdnAccessToken(req);
      if (existing) {
        syncSessionLhdnToken(req, existing, Math.max(60, Math.floor(timeUntilExpiry / 1000)));
      }
    }

    next();
  } catch (error) {
    logger.error('Error in token refresh middleware:', error);
    next();
  }
};

module.exports = tokenRefreshMiddleware;
