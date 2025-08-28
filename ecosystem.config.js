module.exports = {
  apps: [
    {
      name: "Pinnacle x Tradewinds eInvoice v3.0",
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
      env: {
        NODE_ENV: "development",
        SECURE_COOKIE: "false",
        TRUST_PROXY: "true",
        // Optional: Reduce worker threads if using Node.js >12
        UV_THREADPOOL_SIZE: 2, // Reduce thread pool size
      },
      env_production: {
        NODE_ENV: "production",
        SECURE_COOKIE: "true",
        TRUST_PROXY: "true",
        UV_THREADPOOL_SIZE: 2,
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
