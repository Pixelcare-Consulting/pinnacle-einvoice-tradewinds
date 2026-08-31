module.exports = {
  apps: [
    {
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
      // IIS terminates TLS on 443 and reverse-proxies HTTP to Node on 3000 (see web.config.production).
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
