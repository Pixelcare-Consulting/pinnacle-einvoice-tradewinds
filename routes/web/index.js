const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware/index-prisma');
const prisma = require('../../src/lib/prisma');
const { LoggingService } = require('../../services/logging-prisma.service');

// Maintenance route (accessible even during maintenance mode)
router.get('/maintenance', (req, res) => {
    res.render('maintenance', {
        title: 'System Maintenance',
        message: 'System is currently under maintenance. Please try again later.'
    });
});

// Auth routes
router.get('/login', (req, res) => {
    // If already logged in, redirect to dashboard
    if (req.session?.user) {
        return res.redirect('/');
    }
    res.render('auth/login.html', {
        title: 'Login',
        layout: false
    });
});

router.post('/auth/logout', async (req, res) => {
    try {
        // Log the logout action if user is in session
        if (req.session?.user) {
            await prisma.wP_LOGS.create({
                data: {
                    Description: `User ${req.session.user.username} logged out`,
                    CreateTS: new Date(),
                    LoggedUser: req.session.user.username,
                    Action: 'LOGOUT',
                    IPAddress: req.ip
                }
            });
        }
        // Destroy the session
        req.session.destroy(() => {
            res.redirect('/login');
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.redirect('/login');
    }
});

// GET route for logout to handle redirects from navbar.js
router.get('/auth/logout', async (req, res) => {
    try {
        // Log the logout action if user is in session
        if (req.session?.user) {
            await prisma.wP_LOGS.create({
                data: {
                    Description: `User ${req.session.user.username} logged out (${req.query.reason || 'manual'})`,
                    CreateTS: new Date(),
                    LoggedUser: req.session.user.username,
                    Action: 'LOGOUT',
                    IPAddress: req.ip
                }
            });
        }

        // Destroy the session
        req.session.destroy(() => {
            const redirectUrl = req.query.expired ?
                `/login?expired=true&reason=${req.query.reason || 'timeout'}` :
                '/login';
            res.redirect(redirectUrl);
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.redirect('/login');
    }
});

// Dashboard v2 - Modern Analytics Dashboard (Default)
router.get('/', auth.middleware, (req, res) => {
  res.render('dashboard/v2', {
    title: 'Dashboard',
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

router.get('/inbound', auth.middleware, (req, res) => {
  res.render('dashboard/inbound.html', {
    title: 'Inbound',
    user: req.session.user || null,
    layout: 'layout'
  });
});


router.get("/outbound", auth.middleware, (req, res) => {
  res.render("dashboard/outbound.html", {
    title: "Outbound Manual",
    user: req.session.user || null,
    layout: "layout",
  });
});


router.get('/outbound-manual', auth.middleware, (req, res) => {
  res.render('dashboard/outbound-manual.html', {
    title: 'Outbound Manual',
    user: req.session.user || null,
    layout: 'layout'
  });
});


// Note: Dashboard routes are now handled by routes/dashboard.routes.js
// This prevents conflicts between old UI (index.html) and new UI (v2.html)
//
// Removed duplicate routes:
// - /dashboard (now handled by dashboardRoutes -> renders v2.html)
// - /inbound (now handled by dashboardRoutes)
// - /outbound (now handled by dashboardRoutes)
// - /outbound-manual (now handled by dashboardRoutes)
// - /security (now handled by dashboardRoutes)

// Consolidated redirect
router.get('/consolidated', auth.middleware, (req, res) => {
    res.render('dashboard/consolidated.html', {
        title: 'Outbound Consolidation',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Help & Support route
router.get('/help', auth.middleware, (req, res) => {
    res.render('dashboard/help.html', {
        title: 'Help & Support',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Changelog route
router.get('/changelog', auth.middleware, (req, res) => {
    res.render('dashboard/changelog.html', {
        title: 'Changelog',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Profile redirect
router.get('/profile', auth.middleware, (req, res) => {
    res.render('dashboard/profile.html', {
        title: 'Profile',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// User settings redirect for normal users
router.get('/settings/user/profile/:id', auth.middleware, auth.isAdmin, (req, res) => {
    res.render('dashboard/user-settings-page.html', {
        title: 'User Settings',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Company profile route
router.get('/company/profile/:name', auth.middleware, auth.isAdmin, (req, res) => {
    res.render('dashboard/company-profile.html', {
        title: 'Company Profile',
        companyName: req.params.companyName,
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Admin settings route
router.get('/settings/user/admin/profile/:id', auth.middleware, auth.isAdmin, (req, res) => {
    res.render('dashboard/admin-settings.html', {
        title: 'User Management',
        id: req.session.user.id,
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Users management route
router.get('/users', auth.middleware, auth.isAdmin, (req, res) => {
    res.render('dashboard/user-management.html', {
        title: 'Users Management',
        user: req.session.user || null,
        layout: 'layout'
    });
});

module.exports = router;
