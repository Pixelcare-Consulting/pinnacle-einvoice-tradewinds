// 1. Environment and Core Dependencies
require("dotenv").config();
const express = require("express");
const https = require("https"); 
const session = require("express-session");
const cors = require("cors");
const swig = require("swig");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os"); // Added os module which was missing
const helmet = require("helmet"); // Added for security headers
const compression = require("compression"); // Added for gzip compression
const PrismaSessionStore = require("./src/lib/prisma-session-store");

// 2. Local Dependencies
const serverConfig = require("./config/server.config");
const authConfig = require("./config/auth.config");
const {
  auth,
  error,
  maintenance,
  validation,
} = require("./middleware/index-prisma");
const versionHeader = require("./utils/versionHeader");
const appVersion = require("./config/version");
const { initJsReport } = require("./services/jsreport.service");
const authRoutes = require("./routes/auth-prisma.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const apiRoutes = require("./routes/api/index");
const webRoutes = require("./routes/web/index");
const dashboardAnalyticsRouter = require("./routes/api/dashboard-analytics");
const dashboardStatsRouter = require("./routes/api/dashboard-stats");
const securityAdminRoutes = require("./routes/security-admin.routes");
const captchaRoutes = require("./routes/captcha.routes");
const passport = require("./config/passport-prisma.config");

// 3. Initialize Express
const app = express();

// Trust proxy headers from IIS
app.set("trust proxy", "loopback");

// Version Header middleware
app.use(versionHeader);

// Add Helmet for better security headers (alternative to manual implementation)
app.use(
  helmet({
    contentSecurityPolicy: false, // Configure based on your needs
    crossOriginEmbedderPolicy: false, // Modify as needed
  })
);

// Add HSTS for HTTPS
app.use((req, res, next) => {
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  res.locals.appVersion = appVersion.getSemanticVersion();
  res.locals.appFullVersion = appVersion.getFullVersion();
  next();
});

// Enable CORS with specific options
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Set-Cookie"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options("*", cors(corsOptions));

// Configure Swig
swig.setDefaults({
  cache: process.env.NODE_ENV === "production" ? "memory" : false,
  loader: swig.loaders.fs(path.join(__dirname, "views")),
  locals: {
    basedir: path.join(__dirname, "views"),
  },
});

// Clear Swig cache on startup to prevent old template conflicts
if (process.env.NODE_ENV === "production") {
  swig.invalidateCache();
  console.log("Swig template cache cleared on startup");
}

app.engine("html", swig.renderFile);
app.set("view engine", "html");
app.set("views", path.join(__dirname, "views"));

// 4. Core Middleware Setup
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Compression middleware - gzip responses for better performance
app.use(compression({
  filter: (req, res) => {
    // Don't compress if client doesn't accept encoding
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use compression filter for other cases
    return compression.filter(req, res);
  },
  level: 6, // Balance between speed and compression ratio
  threshold: 1024, // Only compress responses larger than 1KB
}));

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.error("Request has timed out.");
    res.status(503).send("Service temporarily unavailable. Please try again.");
  });
  next();
});

// Static file serving with correct MIME types and caching
const staticFileMiddleware = (req, res, next) => {
  if (req.path.endsWith(".css")) {
    res.type("text/css");
  } else if (req.path.endsWith(".js")) {
    res.type("application/javascript");
  }
  next();
};

// Cache configuration for static assets
const staticCacheConfig = {
  maxAge: '365d', // 1 year for immutable assets
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // HTML files should not be cached to ensure updates are seen immediately
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // JavaScript and CSS files - cache with validation
    else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Images and fonts - long cache
    else if (/\.(jpg|jpeg|png|gif|svg|ico|woff|woff2|ttf|eot)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
};

// Temp files should have short cache (they may be regenerated)
const tempCacheConfig = {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
};

// Static file routes
app.use(
  "/assets",
  staticFileMiddleware,
  express.static(path.join(__dirname, "public/assets"), staticCacheConfig)
);
app.use("/temp", express.static(path.join(__dirname, "public/temp"), tempCacheConfig));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads"), staticCacheConfig));
app.use("/reports", express.static(path.join(__dirname, "src/reports"), staticCacheConfig));
app.use(express.static(path.join(__dirname, "public"), staticCacheConfig));

// Session configuration with secure cookies and Prisma store
app.use(
  session({
    ...serverConfig.sessionConfig,
    cookie: {
      ...serverConfig.sessionConfig.cookie,
      secure: process.env.SECURE_COOKIE === "true",
      sameSite: "lax",
      maxAge: authConfig.session.timeout,
      rolling: true,
      httpOnly: true, // Ensure cookies are HTTP only
    },
    resave: true,
    saveUninitialized: true,
    store: new PrismaSessionStore({
      ttl: authConfig.session.timeout / 1000, // Convert from ms to seconds
      tableName: "Session",
    }),
  })
);

// Add after session middleware and before routes
app.use(passport.initialize());
app.use(passport.session());

// 5. Application Middleware
app.use(maintenance); // Maintenance mode check
app.use("/auth", authRoutes); // Auth routes (before auth middleware)
app.use("/api/v1/auth", authRoutes);

app.get("/api/version", (req, res) => {
  res.json({
    version: appVersion.getSemanticVersion(),
    fullVersion: appVersion.getFullVersion(),
    timestamp: appVersion.buildDate,
  });
});

// Clear template cache endpoint (for debugging UI issues)
app.get("/api/clear-cache", (req, res) => {
  try {
    swig.invalidateCache();
    res.json({
      success: true,
      message: "Template cache cleared successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to clear cache",
      error: error.message
    });
  }
});

// Cache statistics endpoint (for monitoring)
app.get("/api/cache-stats", (req, res) => {
  try {
    const { responseCache } = require('./middleware/index-prisma');
    const stats = responseCache.getCacheStats();
    res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get cache stats",
      error: error.message
    });
  }
});

