const express = require('express');
const router = express.Router();
const prisma = require('../../src/lib/prisma');
const { auth } = require('../../middleware/index-prisma');
const { getTokenSession } = require('../../services/token-prisma.service');
const axios = require('axios');
const { logDBOperation } = require('../../utils/logger');

// Import route modules
const adminSettingsRoutes = require('./admin.settings.routes');
const outboundFilesRoutes = require('./outbound-files');
const outboundManualRoutes = require('./outbound-manual.routes'); // outbound-manual.routes.js - manual upload routes
const userRoutes = require('./user-prisma');
const companySettingsRoutes = require('./company-settings.routes');
const logsRoutes = require('./logs.routes');
const lhdnRoutes = require('./lhdn');
const configRoutes = require('./config');
const geminiRoutes = require('./gemini.routes');
const rssRoutes = require('./rss');

// Import consolidation routes
const consolidationRoutes = require('./consolidation.routes');

// Import utils routes
const utilsRoutes = require('./utils');

// Add admin settings routes
router.use('/admin', auth.isAdmin, adminSettingsRoutes);
// Use route modules
router.use('/outbound-files', outboundFilesRoutes);
router.use('/outbound-files-manual', outboundManualRoutes); // outbound-manual.routes.js - manual upload routes
router.use('/company', companySettingsRoutes);
router.use('/logs', logsRoutes);
router.use('/lhdn', lhdnRoutes);
router.use('/config', configRoutes);
router.use('/user', userRoutes);
router.use('/gemini', geminiRoutes);
router.use('/rss', rssRoutes);

// Register consolidation routes
router.use('/consolidation', consolidationRoutes);

// Register utils routes
router.use('/utils', utilsRoutes);

// User details
router.get('/user-details', async (req, res) => {
  try {
    // Authentication is handled by auth.isApiAuthenticated middleware in server.js
    // Get full user details from database
    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        ...req.session.user,
        id: user.ID // Add the database ID
      }
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User and company details
router.get('/user-company-details', async (req, res) => {
  try {
    // Authentication is handled by auth.isApiAuthenticated middleware in server.js
    // Get user details
    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get company details
    const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
      where: { UserID: user.ID.toString() }
    });

    // Send a more structured response
    res.json({
      success: true,
      user: {
        username: user.Username,
        email: user.Email,
        admin: user.Admin === 1,
        tin: user.TIN
      },
      company: company ? {
        companyName: company.CompanyName,
        email: company.Email,
        companyLogo: company.CompanyImage || '/assets/img/noimage.png',
        industry: company.Industry,
        country: company.Country,
        tin: company.TIN,
        brn: company.BRN,
        about: company.About,
        address: company.Address,
        phone: company.Phone
      } : null
    });
  } catch (error) {
    console.error('Error fetching user and company details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user and company details'
    });
  }
});

// Document endpoints
router.get('/documents/:uuid/document', async (req, res) => {
  const { uuid } = req.params;
  try {
    // Get token from session
    const accessToken = await getTokenSession();
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Failed to get access token'
      });
    }

    const response = await axios.get(
      `https://preprod-api.myinvois.hasil.gov.my/api/v1.0/documents/${uuid}/raw`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    console.log("Document API response:", response.data);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Error fetching document details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch document details' });
  }
});

// Document endpoints
router.get('/documents/recent', async (req, res) => {
  try {
    // Authentication is handled by auth.isApiAuthenticated middleware in server.js
    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get recent documents from WP_INBOUND_STATUS
    const documents = await prisma.wP_INBOUND_STATUS.findMany({
      where: {
        receiverId: user.TIN // Filter by user's TIN
      },
      orderBy: {
        dateTimeReceived: 'desc' // Order by received date, newest first
      },
      take: 100 // Limit to most recent 100 documents
    });

    res.json({
      success: true,
      documents: documents.map(doc => ({
        ...doc,
        dateTimeReceived: doc.dateTimeReceived ? new Date(doc.dateTimeReceived).toISOString() : null
      }))
    });
  } catch (error) {
    console.error('Error fetching recent documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent documents'
    });
  }
});

// Dashboard data endpoints
router.get('/inbound-status/count', async (req, res) => {
  try {
    const { period } = req.query;
    let whereClause = {};

    if (period) {
      const now = new Date();
      switch (period) {
        case 'today':
          // Note: dateTimeReceived is stored as String, so we need to convert dates to ISO strings
          whereClause.dateTimeReceived = {
            gte: new Date(now.setHours(0, 0, 0, 0)).toISOString()
          };
          break;
        case 'this-month':
          whereClause.dateTimeReceived = {
            gte: new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
          };
          break;
        case 'this-year':
          whereClause.dateTimeReceived = {
            gte: new Date(now.getFullYear(), 0, 1).toISOString()
          };
          break;
      }
    }

    const count = await prisma.wP_INBOUND_STATUS.count({ where: whereClause });
    res.json({ count });
  } catch (error) {
    console.error('Error getting inbound count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Inbound status
router.get('/inbound-status', async (req, res) => {
  try {
    const count = await prisma.wP_INBOUND_STATUS.count();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Company count
router.get('/company-count', async (req, res) => {
  try {
    const count = await prisma.wP_COMPANY_SETTINGS.count();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Outbound files count
router.get('/outbound-files/count', async (req, res) => {
  try {
    const count = await prisma.wP_OUTBOUND_STATUS.count();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Logs
router.get('/logs', async (req, res) => {
  try {
    const logs = await prisma.wP_LOGS.findMany({
      orderBy: {
        CreateTS: 'desc'
      },
      take: 10
    });
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Graph data endpoint
router.get('/graph-data', async (req, res) => {
  try {
    // This is a placeholder - implement actual graph data logic based on your system
    const data = {
      sentToLHDN: new Array(7).fill(0),
      valid: new Array(7).fill(0),
      invalid: new Array(7).fill(0),
      rejected: new Array(7).fill(0),
      cancelled: new Array(7).fill(0)
    };
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
