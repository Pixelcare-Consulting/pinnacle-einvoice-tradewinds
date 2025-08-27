const express = require('express');
const router = express.Router();
const path = require('path');
const { auth } = require('../middleware');

// Admin middleware
const isAdmin = (req, res, next) => {
  if (!req.session?.user?.admin) {
    return res.status(403).redirect('/');
  }
  next();
};

// Dashboard v2 - Modern Analytics Dashboard (Default)
router.get('/', auth.middleware, (req, res) => {
  res.render('dashboard/v2', {
    title: 'Dashboard',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// Dashboard v2 - Modern Analytics Dashboard (Explicit route)
router.get('/v2', auth.middleware, (req, res) => {
  res.render('dashboard/v2', {
    title: 'Dashboard v2 - Modern Analytics',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// Dashboard v1 - Legacy Dashboard (Deprecated)
router.get('/v1', auth.middleware, (req, res) => {
  res.render('dashboard/index', {
    title: 'Dashboard v1 (Legacy)',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// Dashboard version switcher
router.get('/switch/:version', auth.middleware, (req, res) => {
  const version = req.params.version;
  if (version === 'v1') {
    res.redirect('/dashboard/v1');
  } else {
    res.redirect('/dashboard');
  }
});

router.get('/audit-trail', auth.middleware, (req, res) => {
  res.render('dashboard/audit-trail.html', {
    title: 'Audit Trail',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// Security dashboard (admin only)
router.get('/security', auth.middleware, isAdmin, (req, res) => {
  res.render('admin/security-dashboard.html', {
    title: 'Security Dashboard',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/outbound', auth.middleware, (req, res) => {
  res.render('dashboard/outbound.html', {
    title: 'Outbound',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/consolidated', auth.middleware, (req, res) => {
  res.render('dashboard/consolidated.html', {
      title: 'Outbound Consolidation',
      user: req.session.user || null,
      layout: 'layout'
  });
});

router.get('/inbound', auth.middleware, (req, res) => {
  res.render('dashboard/inbound.html', {
    title: 'Inbound',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/sdk-updates', auth.middleware, (req, res) => {
  res.render('dashboard/sdk-updates.html', {
    title: 'SDK Updates',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/company-profile', auth.isAdmin, (req, res) => {
  res.render('dashboard/company-profile.html', {
    title: 'Company Profile',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// System Logs page
router.get('/logs', auth.middleware, (req, res) => {
  res.render('dashboard/logs.html', {
    title: 'System Logs',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// TIN Validator - Simple standalone page for validating TINs
router.get('/tin-validator', auth.middleware, (req, res) => {
  res.render('tin-validator.html', {
    title: 'TIN Validator',
    user: req.session.user || null,
    layout: false // No layout - standalone page
  });
});

// Notifications page
router.get('/notifications', auth.middleware, (req, res) => {
  res.render('dashboard/notifications.html', {
    title: 'Notifications',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// Developer Settings page (admin only)
router.get('/developer-settings', auth.isAdmin, (req, res) => {
  res.render('dashboard/developer-settings.html', {
    title: 'Developer Settings',
    user: req.session.user || null,
    layout: 'layout'
  });
});

module.exports = router;