// Clear response cache endpoint (admin only)
app.post("/api/clear-response-cache", auth.isApiAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const { responseCache } = require('./middleware/index-prisma');
    responseCache.clearAllCaches();
    res.json({
      success: true,
      message: "Response cache cleared successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to clear response cache",
      error: error.message
    });
  }
});

// CAPTCHA routes (public access)
app.use("/api/captcha", captchaRoutes);

// Optimized auth middleware - Check public paths first before expensive auth
app.use((req, res, next) => {
  // Fast path check for static assets and public routes
  const path = req.path;
  const publicPaths = [
    "/assets/",
    "/dist/",
    "/favicon.ico",
    "/public/",
    "/uploads/",
    "/temp/",
    "/reports/",
    "/auth/",
    "/vendor/",
    "/api/captcha/",
    "/api/health",
    "/api/version",
    "/api/clear-cache",
    "/api/cache-stats",
  ];

  // Quick string comparison for most common paths
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/dist/") ||
    path === "/favicon.ico" ||
    path.startsWith("/auth/") ||
    path === "/api/health" ||
    path === "/api/version"
  ) {
    return next();
  }

  // Fallback to array check for less common paths
  if (publicPaths.some((publicPath) => path.startsWith(publicPath))) {
    return next();
  }

  // Apply auth middleware for protected routes
  auth.middleware(req, res, next);
});

// Protected routes
app.use("/dashboard", dashboardRoutes);

// API routes - ensure all API routes are registered before the catch-all /api route
// Dashboard analytics and stats routes
app.use(
  "/api/dashboard-analytics",
  auth.isApiAuthenticated,
  dashboardAnalyticsRouter
);
app.use("/api/dashboard", auth.isApiAuthenticated, dashboardStatsRouter);

// Security admin routes (requires admin access)
app.use("/api/security-admin", auth.isApiAuthenticated, securityAdminRoutes);

// Main API routes - this should be registered last to avoid overriding specific API routes
app.use("/api", auth.isApiAuthenticated, apiRoutes);

// Web routes
app.use("/", webRoutes);

// 6. Error Handling
// 404 handler
app.use((req, res, next) => {
  // Check if headers have already been sent
  if (res.headersSent) {
    console.error("Headers already sent, cannot send 404 response");
    return next();
  }

  if (req.xhr || req.headers.accept?.includes("application/json")) {
    res.status(404).json({ success: false, message: "Not Found" });
  } else {
    res.status(404).render("error", {
      title: "Not Found",
      message: "The page you are looking for does not exist.",
    });
  }
});

// Global error handler
app.use(error);

async function ensureDirectories() {
  const dirs = [
    path.join(__dirname, "public/temp"),
    path.join(__dirname, "uploads/company-logos"),
    path.join(process.env.TEMP || os.tmpdir(), "jsreport"), // Add jsreport temp directory
  ];

  for (const dir of dirs) {
    try {
      await fsPromises.access(dir);
    } catch {
      console.log(`Creating directory: ${dir}`);
      await fsPromises.mkdir(dir, { recursive: true });
    }
  }
}

// 7. Server Startup
const startServer = async () => {
  let jsreportInstance;
  let server;

  try {
    await ensureDirectories();
    jsreportInstance = await initJsReport();

    const port = serverConfig.port;
    
    // Create HTTPS server with proper SSL configuration
    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, 'ssl', 'client.key')),
      cert: fs.readFileSync(path.join(__dirname, 'ssl', 'client.crt')),
      requestCert: false,
      rejectUnauthorized: false
    };

    server = https.createServer(httpsOptions, app);

    server.listen(port, () => {
      console.log(`✅ HTTPS Server started on https://localhost:${port}`);
    }).on('error', (err) => {
      console.error('Server error:', err);
      if (err.code === 'EACCES') {
        console.error(`Port ${port} requires elevated privileges`);
      } else if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use`);
      }
      process.exit(1);
    });

    // Add error handler for uncaught exceptions
    process.on('uncaughtException', async (err) => {
      console.error('Uncaught Exception:', err);
      if (jsreportInstance) {
        try {
          await jsreportInstance.close();
        } catch (closeError) {
          console.error('Error closing jsreport:', closeError);
        }
      }
      process.exit(1);
    });

    // Add error handler for unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    
    // Cleanup handlers
    const cleanup = require('./utils/cleanup');
    process.on('SIGTERM', () => cleanup.handleShutdown(jsreportInstance));
    process.on('SIGINT', () => cleanup.handleShutdown(jsreportInstance));
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

