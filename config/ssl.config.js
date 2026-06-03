const path = require('path');
const fs = require('fs');

const DEFAULT_SSL_DIR = path.join(__dirname, '..', 'ssl');
const DEFAULT_KEY = path.join(DEFAULT_SSL_DIR, 'e-invoice_tradewindscorp-insbrok_com.key');
const DEFAULT_CERT = path.join(DEFAULT_SSL_DIR, 'e-invoice_tradewindscorp-insbrok_com.crt');
const DEFAULT_CA = path.join(DEFAULT_SSL_DIR, 'DigiCertCA.crt');

function resolvePath(envPath, fallback) {
  if (!envPath) {
    return fallback;
  }

  return path.isAbsolute(envPath)
    ? envPath
    : path.resolve(__dirname, '..', envPath);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function getSslPaths() {
  return {
    keyPath: resolvePath(process.env.SSL_KEY_PATH, DEFAULT_KEY),
    certPath: resolvePath(process.env.SSL_CERT_PATH, DEFAULT_CERT),
    caPath: resolvePath(process.env.SSL_CA_PATH, DEFAULT_CA),
  };
}

function hasSslCertificates() {
  const { keyPath, certPath } = getSslPaths();
  return fileExists(keyPath) && fileExists(certPath);
}

function buildHttpsOptions() {
  const { keyPath, certPath, caPath } = getSslPaths();

  if (!hasSslCertificates()) {
    throw new Error(`SSL key/cert not found. Checked: ${keyPath}, ${certPath}`);
  }

  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  if (fileExists(caPath)) {
    options.ca = fs.readFileSync(caPath);
  }

  return options;
}

function shouldUseDirectHttps() {
  if (process.env.NODE_DIRECT_HTTPS === 'true') {
    return hasSslCertificates();
  }

  if (process.env.NODE_DIRECT_HTTPS === 'false') {
    return false;
  }

  return hasSslCertificates() && process.env.TRUST_PROXY !== 'true';
}

module.exports = {
  getSslPaths,
  hasSslCertificates,
  buildHttpsOptions,
  shouldUseDirectHttps,
};
