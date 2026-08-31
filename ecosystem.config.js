module.exports = {
  apps: [
    {
      // Tradewinds default name; Willis server may use "Pinnacle x Willis eInvoice v3.3" locally.
      name: "Pinnacle x Tradewinds eInvoice v3.3",
      script: "./server.js",
      instances: 1, // Keep at 1 unless you have multi-core (avoid overhead of clustering on low RAM)
      autorestart: true, // Good — restarts on crash or stop (not on exit)
      watch: false, // Good — disabled to save CPU
      ignore_watch: [
        "node_modules",
        "public",
        "logs",
        "*.log",
        "temp",
        "*.xlsx",
        "config",
        "AuthorizeToken.ini",
      ],
      max_memory_restart: "512M", // Reduce from 1G → 512M to prevent memory bloat
      // Default profile is production. Use `pm2 start ecosystem.config.js --env development` for local PM2.
      // Default: Node serves HTTPS directly (no IIS reverse proxy).
      // Willis (willis-einvoice.ddns.net): use --env willis so Node listens HTTPS on 443
      // with Willis SSL certs — no IIS reverse proxy. Run PM2 as Administrator.
      // Legacy IIS proxy mode: use --env iis so Node listens HTTP on 3000 while IIS
      // terminates TLS on 443 and reverse-proxies via web.config.
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        SECURE_COOKIE: "true",
        TRUST_PROXY: "false",
        NODE_DIRECT_HTTPS: "true",
        UV_THREADPOOL_SIZE: 2,
        SSL_KEY_PATH: "./ssl/e-invoice_tradewindscorp-insbrok_com.key",
        SSL_CERT_PATH: "./ssl/e-invoice_tradewindscorp-insbrok_com.crt",
        SSL_CA_PATH: "./ssl/DigiCertCA.crt",
      },
      // IIS / Willis profile: HTTP on 3000, TRUST_PROXY=true, no Node SSL.
      // Requires web.config in IIS site root (copy from web.config.production).
      // .env: PORT=3000, TRUST_PROXY=true, NODE_DIRECT_HTTPS=false,
      // COOKIE_DOMAIN=willis-einvoice.ddns.net, SECURE_COOKIE=true.
      // Start: pm2 start ecosystem.config.js --env iis
      env_iis: {
        NODE_ENV: "production",
        PORT: "3000",
        SECURE_COOKIE: "true",
        TRUST_PROXY: "true",
        NODE_DIRECT_HTTPS: "false",
        UV_THREADPOOL_SIZE: 2,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: "3000",
        SECURE_COOKIE: "false",
        TRUST_PROXY: "true",
        NODE_DIRECT_HTTPS: "false",
        UV_THREADPOOL_SIZE: 2,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "3000",
        SECURE_COOKIE: "true",
        TRUST_PROXY: "false",
        NODE_DIRECT_HTTPS: "true",
        UV_THREADPOOL_SIZE: 2,
        SSL_KEY_PATH: "./ssl/e-invoice_tradewindscorp-insbrok_com.key",
        SSL_CERT_PATH: "./ssl/e-invoice_tradewindscorp-insbrok_com.crt",
        SSL_CA_PATH: "./ssl/DigiCertCA.crt",
      },
      // Willis PM2 direct HTTPS (no IIS proxy): Node serves HTTPS on 443.
      // Requires: IIS must NOT bind port 443; run PM2 from an Administrator session.
      // .env: PORT=443, NODE_DIRECT_HTTPS=true, TRUST_PROXY=false,
      // COOKIE_DOMAIN=willis-einvoice.ddns.net, SECURE_COOKIE=true, SSL_* paths below.
      // Start: pm2 start ecosystem.config.js --env willis  (NOT --env iis)
      env_willis: {
        NODE_ENV: "production",
        PORT: "443",
        SECURE_COOKIE: "true",
        TRUST_PROXY: "false",
        NODE_DIRECT_HTTPS: "true",
        UV_THREADPOOL_SIZE: 2,
        SSL_KEY_PATH: "./ssl/willis-einvoice.ddns.net.key",
        SSL_CERT_PATH: "./ssl/willis-einvoice.ddns.net.crt",
        SSL_CA_PATH: "./ssl/DigiCertCA.crt",
      },

      // === Logging: Reduce I/O impact ===
      log_file: "./logs/combined.log",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      time: true,

      // Reduce log size and retention to save disk space & I/O
      max_size: "10M", // Reduced from 100M → 10M
      rotate_interval: "7d", // Rotate weekly instead of daily (less frequent I/O)
      retain_history: 7, // Keep only 7 old logs (was 30 — too much for low disk)
      compress: true, // Compress rotated logs to save space

      // === Additional performance tweaks ===
      kill_timeout: 3000, // Faster shutdown if needed
      restart_delay: 1000, // Avoid rapid restart loops
      exp_backoff_restart_delay: 100, // Use exponential backoff for crash protection
    },
  ],

  // Optional: Add deploy section only if using PM2 deploy
  // deploy: {}
};
