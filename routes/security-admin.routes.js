const express = require('express');
const router = express.Router();
const { SecurityMiddleware } = require('../middleware/security.middleware');
const { LoggingService } = require('../services/logging-prisma.service');
const { LOG_TYPES, ACTIONS, STATUS, MODULES } = require('../services/logging-prisma.service');
const authConfig = require('../config/auth.config');

/**
 * Security Admin Routes
 * Requires admin authentication
 */

// Middleware to check admin access
const requireAdmin = (req, res, next) => {
  if (!req.session?.user?.admin) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

// Get security dashboard data
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const stats = SecurityMiddleware.getStats();
    
    // Get recent security logs
    const recentLogs = await LoggingService.getAuditLogs({
      page: 1,
      limit: 50,
      module: 'AUTH'
    });

    res.json({
      success: true,
      data: {
        stats,
        recentLogs: recentLogs.logs || [],
        config: {
          rateLimiting: authConfig.security.rateLimiting,
          ipBlacklist: authConfig.security.ipBlacklist,
          captcha: {
            enabled: authConfig.security.captcha.enabled,
            triggerThreshold: authConfig.security.captcha.triggerThreshold
          }
        }
      }
    });
  } catch (error) {
    console.error('Security dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load security dashboard'
    });
  }
});

// Get blacklisted IPs
router.get('/blacklist', requireAdmin, async (req, res) => {
  try {
    const stats = SecurityMiddleware.getStats();
    res.json({
      success: true,
      data: stats.blacklistEntries
    });
  } catch (error) {
    console.error('Get blacklist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blacklist'
    });
  }
});

// Add IP to blacklist
router.post('/blacklist', requireAdmin, async (req, res) => {
  try {
    const { ip, reason, duration } = req.body;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
    }

    // Validate IP format (basic validation)
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IP address format'
      });
    }

    await SecurityMiddleware.blacklistIP(
      ip, 
      reason || 'Manually blacklisted by admin',
      duration ? parseInt(duration) : null
    );

    // Log admin action
    await LoggingService.log({
      description: `Admin manually blacklisted IP: ${ip}`,
      username: req.session.user.username,
      ipAddress: req.ip,
      logType: LOG_TYPES.SECURITY,
      module: MODULES.AUTH,
      action: ACTIONS.BLOCK,
      status: STATUS.SUCCESS,
      details: {
        targetIP: ip,
        reason: reason || 'Manually blacklisted by admin',
        duration
      }
    });

    res.json({
      success: true,
      message: `IP ${ip} has been blacklisted`
    });
  } catch (error) {
    console.error('Blacklist IP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to blacklist IP'
    });
  }
});

// Remove IP from blacklist
router.delete('/blacklist/:ip', requireAdmin, async (req, res) => {
  try {
    const { ip } = req.params;
    
    const removed = await SecurityMiddleware.removeFromBlacklist(ip);
    
    if (removed) {
      // Log admin action
      await LoggingService.log({
        description: `Admin removed IP from blacklist: ${ip}`,
        username: req.session.user.username,
        ipAddress: req.ip,
        logType: LOG_TYPES.SECURITY,
        module: MODULES.AUTH,
        action: ACTIONS.UNBLOCK,
        status: STATUS.SUCCESS,
        details: {
          targetIP: ip
        }
      });

      res.json({
        success: true,
        message: `IP ${ip} has been removed from blacklist`
      });
    } else {
      res.status(404).json({
        success: false,
        message: `IP ${ip} was not found in blacklist`
      });
    }
  } catch (error) {
    console.error('Remove from blacklist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove IP from blacklist'
    });
  }
});

// Get security logs with filtering
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const {
      logType = LOG_TYPES.SECURITY,
      limit = 100,
      offset = 0,
      startDate,
      endDate,
      ipAddress,
      username
    } = req.query;

    const filters = {
      logType,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (ipAddress) filters.ipAddress = ipAddress;
    if (username) filters.username = username;

    const result = await LoggingService.getAuditLogs(filters);

    res.json({
      success: true,
      data: result.logs || []
    });
  } catch (error) {
    console.error('Get security logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security logs'
    });
  }
});

// Get login attempt statistics
router.get('/stats/attempts', requireAdmin, async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    
    let startDate;
    const now = new Date();
    
    switch (timeframe) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const result = await LoggingService.getAuditLogs({
      module: MODULES.AUTH,
      action: ACTIONS.LOGIN,
      startDate,
      endDate: now,
      limit: 1000,
      page: 1
    });

    const logs = result.logs || [];

    // Process statistics
    const stats = {
      totalAttempts: logs.length,
      successfulLogins: logs.filter(log => log.status === STATUS.SUCCESS).length,
      failedLogins: logs.filter(log => log.status === STATUS.FAILED).length,
      uniqueIPs: new Set(logs.map(log => log.ipAddress)).size,
      uniqueUsers: new Set(logs.map(log => log.username)).size,
      timeframe
    };

    stats.successRate = stats.totalAttempts > 0 ? 
      ((stats.successfulLogins / stats.totalAttempts) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get attempt stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attempt statistics'
    });
  }
});

// Emergency: Clear all blacklists (use with caution)
router.post('/emergency/clear-blacklist', requireAdmin, async (req, res) => {
  try {
    const { confirm } = req.body;
    
    if (confirm !== 'CLEAR_ALL_BLACKLISTS') {
      return res.status(400).json({
        success: false,
        message: 'Confirmation required. Send { "confirm": "CLEAR_ALL_BLACKLISTS" }'
      });
    }

    // This would require adding a method to SecurityMiddleware
    // For now, we'll log the action
    await LoggingService.log({
      description: 'Admin requested emergency blacklist clear',
      username: req.session.user.username,
      ipAddress: req.ip,
      logType: LOG_TYPES.SECURITY,
      module: MODULES.AUTH,
      action: ACTIONS.UNBLOCK,
      status: STATUS.SUCCESS,
      details: {
        action: 'emergency_clear_blacklist'
      }
    });

    res.json({
      success: true,
      message: 'Emergency blacklist clear logged. Manual intervention may be required.'
    });
  } catch (error) {
    console.error('Emergency clear error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process emergency clear'
    });
  }
});

module.exports = router;
