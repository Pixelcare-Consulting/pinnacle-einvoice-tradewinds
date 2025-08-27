const authConfig = require('../config/auth.config');
const { LoggingService } = require('../services/logging-prisma.service');
const { LOG_TYPES, ACTIONS, STATUS, MODULES } = require('../services/logging-prisma.service');

// In-memory stores for security tracking
const ipAttempts = new Map(); // IP -> { count, firstAttempt, lastAttempt, usernames: Set }
const ipBlacklist = new Map(); // IP -> { blacklistedAt, expiresAt, reason }
const rateLimitStore = new Map(); // IP -> { count, resetTime }

/**
 * Enhanced security middleware for login protection
 */
class SecurityMiddleware {
  
  /**
   * Check if IP is blacklisted
   */
  static isBlacklisted(ip) {
    const blacklistEntry = ipBlacklist.get(ip);
    if (!blacklistEntry) return false;
    
    // Check if blacklist has expired
    if (Date.now() > blacklistEntry.expiresAt) {
      ipBlacklist.delete(ip);
      return false;
    }
    
    return true;
  }
  
  /**
   * Add IP to blacklist
   */
  static async blacklistIP(ip, reason = 'Excessive failed login attempts', duration = null) {
    const blacklistDuration = duration || authConfig.security.ipBlacklist.blacklistDuration;
    const expiresAt = Date.now() + blacklistDuration;
    
    ipBlacklist.set(ip, {
      blacklistedAt: Date.now(),
      expiresAt,
      reason
    });
    
    // Log the blacklisting
    await LoggingService.log({
      description: `IP blacklisted: ${ip}`,
      ipAddress: ip,
      logType: LOG_TYPES.SECURITY,
      module: MODULES.AUTH,
      action: ACTIONS.BLOCK,
      status: STATUS.SUCCESS,
      details: {
        reason,
        duration: blacklistDuration,
        expiresAt: new Date(expiresAt).toISOString()
      }
    });
    
    console.log(`🚫 IP ${ip} blacklisted for ${Math.round(blacklistDuration / 1000 / 60)} minutes. Reason: ${reason}`);
  }
  
  /**
   * Remove IP from blacklist
   */
  static async removeFromBlacklist(ip) {
    const removed = ipBlacklist.delete(ip);
    if (removed) {
      await LoggingService.log({
        description: `IP removed from blacklist: ${ip}`,
        ipAddress: ip,
        logType: LOG_TYPES.SECURITY,
        module: MODULES.AUTH,
        action: ACTIONS.UNBLOCK,
        status: STATUS.SUCCESS
      });
      console.log(`✅ IP ${ip} removed from blacklist`);
    }
    return removed;
  }
  
  /**
   * Rate limiting check
   */
  static checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = authConfig.security.rateLimiting.windowMs;
    const maxRequests = authConfig.security.rateLimiting.maxRequests;
    
    let rateLimitData = rateLimitStore.get(ip);
    
    // Initialize or reset if window expired
    if (!rateLimitData || now > rateLimitData.resetTime) {
      rateLimitData = {
        count: 0,
        resetTime: now + windowMs
      };
      rateLimitStore.set(ip, rateLimitData);
    }
    
    rateLimitData.count++;
    
    if (rateLimitData.count > maxRequests) {
      const resetIn = Math.ceil((rateLimitData.resetTime - now) / 1000);
      return {
        allowed: false,
        resetIn,
        message: `Rate limit exceeded. Try again in ${Math.ceil(resetIn / 60)} minutes.`
      };
    }
    
