module.exports = {
  // Session settings
  session: {
    secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    timeout: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000, // 30 minutes
    cookie: {
      maxAge: parseInt(process.env.COOKIE_MAX_AGE) || 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.SECURE_COOKIE === 'true',
      httpOnly: true,
      sameSite: 'lax'
    },
    name: 'connect.sid',
    proxy: true,
    rolling: true,
    resave: true,
    saveUninitialized: true
  },

  // Login attempt settings
  login: {
    maxAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 3,
    lockoutDuration: parseInt(process.env.LOGIN_LOCKOUT_DURATION) || 5 * 60 * 1000, // 5 minutes
    cleanupInterval: parseInt(process.env.LOGIN_CLEANUP_INTERVAL) || 60 * 1000 // 1 minute
  },

  // Enhanced security settings
  security: {
    // Progressive rate limiting
    rateLimiting: {
      // Window size for rate limiting (in milliseconds)
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
      // Max requests per window per IP
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
      // Progressive penalties
      progressive: {
        enabled: true,
        // After this many failed attempts, increase penalties
        thresholds: [3, 5, 10, 20],
        // Multipliers for lockout duration at each threshold
        multipliers: [1, 2, 5, 10]
      }
    },

    // IP blacklist settings
    ipBlacklist: {
      enabled: true,
      // Auto-blacklist after this many failed attempts
      autoBlacklistThreshold: parseInt(process.env.IP_BLACKLIST_THRESHOLD) || 20,
      // How long to blacklist IPs (in milliseconds)
      blacklistDuration: parseInt(process.env.IP_BLACKLIST_DURATION) || 24 * 60 * 60 * 1000, // 24 hours
      // Cleanup interval for expired blacklist entries
      cleanupInterval: parseInt(process.env.IP_BLACKLIST_CLEANUP) || 60 * 60 * 1000 // 1 hour
    },

    // CAPTCHA settings
    captcha: {
      enabled: true,
      // Show CAPTCHA after this many failed attempts
      triggerThreshold: parseInt(process.env.CAPTCHA_THRESHOLD) || 2,
      // CAPTCHA provider (hcaptcha, recaptcha, math)
      provider: process.env.CAPTCHA_PROVIDER || 'hcaptcha',
      // hCaptcha site key (get from hCaptcha dashboard)
      siteKey: process.env.HCAPTCHA_SITE_KEY || '',
      // hCaptcha secret key (get from hCaptcha dashboard)
      secretKey: process.env.HCAPTCHA_SECRET_KEY || '',
      // Fallback to math challenges if hCaptcha not configured
      fallbackToMath: true
    },

    // Suspicious activity detection
    suspiciousActivity: {
      enabled: true,
      // Flag as suspicious if more than X attempts from same IP in Y minutes
      ipThreshold: 50,
      timeWindow: 10 * 60 * 1000, // 10 minutes
      // Flag as suspicious if more than X different usernames from same IP
      usernameVariationThreshold: 10
    }
  },

  // Passport settings
  passport: {
    usernameField: 'username',
    passwordField: 'password',
    sessionFields: [
      'ID', 'Username', 'Email', 'Admin', 'ValidStatus',
      'LastLoginTime', 'TIN', 'IDType', 'IDValue', 'FullName',
    ]
  },

  // Public paths that don't require authentication
  publicPaths: [
    '/auth/login',
    '/auth/register',
    '/auth/logout',
    '/api/user/auth/logout',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/logout',
    '/assets',
    '/favicon.ico',
    '/public',
    '/uploads',
    '/vendor',
    '/api/health'
  ]
};