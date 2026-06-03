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

module.exports = {
  port: process.env.PORT || 3000,
  sessionConfig
}; 