    return {
      allowed: true,
      remaining: maxRequests - rateLimitData.count,
      resetIn: Math.ceil((rateLimitData.resetTime - now) / 1000)
    };
  }
  
  /**
   * Track login attempt and detect suspicious activity
   */
  static async trackAttempt(ip, username, success = false) {
    const now = Date.now();
    
    // Get or create IP attempt data
    let attemptData = ipAttempts.get(ip);
    if (!attemptData) {
      attemptData = {
        count: 0,
        firstAttempt: now,
        lastAttempt: now,
        usernames: new Set(),
        successfulLogins: 0,
        failedLogins: 0
      };
      ipAttempts.set(ip, attemptData);
    }
    
    // Update attempt data
    attemptData.count++;
    attemptData.lastAttempt = now;
    attemptData.usernames.add(username);
    
    if (success) {
      attemptData.successfulLogins++;
    } else {
      attemptData.failedLogins++;
    }
    
    // Check for suspicious activity
    await this.checkSuspiciousActivity(ip, attemptData);
    
    // Check if IP should be auto-blacklisted
    if (!success && authConfig.security.ipBlacklist.enabled) {
      if (attemptData.failedLogins >= authConfig.security.ipBlacklist.autoBlacklistThreshold) {
        await this.blacklistIP(ip, `Auto-blacklisted: ${attemptData.failedLogins} failed attempts`);
      }
    }
    
    return attemptData;
  }
  
  /**
   * Check for suspicious activity patterns
   */
  static async checkSuspiciousActivity(ip, attemptData) {
    const config = authConfig.security.suspiciousActivity;
    if (!config.enabled) return;
    
    const now = Date.now();
    const timeWindow = config.timeWindow;
    
    // Check if too many attempts in time window
    if (attemptData.count >= config.ipThreshold && 
        (now - attemptData.firstAttempt) <= timeWindow) {
      
      await LoggingService.log({
        description: `Suspicious activity detected: High frequency attempts`,
        ipAddress: ip,
        logType: LOG_TYPES.SECURITY,
        module: MODULES.AUTH,
        action: ACTIONS.DETECT,
        status: STATUS.WARNING,
        details: {
          attempts: attemptData.count,
          timeWindow: timeWindow / 1000 / 60, // minutes
          uniqueUsernames: attemptData.usernames.size
        }
      });
    }
    
    // Check if too many different usernames
    if (attemptData.usernames.size >= config.usernameVariationThreshold) {
      await LoggingService.log({
        description: `Suspicious activity detected: Username enumeration`,
        ipAddress: ip,
        logType: LOG_TYPES.SECURITY,
        module: MODULES.AUTH,
        action: ACTIONS.DETECT,
        status: STATUS.WARNING,
        details: {
          uniqueUsernames: attemptData.usernames.size,
          totalAttempts: attemptData.count
        }
      });
    }
  }
  
  /**
   * Get progressive lockout duration based on attempt count
   */
  static getProgressiveLockoutDuration(attemptCount) {
    const config = authConfig.security.rateLimiting.progressive;
    if (!config.enabled) {
      return authConfig.login.lockoutDuration;
    }
    
    let multiplier = 1;
    for (let i = 0; i < config.thresholds.length; i++) {
      if (attemptCount >= config.thresholds[i]) {
        multiplier = config.multipliers[i];
      }
    }
    
    return authConfig.login.lockoutDuration * multiplier;
  }
  
  /**
   * Cleanup expired entries
   */
  static cleanup() {
    const now = Date.now();
    
    // Cleanup expired blacklist entries
    for (const [ip, data] of ipBlacklist.entries()) {
      if (now > data.expiresAt) {
        ipBlacklist.delete(ip);
      }
    }
    
    // Cleanup old attempt data (older than 24 hours)
    const maxAge = 24 * 60 * 60 * 1000;
    for (const [ip, data] of ipAttempts.entries()) {
      if (now - data.lastAttempt > maxAge) {
        ipAttempts.delete(ip);
      }
    }
    
    // Cleanup expired rate limit data
    for (const [ip, data] of rateLimitStore.entries()) {
      if (now > data.resetTime) {
        rateLimitStore.delete(ip);
      }
    }
  }
  
  /**
   * Get security statistics
   */
  static getStats() {
    return {
      blacklistedIPs: ipBlacklist.size,
      trackedIPs: ipAttempts.size,
      rateLimitedIPs: rateLimitStore.size,
      blacklistEntries: Array.from(ipBlacklist.entries()).map(([ip, data]) => ({
        ip,
        reason: data.reason,
        blacklistedAt: new Date(data.blacklistedAt).toISOString(),
        expiresAt: new Date(data.expiresAt).toISOString()
      }))
    };
  }
  
  /**
   * Middleware to require admin authentication
   */
  static requireAdmin(req, res, next) {
    // Check if user is logged in
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }
    
    // Check if user is admin
    if (!req.session.user.admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required',
        code: 'NOT_AUTHORIZED'
      });
    }
    
    next();
  }
}

/**
 * Express middleware for login security
 */
const loginSecurityMiddleware = async (req, res, next) => {
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   req.headers['x-real-ip'] ||
                   req.connection.remoteAddress ||
                   req.socket.remoteAddress ||
                   req.ip;

  try {
    // Check if IP is blacklisted
    if (SecurityMiddleware.isBlacklisted(clientIP)) {
      await LoggingService.log({
        description: `Blocked request from blacklisted IP: ${clientIP}`,
        ipAddress: clientIP,
        logType: LOG_TYPES.SECURITY,
        module: MODULES.AUTH,
        action: ACTIONS.BLOCK,
        status: STATUS.SUCCESS
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied. Your IP has been temporarily blocked due to suspicious activity.',
        code: 'IP_BLACKLISTED'
      });
    }

    // Check rate limiting
    const rateLimitResult = SecurityMiddleware.checkRateLimit(clientIP);
    if (!rateLimitResult.allowed) {
      await LoggingService.log({
        description: `Rate limit exceeded for IP: ${clientIP}`,
        ipAddress: clientIP,
        logType: LOG_TYPES.SECURITY,
        module: MODULES.AUTH,
        action: ACTIONS.BLOCK,
        status: STATUS.SUCCESS,
        details: {
          resetIn: rateLimitResult.resetIn
        }
      });

      return res.status(429).json({
        success: false,
        message: rateLimitResult.message,
        code: 'RATE_LIMITED',
        retryAfter: rateLimitResult.resetIn
      });
    }

    // Add security info to request for use in auth handlers
    req.security = {
      clientIP,
      rateLimitRemaining: rateLimitResult.remaining,
      rateLimitResetIn: rateLimitResult.resetIn
    };

    next();
  } catch (error) {
    console.error('Security middleware error:', error);
    await LoggingService.log({
      description: `Security middleware error: ${error.message}`,
      ipAddress: clientIP,
      logType: LOG_TYPES.ERROR,
      module: MODULES.AUTH,
      action: ACTIONS.ERROR,
      status: STATUS.FAILED,
      details: {
        error: error.message,
        stack: error.stack
      }
    });

    // Don't block the request on middleware errors, just log and continue
    next();
  }
};

// Start cleanup interval
setInterval(() => {
  SecurityMiddleware.cleanup();
}, authConfig.security.ipBlacklist.cleanupInterval);

module.exports = {
  SecurityMiddleware,
  loginSecurityMiddleware
};
