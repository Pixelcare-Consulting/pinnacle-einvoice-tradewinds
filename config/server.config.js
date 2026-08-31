const authConfig = require('./auth.config');

function resolveSecureCookie() {
  const setting = process.env.SECURE_COOKIE;

  if (setting === 'true') {
    return true;
  }

  if (setting === 'false') {
    return false;
  }

  if (setting === 'auto') {
    return 'auto';
  }

  if (process.env.TRUST_PROXY === 'true') {
    return 'auto';
  }

  return process.env.NODE_ENV === 'production';
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET || authConfig.session.secret,
  resave: true,
  saveUninitialized: true,
  name: 'connect.sid',
  proxy: process.env.TRUST_PROXY === 'true',
  cookie: {
    httpOnly: true,
    secure: resolveSecureCookie(),
    sameSite: 'lax',
    maxAge: parseInt(process.env.COOKIE_MAX_AGE) || authConfig.session.cookie.maxAge,
    path: '/'
  },
  rolling: true
};

function resolvePort() {
  const parsed = parseInt(process.env.PORT, 10);
  const port = Number.isFinite(parsed) ? parsed : 3000;

  // IIS/reverse-proxy setups terminate TLS on 443 and forward to Node on 3000 (see web.config).
  if (port === 443 && process.env.TRUST_PROXY === 'true') {
    console.warn(
      '[server.config] PORT=443 with TRUST_PROXY=true conflicts with IIS on 443. Using port 3000 instead.'
    );
    return 3000;
  }

  return port;
}

module.exports = {
  port: resolvePort(),
  sessionConfig
}; 