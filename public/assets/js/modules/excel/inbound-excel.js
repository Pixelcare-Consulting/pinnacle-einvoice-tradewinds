// @ts-nocheck
// Toast Manager Class

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing managers...");
  try {
    // Initialize invoice table using singleton
    const invoiceManager = InvoiceTableManager.getInstance();

    // Initialize date/time display
    DateTimeManager.updateDateTime();

    console.log("Managers initialized successfully");
  } catch (error) {
    console.error("Error initializing managers:", error);
    Swal.fire({
      icon: "error",
      title: "Initialization Error",
      text: "Failed to initialize the application. Please refresh the page.",
      confirmButtonText: "Refresh",
      showCancelButton: true,
    }).then((result) => {
      if (result.isConfirmed) {
        window.location.reload();
      }
    });
  }
});

class ToastManager {
  static container = null;
  static activeCountdowns = new Map();

  static init() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className =
        "toast-container position-fixed top-0 end-0 p-3";
      this.container.style.zIndex = "1070";
      document.body.appendChild(this.container);
    }
  }

  static show(message, type = "success", duration = 3000, countdown = null) {
    this.init();

    const toastId = `toast-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const toastElement = document.createElement("div");
    toastElement.id = toastId;

    // Enhanced styling based on type
    let bgClass, iconClass, textClass;
    switch (type) {
      case "success":
        bgClass = "bg-success";
        iconClass = "bi-check-circle";
        textClass = "text-white";
        break;
      case "error":
        bgClass = "bg-danger";
        iconClass = "bi-x-circle";
        textClass = "text-white";
        break;
      case "warning":
        bgClass = "bg-warning";
        iconClass = "bi-exclamation-triangle";
        textClass = "text-dark";
        break;
      case "info":
        bgClass = "bg-info";
        iconClass = "bi-info-circle";
        textClass = "text-white";
        break;
      default:
        bgClass = "bg-primary";
        iconClass = "bi-info-circle";
        textClass = "text-white";
    }

    toastElement.className = `toast align-items-center border-0 ${bgClass} ${textClass}`;
    toastElement.setAttribute("role", "alert");
    toastElement.setAttribute("aria-live", "assertive");
    toastElement.setAttribute("aria-atomic", "true");
    toastElement.style.minWidth = "320px";

    const countdownHtml = countdown
      ? `
      <div class="mt-2 small">
        <i class="bi bi-clock me-1"></i>
        <span id="countdown-${toastId}">Retry in ${countdown}s</span>
      </div>
    `
      : "";

    const toastContent = `
            <div class="d-flex">
                <div class="toast-body">
                    <div class="d-flex align-items-start">
                        <i class="bi ${iconClass} me-2 mt-1" style="font-size: 1.1rem;"></i>
                        <div class="flex-grow-1">
                            <div class="fw-medium">${
                              type.charAt(0).toUpperCase() + type.slice(1)
                            }</div>
                            <div class="small mt-1">${message}</div>
                            ${countdownHtml}
                        </div>
                    </div>
                </div>
                <button type="button" class="btn-close ${
                  textClass === "text-dark" ? "" : "btn-close-white"
                } me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
    toastElement.innerHTML = toastContent;

    this.container.appendChild(toastElement);

    // Handle countdown if provided
    if (countdown && countdown > 0) {
      this.startCountdown(toastId, countdown);
    }

    const toast = new bootstrap.Toast(toastElement, {
      animation: true,
      autohide: !countdown, // Don't auto-hide if countdown is active
      delay: countdown ? countdown * 1000 + 1000 : duration,
    });

    toast.show();

    // Remove the element after it's hidden
    toastElement.addEventListener("hidden.bs.toast", () => {
      this.clearCountdown(toastId);
      toastElement.remove();
    });

    return toastId;
  }

  static startCountdown(toastId, seconds) {
    const countdownElement = document.getElementById(`countdown-${toastId}`);
    if (!countdownElement) return;

    let remaining = seconds;
    const interval = setInterval(() => {
      remaining--;
      if (countdownElement) {
        countdownElement.textContent = `Retry in ${remaining}s`;
      }

      if (remaining <= 0) {
        clearInterval(interval);
        this.clearCountdown(toastId);
        // Auto-hide the toast when countdown reaches 0
        const toastElement = document.getElementById(toastId);
        if (toastElement) {
          const toast = bootstrap.Toast.getInstance(toastElement);
          if (toast) toast.hide();
        }
      }
    }, 1000);

    this.activeCountdowns.set(toastId, interval);
  }

  static clearCountdown(toastId) {
    const interval = this.activeCountdowns.get(toastId);
    if (interval) {
      clearInterval(interval);
      this.activeCountdowns.delete(toastId);
    }
  }

  static showRateLimit(message, retryAfterSeconds) {
    return this.show(
      `${message} Please wait before trying again.`,
      "warning",
      (retryAfterSeconds + 2) * 1000,
      retryAfterSeconds
    );
  }
}

// DateTime Manager Class
class DateTimeManager {
  static updateDateTime() {
    const timeElement = document.getElementById("currentTime");
    const dateElement = document.getElementById("currentDate");

    function update() {
      const now = new Date();

      // Update time
      if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });
      }

      // Update date
      if (dateElement) {
        dateElement.textContent = now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
    }

    // Update immediately and then every second
    update();
    setInterval(update, 1000);
  }
}

// Enhanced Rate Limiter for LHDN API compliance
class RateLimiter {
  constructor() {
    // LHDN API rate limits per minute
    this.limits = {
      getDocument: { rpm: 60, minInterval: 1000 }, // 60 RPM = 1 per second
      getDocumentDetails: { rpm: 125, minInterval: 480 }, // 125 RPM = ~480ms
      getSubmission: { rpm: 300, minInterval: 200 }, // 300 RPM = ~200ms
      searchDocuments: { rpm: 12, minInterval: 5000 }, // 12 RPM = 5 seconds
      getRecentDocuments: { rpm: 12, minInterval: 5000 }, // 12 RPM = 5 seconds
      cancelDocument: { rpm: 12, minInterval: 5000 }, // 12 RPM = 5 seconds
      rejectDocument: { rpm: 12, minInterval: 5000 }, // 12 RPM = 5 seconds
      taxpayerQR: { rpm: 60, minInterval: 1000 }, // 60 RPM = 1 per second
      searchTIN: { rpm: 60, minInterval: 1000 }, // 60 RPM = 1 per second
      login: { rpm: 12, minInterval: 5000 }, // 12 RPM = 5 seconds
    };

    this.lastCallTimes = new Map();
    this.requestCounts = new Map();
    this.windowStart = new Map();
  }

  async waitForSlot(endpoint) {
    const config = this.limits[endpoint];
    if (!config) {
      console.warn(`No rate limit config for endpoint: ${endpoint}`);
      return;
    }

    const now = Date.now();
    const lastCall = this.lastCallTimes.get(endpoint) || 0;
    const timeSinceLastCall = now - lastCall;

    // Ensure minimum interval between calls
    if (timeSinceLastCall < config.minInterval) {
      const waitTime = config.minInterval - timeSinceLastCall;
      console.log(`[RateLimit] Waiting ${waitTime}ms for ${endpoint}`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    // Update tracking
    this.lastCallTimes.set(endpoint, Date.now());

    // Track requests per minute
    const windowKey = Math.floor(Date.now() / 60000); // 1-minute windows
    const currentWindow = this.windowStart.get(endpoint);

    if (currentWindow !== windowKey) {
      this.requestCounts.set(endpoint, 0);
      this.windowStart.set(endpoint, windowKey);
    }

    const currentCount = this.requestCounts.get(endpoint) || 0;
    this.requestCounts.set(endpoint, currentCount + 1);

    // Log rate limit status
    console.log(
      `[RateLimit] ${endpoint}: ${currentCount + 1}/${
        config.rpm
      } requests this minute`
    );
  }

  getRemainingRequests(endpoint) {
    const config = this.limits[endpoint];
    if (!config) return null;

    const currentCount = this.requestCounts.get(endpoint) || 0;
    return Math.max(0, config.rpm - currentCount);
  }

  getNextAvailableTime(endpoint) {
    const lastCall = this.lastCallTimes.get(endpoint) || 0;
    const config = this.limits[endpoint];
    if (!config) return 0;

    return Math.max(0, lastCall + config.minInterval - Date.now());
  }
}

// Request Queue for managing concurrent requests
class RequestQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async add(requestFn, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn: requestFn,
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
      });

      // Sort by priority (higher first), then by timestamp (older first)
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.timestamp - b.timestamp;
      });

      this.processNext();
    });
  }

  async processNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    this.running++;

    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  getQueueStatus() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

// Create a class for managing inbound invoices
class InvoiceTableManager {
  static instance = null;

  static getInstance() {
    if (!InvoiceTableManager.instance) {
      InvoiceTableManager.instance = new InvoiceTableManager();
    }
    return InvoiceTableManager.instance;
  }

  constructor() {
    if (InvoiceTableManager.instance) {
      return InvoiceTableManager.instance;
    }
    this.currentDataSource = "archive"; // Start with archive data to avoid rate limiting
    this.table = null;
    this.isRefreshing = false; // Add refresh state tracking
    this.lastRefreshTime = 0; // Track last refresh time for rate limiting
    this.refreshCooldown = 5000; // 5 second cooldown between refreshes

    // Enhanced rate limiting for LHDN API calls
    this.rateLimiter = new RateLimiter();
    this.requestQueue = new RequestQueue();
    this.loadingStates = new Map(); // Track loading states for different operations

    this.initializeTable();
    this.initializeDataSourceToggle();

    // Start rate limit monitoring after initialization
    setTimeout(() => {
      this.startRateLimitMonitoring();
    }, 1000);

    InvoiceTableManager.instance = this;
  }

  // Create enhanced loading skeleton
  createLoadingSkeleton(message = "Loading data...", detail = "") {
    return `
      <div class="loading-overlay">
        <style>
          .loading-skeleton {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: loading-shimmer 1.5s infinite;
          }

          @keyframes loading-shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }

          .loading-pulse {
            animation: loading-pulse 2s infinite;
          }

          @keyframes loading-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(2px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            min-height: 400px;
          }

          .loading-content {
            text-align: center;
            max-width: 400px;
            padding: 2rem;
          }

          .loading-icon {
            width: 60px;
            height: 60px;
            border: 4px solid #e3f2fd;
            border-top: 4px solid #1976d2;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1.5rem;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .table-skeleton {
            width: 100%;
            margin-top: 2rem;
          }

          .skeleton-row {
            display: flex;
            gap: 1rem;
            margin-bottom: 0.75rem;
            align-items: center;
          }

          .skeleton-cell {
            height: 20px;
            border-radius: 4px;
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: loading-shimmer 1.5s infinite;
          }

          .skeleton-cell.small { flex: 0 0 60px; }
          .skeleton-cell.medium { flex: 0 0 120px; }
          .skeleton-cell.large { flex: 1; }
          .skeleton-cell.status { flex: 0 0 80px; height: 24px; border-radius: 12px; }

          .btn-loading {
            position: relative;
            pointer-events: none;
            opacity: 0.8;
          }

          .btn-loading::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 16px;
            height: 16px;
            margin: -8px 0 0 -8px;
            border: 2px solid transparent;
            border-top: 2px solid currentColor;
            border-radius: 50%;
            animation: btn-spin 1s linear infinite;
            z-index: 1;
          }

          .btn-loading .bi {
            opacity: 0;
          }

          @keyframes btn-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .refresh-enhanced {
            transition: all 0.2s ease;
            position: relative;
            overflow: hidden;
          }

          .refresh-enhanced:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          }

          .refresh-enhanced.processing {
            background: linear-gradient(45deg, #007bff, #0056b3);
            color: white;
          }

          .refresh-enhanced.success {
            background: linear-gradient(45deg, #28a745, #1e7e34);
            color: white;
          }

          .refresh-enhanced.error {
            background: linear-gradient(45deg, #dc3545, #c82333);
            color: white;
          }
        </style>

        <div class="loading-content">
          <div class="loading-icon"></div>

          <h5 class="mb-2 text-primary fw-semibold" id="loadingMessage">${message}</h5>
          <p class="text-muted small mb-3" id="loadingDetail">${detail}</p>

          <div class="d-flex align-items-center justify-content-center mb-3">
            <div class="spinner-grow spinner-grow-sm text-primary me-2" role="status"></div>
            <div class="spinner-grow spinner-grow-sm text-primary me-2" role="status" style="animation-delay: 0.2s;"></div>
            <div class="spinner-grow spinner-grow-sm text-primary" role="status" style="animation-delay: 0.4s;"></div>
          </div>

          <div class="table-skeleton">
            <div class="skeleton-row">
              <div class="skeleton-cell small"></div>
              <div class="skeleton-cell medium"></div>
              <div class="skeleton-cell large"></div>
              <div class="skeleton-cell medium"></div>
              <div class="skeleton-cell status"></div>
            </div>
            <div class="skeleton-row">
              <div class="skeleton-cell small"></div>
              <div class="skeleton-cell medium"></div>
              <div class="skeleton-cell large"></div>
              <div class="skeleton-cell medium"></div>
              <div class="skeleton-cell status"></div>
            </div>
            <div class="skeleton-row">
              <div class="skeleton-cell small"></div>
              <div class="skeleton-cell medium"></div>
              <div class="skeleton-cell large"></div>
              <div class="skeleton-cell medium"></div>
              <div class="skeleton-cell status"></div>
            </div>
          </div>

          <div class="mt-3">
            <small class="text-muted loading-pulse">
              <i class="bi bi-shield-check me-1"></i>
              Ensuring LHDN API compliance...
            </small>
          </div>
        </div>
      </div>
    `;
  }

  initializeTable() {
    if ($.fn.DataTable.isDataTable("#invoiceTable")) {
      this.table.destroy();
    }
    const self = this;

    // Show enhanced loading skeleton
    $("#invoiceTable").closest(".card").addClass("loading");
    $("#invoiceTable")
      .closest(".card")
      .append(
        this.createLoadingSkeleton(
          "Initializing and checking authentication..."
        )
      );

    // Update loading message
    const updateLoadingMessage = (message, detail = "") => {
      $("#loadingMessage").text(message);
      if (detail) {
        $("#loadingDetail").text(detail);
      }
    };

    // Check authentication status first with timeout
    const checkAuth = async () => {
      try {
        updateLoadingMessage("Checking authentication status...");

        // Set a timeout for auth check to prevent hanging
        const authCheckPromise = window.waitForAuth
          ? window.waitForAuth()
          : Promise.resolve();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Authentication check timed out")),
            10000
          )
        );

        try {
          await Promise.race([authCheckPromise, timeoutPromise]);
          updateLoadingMessage(
            "Authentication verified, loading data...",
            "Connecting to server"
          );
        } catch (authError) {
          console.warn("Auth check issue, proceeding anyway:", authError);
          updateLoadingMessage(
            "Proceeding with data load...",
            "Authentication status uncertain"
          );
        }

        // Initialize the table with retry logic
        this.initializeTableWithRetry();
      } catch (error) {
        console.error("Error in authentication check:", error);
        updateLoadingMessage(
          "Authentication check failed, attempting to load data anyway..."
        );
        this.initializeTableWithRetry();
      }
    };

    // Call the authentication check
    checkAuth();
  }

  // Initialize data source toggle functionality
  initializeDataSourceToggle() {
    const self = this;

    // Handle data source toggle
    $('input[name="dataSource"]').on("change", function () {
      const selectedSource = $(this).attr("id");
      if (selectedSource === "liveDataSource") {
        self.switchToLiveData();
      } else if (selectedSource === "archiveDataSource") {
        self.switchToArchiveData();
      }
    });

    // Handle refresh button with spam protection
    $("#refreshDataSource").on("click", async function () {
      const button = $(this);

      // Prevent spam clicking
      if (self.isRefreshing || button.prop("disabled")) {
        console.log("Refresh already in progress or button disabled");
        return;
      }

      // Disable button and show loading state
      button.prop("disabled", true);
      const originalHtml = button.html();
      button.html(
        '<i class="bi bi-arrow-clockwise me-1 spin"></i>Refreshing...'
      );

      try {
        await self.refreshCurrentDataSource();

        // Show success feedback
        ToastManager.show("Data refreshed successfully", "success");
      } catch (error) {
        console.error("Error refreshing data:", error);
        ToastManager.show("Failed to refresh data. Please try again.", "error");
      } finally {
        // Re-enable button and restore original text
        setTimeout(() => {
          button.prop("disabled", false);
          button.html(originalHtml);
        }, 1000); // 1 second delay to prevent rapid clicking
      }
    });
  }

  // Switch to live LHDN data with enhanced rate limiting
  async switchToLiveData() {
    try {
      this.currentDataSource = "live";

      // Check rate limits before switching
      const remainingRequests =
        this.rateLimiter.getRemainingRequests("getRecentDocuments");
      const nextAvailable =
        this.rateLimiter.getNextAvailableTime("getRecentDocuments");

      if (remainingRequests === 0 || nextAvailable > 0) {
        const waitTime = Math.max(nextAvailable, 5000); // Minimum 5 second wait
        this.showLoadingBackdrop(
          `Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // Show loading state with rate limit info
      this.showLoadingBackdrop(
        "Loading Live LHDN Data",
        `${remainingRequests || 0} requests remaining this minute`
      );

      // Wait for rate limit slot
      await this.rateLimiter.waitForSlot("getRecentDocuments");

      // Queue the request to manage concurrency
      await this.requestQueue.add(async () => {
        // Update the table's AJAX URL to live endpoint
        if (this.table) {
          this.table.ajax.url("/api/lhdn/documents/recent").load(() => {
            this.hideLoadingBackdrop();
            this.updateCardTotals();
          });
        } else {
          // If table doesn't exist, initialize it
          await this.initializeTableWithData();
          this.hideLoadingBackdrop();
        }
      }, 2); // Medium priority
    } catch (error) {
      console.error("Error switching to live data:", error);
      this.hideLoadingBackdrop();

      // Enhanced error handling for rate limits
      if (
        error.message.includes("429") ||
        error.message.includes("rate limit")
      ) {
        this.showErrorMessage(
          "LHDN server is busy. Please wait a moment and try again.",
          "warning"
        );
      } else {
        this.showErrorMessage("Failed to load live data: " + error.message);
      }
    }
  }

  // Switch to archive staging data
  async switchToArchiveData() {
    try {
      this.currentDataSource = "archive";

      // Show loading state
      this.showLoadingBackdrop("Loading Archive Staging Data");

      // Fetch archive data from WP_INBOUND_STATUS table
      const response = await fetch("/api/lhdn/documents/archive-staging");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load archive staging data");
      }

      // Update table with archive data
      if (this.table) {
        this.table
          .clear()
          .rows.add(data.result || [])
          .draw();
      } else {
        // Initialize table with archive data
        this.initializeTableWithLocalData(data.result || []);
      }

      this.hideLoadingBackdrop();
      this.updateCardTotals();
    } catch (error) {
      console.error("Error switching to archive data:", error);
      this.hideLoadingBackdrop();
      this.showErrorMessage(
        "Failed to load archive staging data: " + error.message
      );
    }
  }

  // Refresh current data source with enhanced throttling
  async refreshCurrentDataSource() {
    // Prevent concurrent refreshes
    if (this.isRefreshing) {
      console.log("Refresh already in progress, ignoring request");
      return;
    }

    // Check cooldown period
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastRefreshTime;
    if (timeSinceLastRefresh < this.refreshCooldown) {
      const remainingTime = Math.ceil(
        (this.refreshCooldown - timeSinceLastRefresh) / 1000
      );
      ToastManager.show(
        `Please wait ${remainingTime} more seconds before refreshing again.`,
        "info"
      );
      return;
    }

    this.isRefreshing = true;
    this.lastRefreshTime = now;

    try {
      if (this.currentDataSource === "live") {
        // Check LHDN rate limits before refreshing
        const endpoint = "getRecentDocuments";
        const remainingRequests =
          this.rateLimiter.getRemainingRequests(endpoint);
        const nextAvailable = this.rateLimiter.getNextAvailableTime(endpoint);

        if (remainingRequests === 0 || nextAvailable > 0) {
          const waitTime = Math.max(nextAvailable, 1000);
          ToastManager.show(
            `Rate limit reached. Waiting ${Math.ceil(
              waitTime / 1000
            )} seconds...`,
            "warning"
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        // Force refresh live data with rate limiting
        window.forceRefreshLHDN = true;
        await this.switchToLiveData();
      } else {
        // Refresh archive data (no rate limiting needed)
        await this.switchToArchiveData();
      }

      // Update last refresh time on success
      this.lastRefreshTime = Date.now();
    } catch (error) {
      console.error("Error refreshing data source:", error);

      // Handle specific error types
      if (
        error.message.includes("429") ||
        error.message.includes("rate limit")
      ) {
        ToastManager.show(
          "LHDN server is busy. Please try again in a few minutes.",
          "warning"
        );
      } else {
        ToastManager.show(
          "Failed to refresh data. Please try again later.",
          "error"
        );
      }

      throw error; // Re-throw for caller handling
    } finally {
      this.isRefreshing = false;
    }
  }

  // New method with retry logic
  async initializeTableWithRetry(retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 3000; // 3 seconds

    try {
      // Update loading message
      $("#loadingMessage").text(
        `Loading invoice data... (Attempt ${retryCount + 1}/${maxRetries + 1})`
      );

      // Initialize the table
      await this.initializeTableWithData();
    } catch (error) {
      console.error(
        `Error initializing table (attempt ${retryCount + 1}):`,
        error
      );

      if (retryCount < maxRetries) {
        // Show retry message
        $("#loadingMessage").text(
          `Connection issue, retrying in ${retryDelay / 1000} seconds...`
        );
        $("#loadingDetail").text(
          `Attempt ${retryCount + 1} of ${maxRetries + 1}`
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        // Retry with incremented count
        return this.initializeTableWithRetry(retryCount + 1);
      } else {
        // All retries failed, show neutral message and try to load from database only
        console.error("All retries failed, attempting database-only fallback");
        $("#loadingMessage").text("Loading invoice data from system...");

        try {
          await this.loadFromDatabaseOnly();
        } catch (fallbackError) {
          console.error("Database fallback also failed:", fallbackError);
          // Show a more neutral message
          Swal.fire({
            icon: "info",
            title: "Loading Invoice Data",
            text: "We're having trouble loading your invoice data. Would you like to try again?",
            confirmButtonText: "Retry",
            showCancelButton: true,
          }).then((result) => {
            if (result.isConfirmed) {
              // Remove loading overlay first
              $("#invoiceTable").closest(".card").removeClass("loading");
              $("#invoiceTable")
                .closest(".card")
                .find(".loading-overlay")
                .remove();
              // Retry from the beginning
              this.initializeTable();
            }
          });
        }
      }
    }
  }

  // New method to load from database only as last resort
  async loadFromDatabaseOnly() {
    try {
      // Remove existing loading indicator
      $("#invoiceTable").closest(".card").removeClass("loading");
      $("#invoiceTable").closest(".card").find(".loading-overlay").remove();

      // Show loading indicator with neutral message
      $("#invoiceTable").closest(".card").addClass("loading");
      $("#invoiceTable")
        .closest(".card")
        .append(
          '<div class="loading-overlay"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><div class="mt-2">Loading invoice data...</div></div>'
        );

      // Fetch data from database endpoint
      const response = await fetch(
        "/api/lhdn/documents/recent?useDatabase=true&fallbackOnly=true"
      );

      if (!response.ok) {
        throw new Error(
          `Database fetch failed with status: ${response.status}`
        );
      }

      const data = await response.json();

      if (!data || !data.result || data.result.length === 0) {
        throw new Error("No data available in database");
      }

      // Remove loading indicator
      $("#invoiceTable").closest(".card").removeClass("loading");
      $("#invoiceTable").closest(".card").find(".loading-overlay").remove();

      // Initialize table with the database data
      this.initializeTableWithLocalData(data.result);

      // Don't show any warning toast to users
      // Just log to console for debugging purposes
      console.log(
        "Using data from local database. LHDN API connection may be unavailable."
      );

      return true;
    } catch (error) {
      console.error("Database-only load failed:", error);
      throw error;
    }
  }

  // Initialize table with local data
  initializeTableWithLocalData(localData) {
    // Similar to initializeTableWithData but uses provided data instead of AJAX
    const self = this;

    // Remove loading indicator
    $("#invoiceTable").closest(".card").removeClass("loading");
    $("#invoiceTable").closest(".card").find(".loading-overlay").remove();

    this.table = $("#invoiceTable").DataTable({
      // Same configuration as in initializeTableWithData but without AJAX
      processing: false,
      serverSide: false,
      data: localData, // Use local data instead of AJAX
      columns: [
        // Same columns configuration as in initializeTableWithData
        {
          data: null,
          orderable: false,
          defaultContent: `
                        <div class="outbound-checkbox-header">
                            <input type="checkbox" class="outbound-checkbox row-checkbox">
                        </div>`,
        },
        {
          data: null,
          orderable: false,
          searchable: false,
          className: "text-center",
          render: function (data, type, row, meta) {
            // Calculate the correct index based on the current page and page length
            const pageInfo = meta.settings._iDisplayStart;
            const index = pageInfo + meta.row + 1;
            return `<span class="row-index">${index}</span>`;
          },
        },
        {
          data: "uuid",
          render: function (data) {
            return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis  flex items-center gap-2">
                                    <a href="#" class="inbound-badge-status copy-uuid"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data}"
                                       data-uuid="${data}"
                                         style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(13, 110, 253, 0.08);
                                            color: #0d6efd;
                                            border: 1px solid rgba(13, 110, 253, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-fingerprint" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 80px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
          },
        },
        {
          data: "longId",
          render: function (data) {
            return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis flex gap-2">
                                    <a href="#"
                                       class="inbound-badge-status copy-longId"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data || "N/A"}"
                                       data-longId="${data || ""}"
                                       style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(25, 135, 84, 0.08);
                                            color: #198754;
                                            border: 1px solid rgba(25, 135, 84, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-hash" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 160px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data || "N/A"}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
          },
        },
        {
          data: "internalId",
          title: "INTERNAL ID",
          className: "text-nowrap",
          render: (data, type, row) =>
            this.renderInvoiceNumber(data, type, row),
        },
        {
          data: "issuerName",
          title: "SUPPLIER",
          render: (data, type, row) => {
            // Use issuerName or supplierName for supplier info
            const supplierName =
              row.issuerName ||
              row.supplierName ||
              row.supplierCompany ||
              row.supplier ||
              "Unknown";
            return this.renderCompanyInfo(supplierName, type, row);
          },
        },
        {
          data: "receiverName",
          title: "RECEIVER",
          render: (data, type, row) => this.renderCompanyInfo(data, type, row),
        },
        {
          data: null,
          className: "text-nowrap",
          title: "DATE INFO",
          render: (data, type, row) =>
            this.renderDateInfo(row.dateTimeValidated, row),
        },
        {
          data: "status",
          title: "STATUS",
          render: function (data) {
            const statusClass = data.toLowerCase();

            const icons = {
              valid: "check-circle-fill",
              invalid: "x-circle-fill",
              pending: "hourglass-split",
              submitted: "hourglass-split",
              queued: "hourglass-split",
              rejected: "x-circle-fill",
              cancelled: "x-circle-fill",
            };
            const statusColors = {
              valid: "#198754",
              invalid: "#dc3545",
              pending: "#ff8307",
              submitted: "gray",
              queued: "#0d6efd",
              rejected: "#dc3545",
              cancelled: "#ffc107",
            };
            const icon = icons[statusClass] || "question-circle";
            const color = statusColors[statusClass];

            if (statusClass === "submitted" || statusClass === "pending") {
              return `<span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>Queued
                            </span>`;
            }
            // Add tooltip with cancellation reason if cancelled
            const titleAttr =
              statusClass === "cancelled" && row.documentStatusReason
                ? `title="${row.documentStatusReason}" data-bs-toggle="tooltip"`
                : "";
            return `
                            <span class="inbound-status ${statusClass}"
                                  ${titleAttr}
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>${data}
                            </span>`;
          },
        },
        // {
        //     data: 'source',
        //     title: 'SOURCE',
        //     render: function (data) {
        //         return this.renderSource(data);
        //     }.bind(this)
        // },
        {
          data: "totalSales",
          title: "TOTAL SALES",
          render: (data, type, row) => {
            if (data === undefined || data === null || data === "")
              return '<span class="text-muted">N/A</span>';
            const code =
              row.documentCurrency ||
              row.currency ||
              row.currencyCode ||
              row.documentCurrencyCode ||
              (row.header &&
                (row.header.documentCurrencyCode || row.header.currency)) ||
              "MYR";
            const formatted = parseFloat(data || 0).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            return `
                            <div class="total-amount-wrapper" style="
                                display: flex;
                                align-items: center;
                                justify-content: flex-end;
                            ">
                                <span class="total-amount" style="
                                    font-weight: 500;
                                    color: #1e40af;
                                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                    background: rgba(30, 64, 175, 0.1);
                                    padding: 4px 8px;
                                    border-radius: 4px;
                                    display: inline-block;
                                    letter-spacing: 0.5px;
                                    white-space: nowrap;
                                    transition: all 0.2s ease;
                                ">
                                    ${code} ${formatted}
                                </span>
                            </div>
                        `;
          },
        },
        {
          data: null,
          orderable: false,
          render: function (row) {
            const isValid = row.status === "Valid";
            let eligible = false;
            if (isValid && row.dateTimeValidated) {
              const deadline = new Date(
                new Date(row.dateTimeValidated).getTime() + 72 * 60 * 60 * 1000
              );
              eligible = Date.now() < deadline.getTime();
            }
            const cancelBtn = isValid
              ? eligible
                ? `<button class="outbound-action-btn cancel btn-cancel-inbound"
                                           onclick="cancelInboundDocument('${row.uuid}')"
                                           data-uuid="${row.uuid}" title="Cancel Document">
                                        <i class="bi bi-x-circle me-1"></i>Cancel
                                   </button>`
                : `<button class="outbound-action-btn cancel btn-cancel-inbound" data-uuid="${row.uuid}"
                                           style="opacity:0.5;cursor:not-allowed;"
                                           title="Cancellation window expired">
                                        <i class="bi bi-x-circle me-1"></i>Cancel
                                   </button>`
              : "";

            return `
                            <div class="d-flex gap-2">
                                <button class="outbound-action-btn submit"
                                        onclick="viewInvoiceDetails('${row.uuid}')"
                                        data-uuid="${row.uuid}">
                                    <i class="bi bi-eye me-1"></i>View
                                </button>
                                ${cancelBtn}
                            </div>`;
          },
        },
      ],
      scrollX: true,
      scrollCollapse: true,
      autoWidth: false,
      pageLength: 10,
      order: [[6, "desc"]], // The 6 should be the index of your date column
      columnDefs: [
        {
          targets: 6, // The DATE INFO column index
          type: "date",
        },
      ],
      dom: '<"outbound-controls"<"outbound-length-control"l>>rt<"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
      language: {
        //search: '',
        //searchPlaceholder: 'Search in records...',
        lengthMenu: '<i class="bi bi-list"></i> _MENU_',
        info: "Showing _START_ to _END_ of _TOTAL_ entries",
        infoEmpty: "No records available",
        infoFiltered: "(filtered from _MAX_ total records)",
        paginate: {
          first: '<i class="bi bi-chevron-double-left"></i>',
          previous: '<i class="bi bi-chevron-left"></i>',
          next: '<i class="bi bi-chevron-right"></i>',
          last: '<i class="bi bi-chevron-double-right"></i>',
        },
        select: {
          rows: {
            _: "Selected %d rows",
            0: "Click a row to select it",
            1: "Selected 1 row",
          },
        },
      },
      drawCallback: function (settings) {
        if (settings._iDisplayLength !== undefined) {
          self.updateCardTotals();
          updateCharts(); // Update charts when table is redrawn
        }

        // Update row indexes
        const table = $(this).DataTable();
        $(table.table().node())
          .find("tbody tr")
          .each(function (index) {
            const pageInfo = settings._iDisplayStart;
            $(this)
              .find(".row-index")
              .text(pageInfo + index + 1);
          });
      },
      initComplete: function () {
        self.updateCardTotals();
        self.initializeFilters();
        updateCharts(); // Update charts when table is first initialized
      },
    });

    window.inboundDataTable = this.table;

    this.initializeTableStyles();
    this.initializeEventListeners();
    this.initializeSelectAll();
    this.addExportButton();
    this.initializeTooltipsAndCopy();

    // Add refresh button with enhanced styling and responsiveness
    const refreshButton = $(`
            <button id="refreshLHDNData" class="btn btn-primary btn-sm ms-2 refresh-enhanced"
                    data-bs-toggle="tooltip"
                    data-bs-placement="top"
                    title="Refresh data from LHDN server">
                <i class="bi bi-arrow-clockwise me-1"></i>
                <span class="btn-text">Refresh LHDN Data</span>
                <small class="text-light ms-1 refresh-timer" style="display: none;"></small>
            </button>
        `);

    $(".dataTables_length").append(refreshButton);
    refreshButton.tooltip(); // Initialize tooltip for the refresh button

    // Handle refresh button click with enhanced responsiveness
    $("#refreshLHDNData")
      .off("click")
      .on("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const button = $("#refreshLHDNData");

        // Immediate visual feedback
        button.addClass("btn-loading");

        // Prevent spam clicking - check both isRefreshing flag and button state
        if (this.isRefreshing || button.prop("disabled")) {
          console.log("Refresh already in progress, ignoring click");
          button.removeClass("btn-loading");
          return;
        }

        // Rate limiting - prevent too frequent refreshes
        const now = Date.now();
        const timeSinceLastRefresh = now - this.lastRefreshTime;
        if (timeSinceLastRefresh < this.refreshCooldown) {
          const remainingTime = Math.ceil(
            (this.refreshCooldown - timeSinceLastRefresh) / 1000
          );
          button.removeClass("btn-loading");
          this.showRefreshCooldown(remainingTime);
          ToastManager.showRateLimit(
            "Too many refresh requests",
            remainingTime
          );
          return;
        }

        this.isRefreshing = true;
        this.lastRefreshTime = now; // Update last refresh time

        // Enhanced button state management
        button.prop("disabled", true);
        button.addClass("processing btn-loading");
        button.find(".btn-text").text("Processing...");

        let loadingModal, progressBar, statusText, detailsText, backdrop;
        try {
          // For local data tables (archive), just refresh the current data source
          if (this.currentDataSource === "archive") {
            button.find(".btn-text").text("Refreshing Archive...");

            await this.refreshCurrentDataSource();

            // Success state
            button.removeClass("processing").addClass("success");
            button.find(".btn-text").text("Success!");

            // Restore button after delay
            setTimeout(() => {
              button.removeClass("success btn-loading");
              button.find(".btn-text").text("Refresh LHDN Data");
              button.prop("disabled", false);
            }, 2000);

            ToastManager.show("Archive data refreshed successfully", "success");
            return;
          }

          // For live data, use the full refresh process
          loadingModal = document.getElementById("loadingModal");
          progressBar = document.querySelector("#loadingModal .progress-bar");
          statusText = document.getElementById("loadingStatus");
          detailsText = document.getElementById("loadingDetails");

          if (this.checkDataFreshness() && !window.forceRefreshLHDN) {
            const result = await Swal.fire({
              title: "Data is up to date",
              text: "The data was updated less than 15 minutes ago. Do you still want to refresh?",
              icon: "info",
              showCancelButton: true,
              confirmButtonText: "Yes, refresh anyway",
              cancelButtonText: "No, keep current data",
              confirmButtonColor: "#1e40af",
              cancelButtonColor: "#dc3545",
            });

            if (!result.isConfirmed) {
              return;
            }
          }

          // Enhanced button loading state
          button.addClass("loading");
          button.html(
            '<i class="bi bi-arrow-clockwise me-1 spin"></i>Connecting...'
          );

          loadingModal.classList.add("show");
          loadingModal.style.display = "block";
          document.body.classList.add("modal-open");

          backdrop = document.createElement("div");
          backdrop.className = "modal-backdrop fade show";
          document.body.appendChild(backdrop);

          progressBar.style.width = "10%";
          statusText.textContent = "Connecting to LHDN server...";
          detailsText.textContent = "Please wait while we establish connection";

          // Call the new refresh endpoint
          const response = await fetch("/api/lhdn/documents/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || "Failed to refresh data");
          }

          progressBar.style.width = "50%";
          statusText.textContent = "Refreshing data...";
          detailsText.textContent = "Fetching latest documents from LHDN";
          button.html(
            '<i class="bi bi-arrow-clockwise me-1 spin"></i>Refreshing...'
          );

          // Force a fresh fetch from the API
          window.forceRefreshLHDN = true;

          // Clear the cache timestamp to force a fresh fetch
          localStorage.removeItem("lastDataUpdate");

          // Reload the table data - this won't work for local data tables
          // So we need to refresh the current data source instead
          await this.refreshCurrentDataSource();

          progressBar.style.width = "100%";
          statusText.textContent = "Success! Your data is now up to date.";
          detailsText.textContent = "Data refresh completed successfully";
          button.html('<i class="bi bi-check-circle me-1"></i>Completed!');

          setTimeout(() => {
            loadingModal.classList.remove("show");
            loadingModal.style.display = "none";
            document.body.classList.remove("modal-open");
            backdrop.remove();
            progressBar.style.width = "0%";
            detailsText.textContent = "";
            ToastManager.show(
              "Successfully fetched fresh data from LHDN",
              "success"
            );
            this.startRefreshTimer();
          }, 1000);
        } catch (error) {
          console.error("Error refreshing LHDN data:", error);

          // Restore button state on error
          const refreshBtn = $("#refreshLHDNData");
          refreshBtn.prop("disabled", false); // Ensure button is enabled
          refreshBtn.removeClass("loading"); // Remove loading state if present
          refreshBtn.html(
            '<i class="bi bi-exclamation-triangle me-1"></i>Retry'
          );

          ToastManager.show(
            error.message ||
              "Unable to fetch fresh data from LHDN. Please try again.",
            "error"
          );
        } finally {
          try {
            if (loadingModal) {
              loadingModal.classList.remove("show");
              loadingModal.style.display = "none";
              document.body.classList.remove("modal-open");
            }
            if (backdrop) backdrop.remove();
            if (progressBar) progressBar.style.width = "0%";
            if (detailsText) detailsText.textContent = "";
          } catch (_) {}

          // Add delay before re-enabling button to prevent rapid clicking
          setTimeout(() => {
            $("#refreshLHDNData").removeClass("loading");
            this.isRefreshing = false;
          }, 2000); // 2 second delay

          window.forceRefreshLHDN = false;
        }
      });

    this.startRefreshTimer();
  }

  // Enhanced loading backdrop with rate limit info
  showLoadingBackdrop(message, detail = "") {
    const backdrop = `
      <div class="loading-backdrop" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      ">
        <div class="loading-content" style="
          background: white;
          padding: 2rem;
          border-radius: 8px;
          text-align: center;
          max-width: 400px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        ">
          <div class="spinner-border text-primary mb-3" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <h5 class="mb-2">${message}</h5>
          ${detail ? `<p class="text-muted small mb-0">${detail}</p>` : ""}
          <div class="mt-3">
            <small class="text-muted">
              Queue: ${this.requestQueue.getQueueStatus().running}/${
      this.requestQueue.getQueueStatus().maxConcurrent
    } active,
              ${this.requestQueue.getQueueStatus().queued} waiting
            </small>
          </div>
        </div>
      </div>
    `;

    // Remove existing backdrop
    $(".loading-backdrop").remove();
    $("body").append(backdrop);
  }

  hideLoadingBackdrop() {
    $(".loading-backdrop").fadeOut(300, function () {
      $(this).remove();
    });
  }

  // Enhanced error message display
  showErrorMessage(message, type = "error") {
    const alertClass = type === "warning" ? "alert-warning" : "alert-danger";
    const icon = type === "warning" ? "exclamation-triangle" : "x-circle";

    const errorHtml = `
      <div class="alert ${alertClass} alert-dismissible fade show" role="alert">
        <i class="bi bi-${icon} me-2"></i>
        <strong>${type === "warning" ? "Warning" : "Error"}:</strong> ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>
    `;

    // Show error in table container
    $("#invoiceTable").closest(".card-body").prepend(errorHtml);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      $(".alert").fadeOut(300, function () {
        $(this).remove();
      });
    }, 10000);
  }

  // Rate limit status display
  // showRateLimitStatus() {
  //   const status = Object.keys(this.rateLimiter.limits)
  //     .map((endpoint) => {
  //       const remaining = this.rateLimiter.getRemainingRequests(endpoint);
  //       const nextAvailable = this.rateLimiter.getNextAvailableTime(endpoint);
  //       return `${endpoint}: ${remaining || 0} remaining${
  //         nextAvailable > 0 ? ` (wait ${Math.ceil(nextAvailable / 1000)}s)` : ""
  //       }`;
  //     })
  //     .join("<br>");

  //   return `
  //     <div class="rate-limit-status small text-muted mt-2">
  //       <strong>LHDN API Status:</strong><br>
  //       ${status}
  //     </div>
  //   `;
  // }

  initializeTableWithData() {
    const self = this;

    // Remove loading indicator
    $("#invoiceTable").closest(".card").removeClass("loading");
    $("#invoiceTable").closest(".card").find(".loading-overlay").remove();

    this.table = $("#invoiceTable").DataTable({
      processing: false,
      serverSide: false,
      ajax: {
        url: "/api/lhdn/documents/archive-staging", // Use staging data by default to avoid rate limiting
        method: "GET",
        data: function (d) {
          // Check if we should use cached data on page load
          const lastUpdate = localStorage.getItem("lastDataUpdate");
          const cachedData = localStorage.getItem("inboundTableData");
          const cacheValidTime = 15 * 60 * 1000; // 15 minutes

          if (lastUpdate && cachedData && !window.forceRefreshLHDN) {
            const now = new Date().getTime();
            const lastUpdateTime = parseInt(lastUpdate);

            // If cache is still valid and this is not a forced refresh
            if (now - lastUpdateTime < cacheValidTime) {
              d.useCache = true;
              console.log("Using cached data for table load");
            }
          }

          // Always include forceRefresh parameter
          d.forceRefresh = window.forceRefreshLHDN || false;
          // Add useDatabase parameter to ensure we get data even if API fails
          d.useDatabase = true;
          return d;
        },
        dataSrc: function (json) {
          let result = [];

          // Check if we should use cached data
          if (json && json.useCache) {
            const cachedData = localStorage.getItem("inboundTableData");
            if (cachedData) {
              try {
                result = JSON.parse(cachedData);
                console.log(
                  "Using cached inbound data:",
                  result.length,
                  "records"
                );
              } catch (e) {
                console.warn(
                  "Failed to parse cached data, fetching fresh data"
                );
                result = json && json.result ? json.result : [];
              }
            } else {
              result = json && json.result ? json.result : [];
            }
          } else {
            result = json && json.result ? json.result : [];

            // Save fresh data to cache
            if (result && result.length > 0) {
              try {
                localStorage.setItem(
                  "inboundTableData",
                  JSON.stringify(result)
                );
                localStorage.setItem("lastDataUpdate", new Date().getTime());
                console.log(
                  "Cached fresh inbound data:",
                  result.length,
                  "records"
                );
              } catch (e) {
                console.warn("Failed to cache data:", e);
              }
            }
          }

          console.log("Current Inbound Results: ", result);
          // Reset the force refresh flag
          window.forceRefreshLHDN = false;

          // Update totals and charts after data load
          setTimeout(() => {
            self.updateCardTotals();
            updateCharts();
          }, 100);

          return result;
        },
        error: function (xhr, error, thrown) {
          console.error("Ajax error:", error, thrown);

          // Check for specific error types
          let errorMessage = "Error fetching data from server.";
          let errorType = "error";
          let errorDuration = 5000;

          // Handle different error types
          if (xhr.status === 401 || xhr.status === 403) {
            errorMessage =
              "Authentication error. Please refresh the page to log in again.";
            // Show a more detailed error modal for auth issues
            Swal.fire({
              icon: "warning",
              title: "Session Expired",
              text: "Your session has expired or you are not authenticated. Please refresh the page to log in again.",
              confirmButtonText: "Refresh Page",
              showCancelButton: true,
            }).then((result) => {
              if (result.isConfirmed) {
                window.location.reload();
              }
            });
          } else if (xhr.status === 404) {
            errorMessage = "Data endpoint not found. Please contact support.";
          } else if (xhr.status === 429) {
            // Extract retry-after from headers if available
            const retryAfter = xhr.getResponseHeader("retry-after") || 30;
            const retrySeconds = parseInt(retryAfter);

            ToastManager.showRateLimit(
              "Too many requests to LHDN server",
              retrySeconds
            );

            errorMessage = `Rate limited. Please wait ${retrySeconds} seconds before trying again.`;
          } else if (xhr.status === 0) {
            errorMessage =
              "Network connection issue. Please check your internet connection.";
          } else if (xhr.status >= 500) {
            errorMessage = "Server error. The system is currently unavailable.";
          }

          // Don't show error toast to users, just log to console
          console.log(
            errorMessage + " Attempting to load from local database..."
          );

          // Update loading message with neutral text
          $("#loadingMessage").text("Loading invoice data...");
          $("#loadingDetail").text("Please wait while we retrieve your data");

          // Try to load data from database as fallback with improved error handling
          fetch("/api/lhdn/documents/recent?useDatabase=true&fallbackOnly=true")
            .then((response) => {
              if (!response.ok) {
                throw new Error(
                  `Database fetch failed with status: ${response.status}`
                );
              }
              return response.json();
            })
            .then((data) => {
              if (data && data.result && data.result.length > 0) {
                // Manually update the table with database data
                self.table.clear().rows.add(data.result).draw();
                // Don't show warning toast to users
                console.log(
                  "Using data from local database. LHDN API connection may be unavailable."
                );

                // Update card totals and charts with the new data
                setTimeout(() => {
                  self.updateCardTotals();
                  updateCharts();
                }, 100);
              } else {
                throw new Error("No data available in database");
              }
            })
            .catch((fallbackError) => {
              console.error("Error fetching fallback data:", fallbackError);

              // Try to use cached data as last resort
              const cachedData = localStorage.getItem("inboundTableData");
              if (cachedData) {
                try {
                  const parsedData = JSON.parse(cachedData);
                  if (parsedData && parsedData.length > 0) {
                    self.table.clear().rows.add(parsedData).draw();
                    console.log(
                      "Using cached data as fallback:",
                      parsedData.length,
                      "records"
                    );

                    // Update card totals and charts
                    setTimeout(() => {
                      self.updateCardTotals();
                      updateCharts();
                    }, 100);

                    // Show info message about using cached data
                    ToastManager.show(
                      "Using cached data. Some information may not be up to date.",
                      "info"
                    );
                    return;
                  }
                } catch (e) {
                  console.warn("Failed to parse cached data:", e);
                }
              }

              // Don't show error toast to users
              console.error(
                "Could not load any data. Please try again later or refresh the page."
              );

              // Show a more user-friendly error message
              $("#invoiceTable").closest(".card").find(".dataTables_empty")
                .html(`
                                <div class="alert alert-info">
                                    <i class="bi bi-info-circle-fill me-2"></i>
                                    <strong>No invoice data available.</strong>
                                    <p class="mb-0 mt-2">We couldn't retrieve your invoice data at this time.</p>
                                    <button class="btn btn-sm btn-outline-primary mt-2" onclick="window.location.reload()">
                                        <i class="bi bi-arrow-clockwise me-1"></i>Refresh Page
                                    </button>
                                </div>
                            `);
            });
        },
      },
      columns: [
        {
          data: null,
          orderable: false,
          defaultContent: `
                        <div class="outbound-checkbox-header">
                            <input type="checkbox" class="outbound-checkbox row-checkbox">
                        </div>`,
        },
        {
          data: null,
          orderable: false,
          searchable: false,
          className: "text-center",
          render: function (data, type, row, meta) {
            // Calculate the correct index based on the current page and page length
            const pageInfo = meta.settings._iDisplayStart;
            const index = pageInfo + meta.row + 1;
            return `<span class="row-index">${index}</span>`;
          },
        },
        {
          data: "uuid",
          render: function (data) {
            return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis  flex items-center gap-2">
                                    <a href="#" class="inbound-badge-status copy-uuid"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data}"
                                       data-uuid="${data}"
                                         style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(13, 110, 253, 0.08);
                                            color: #0d6efd;
                                            border: 1px solid rgba(13, 110, 253, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-fingerprint" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 80px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
          },
        },
        {
          data: "longId",
          render: function (data) {
            return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis flex gap-2">
                                    <a href="#"
                                       class="inbound-badge-status copy-longId"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data || "N/A"}"
                                       data-longId="${data || ""}"
                                       style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(25, 135, 84, 0.08);
                                            color: #198754;
                                            border: 1px solid rgba(25, 135, 84, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-hash" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 160px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data || "N/A"}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
          },
        },
        {
          data: "internalId",
          title: "INTERNAL ID",
          className: "text-nowrap",
          render: (data, type, row) =>
            this.renderInvoiceNumber(data, type, row),
        },
        {
          data: "issuerName",
          title: "SUPPLIER",
          render: (data, type, row) => {
            // Use issuerName or supplierName for supplier info
            const supplierName =
              row.issuerName || row.supplierName || "Unknown";
            return this.renderCompanyInfo(supplierName, type, row);
          },
        },
        {
          data: "receiverName",
          title: "RECEIVER",
          render: (data, type, row) => this.renderCompanyInfo(data, type, row),
        },
        {
          data: null,
          className: "text-nowrap",
          title: "DATE INFO",
          render: (data, type, row) =>
            this.renderDateInfo(row.dateTimeValidated, row),
        },
        {
          data: "status",
          title: "STATUS",
          render: function (data) {
            const statusClass = data.toLowerCase();

            const icons = {
              valid: "check-circle-fill",
              invalid: "x-circle-fill",
              pending: "hourglass-split",
              submitted: "hourglass-split",
              queued: "hourglass-split",
              rejected: "x-circle-fill",
              cancelled: "x-circle-fill",
            };
            const statusColors = {
              valid: "#198754",
              invalid: "#dc3545",
              pending: "#ff8307",
              submitted: "gray",
              queued: "#0d6efd",
              rejected: "#dc3545",
              cancelled: "#ffc107",
            };
            const icon = icons[statusClass] || "question-circle";
            const color = statusColors[statusClass];

            if (statusClass === "submitted" || statusClass === "pending") {
              return `<span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>Queued
                            </span>`;
            }
            return `
                            <span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>${data}
                            </span>`;
          },
        },
        // {
        //     data: 'source',
        //     title: 'SOURCE',
        //     render: function (data) {
        //         return this.renderSource(data);
        //     }.bind(this)
        // },
        {
          data: "totalSales",
          title: "TOTAL SALES",
          render: (data, type, row) => {
            if (data === undefined || data === null || data === "")
              return '<span class="text-muted">N/A</span>';
            const code =
              row.documentCurrency ||
              row.currency ||
              row.currencyCode ||
              row.documentCurrencyCode ||
              (row.header &&
                (row.header.documentCurrencyCode || row.header.currency)) ||
              "MYR";
            const formatted = parseFloat(data || 0).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            return `
                            <div class="total-amount-wrapper" style="
                                display: flex;
                                align-items: center;
                                justify-content: flex-end;
                            ">
                                <span class="total-amount" style="
                                    font-weight: 500;
                                    color: #1e40af;
                                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                    background: rgba(30, 64, 175, 0.1);
                                    padding: 4px 8px;
                                    border-radius: 4px;
                                    display: inline-block;
                                    letter-spacing: 0.5px;
                                    white-space: nowrap;
                                    transition: all 0.2s ease;
                                ">
                                    ${code} ${formatted}
                                </span>
                            </div>
                        `;
          },
        },
        {
          data: null,
          orderable: false,
          render: function (row) {
            const isValid = row.status === "Valid";
            let eligible = false;
            if (isValid && row.dateTimeValidated) {
              const deadline = new Date(
                new Date(row.dateTimeValidated).getTime() + 72 * 60 * 60 * 1000
              );
              eligible = Date.now() < deadline.getTime();
            }
            const cancelBtn = isValid
              ? eligible
                ? `<button class=\"outbound-action-btn cancel btn-cancel-inbound\"
                                           onclick=\"cancelInboundDocument('${row.uuid}')\"
                                           data-uuid=\"${row.uuid}\" title=\"Cancel Document\">
                                        <i class=\"bi bi-x-circle me-1\"></i>Cancel
                                   </button>`
                : `<button class=\"outbound-action-btn cancel btn-cancel-inbound\" data-uuid=\"${row.uuid}\" disabled
                                           style=\"opacity:0.5;pointer-events:none;cursor:not-allowed;\"
                                           title=\"Cancellation window expired\">
                                        <i class=\"bi bi-x-circle me-1\"></i>Cancel
                                   </button>`
              : "";
            return `
                            <div class=\"d-flex gap-2\">
                                <button class=\"outbound-action-btn submit\"
                                        onclick=\"viewInvoiceDetails('${row.uuid}')\"
                                        data-uuid=\"${row.uuid}\">
                                    <i class=\"bi bi-eye me-1\"></i>View
                                </button>
                                ${cancelBtn}
                            </div>`;
          },
        },
      ],
      scrollX: true,
      scrollCollapse: true,
      autoWidth: false,
      pageLength: 10,
      order: [[6, "desc"]], // The 6 should be the index of your date column
      columnDefs: [
        {
          targets: 6, // The DATE INFO column index
          type: "date",
        },
      ],
      dom: '<"outbound-controls"<"outbound-length-control"l>>rt<"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
      language: {
        //search: '',
        //searchPlaceholder: 'Search in records...',
        lengthMenu: '<i class="bi bi-list"></i> _MENU_',
        info: "Showing _START_ to _END_ of _TOTAL_ entries",
        infoEmpty: "No records available",
        infoFiltered: "(filtered from _MAX_ total records)",
        paginate: {
          first: '<i class="bi bi-chevron-double-left"></i>',
          previous: '<i class="bi bi-chevron-left"></i>',
          next: '<i class="bi bi-chevron-right"></i>',
          last: '<i class="bi bi-chevron-double-right"></i>',
        },
        select: {
          rows: {
            _: "Selected %d rows",
            0: "Click a row to select it",
            1: "Selected 1 row",
          },
        },
      },
      drawCallback: function (settings) {
        if (settings._iDisplayLength !== undefined) {
          self.updateCardTotals();
          updateCharts(); // Update charts when table is redrawn
        }

        // Update row indexes
        const table = $(this).DataTable();
        $(table.table().node())
          .find("tbody tr")
          .each(function (index) {
            const pageInfo = settings._iDisplayStart;
            $(this)
              .find(".row-index")
              .text(pageInfo + index + 1);
          });
      },
      initComplete: function () {
        self.updateCardTotals();
        self.initializeFilters();
        updateCharts(); // Update charts when table is first initialized
      },
    });

    window.inboundDataTable = this.table;

    this.initializeTableStyles();
    this.initializeEventListeners();
    this.initializeSelectAll();
    this.addExportButton();
    this.initializeTooltipsAndCopy();

    // Add refresh button with enhanced styling
    const refreshButton = $(`
            <button id="refreshLHDNData" class="outbound-action-btn submit btn-sm ms-2"
                    data-bs-toggle="tooltip"
                    data-bs-placement="top"
                    title="Refresh data from LHDN server">
                <i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data
                <small class="text-muted ms-1 refresh-timer" style="display: none;"></small>
            </button>
        `);

    $(".dataTables_length").append(refreshButton);
    refreshButton.tooltip(); // Initialize tooltip for the refresh button

    // Handle refresh button click (guard against multiple bindings and concurrent refresh)
    // Guard the second handler as well
    $("#refreshLHDNData")
      .off("click")
      .on("click", async () => {
        const button = $("#refreshLHDNData");

        // Prevent spam clicking - check both isRefreshing flag and button state
        if (this.isRefreshing || button.prop("disabled")) {
          console.log("Refresh already in progress, ignoring click");
          return;
        }

        // Rate limiting - prevent too frequent refreshes
        const now = Date.now();
        const timeSinceLastRefresh = now - this.lastRefreshTime;
        if (timeSinceLastRefresh < this.refreshCooldown) {
          const remainingTime = Math.ceil(
            (this.refreshCooldown - timeSinceLastRefresh) / 1000
          );
          this.showRefreshCooldown(remainingTime);
          ToastManager.show(
            `Please wait ${remainingTime} more seconds before refreshing again.`,
            "info"
          );
          return;
        }

        this.isRefreshing = true;
        this.lastRefreshTime = now; // Update last refresh time
        button.prop("disabled", true);
        let loadingModal, progressBar, statusText, detailsText, backdrop;
        try {
          loadingModal = document.getElementById("loadingModal");
          progressBar = document.querySelector("#loadingModal .progress-bar");
          statusText = document.getElementById("loadingStatus");
          detailsText = document.getElementById("loadingDetails");

          if (this.checkDataFreshness() && !window.forceRefreshLHDN) {
            const result = await Swal.fire({
              title: "Data is up to date",
              text: "The data was updated less than 15 minutes ago. Do you still want to refresh?",
              icon: "info",
              showCancelButton: true,
              confirmButtonText: "Yes, refresh anyway",
              cancelButtonText: "No, keep current data",
              confirmButtonColor: "#1e40af",
              cancelButtonColor: "#dc3545",
            });
            if (!result.isConfirmed) return;
          }

          loadingModal.classList.add("show");
          loadingModal.style.display = "block";
          document.body.classList.add("modal-open");

          backdrop = document.createElement("div");
          backdrop.className = "modal-backdrop fade show";
          document.body.appendChild(backdrop);

          progressBar.style.width = "10%";
          statusText.textContent = "Connecting to LHDN server...";

          const response = await fetch("/api/lhdn/documents/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || "Failed to refresh data");
          }

          progressBar.style.width = "50%";
          statusText.textContent = "Refreshing data...";
          window.forceRefreshLHDN = true;
          localStorage.removeItem("lastDataUpdate");

          if (this.table.ajax && this.table.ajax.reload) {
            await this.table.ajax.reload(null, false);
          } else {
            await this.refreshCurrentDataSource();
          }

          progressBar.style.width = "100%";
          statusText.textContent = "Success! Your data is now up to date.";
          setTimeout(() => {
            loadingModal.classList.remove("show");
            loadingModal.style.display = "none";
            document.body.classList.remove("modal-open");
            backdrop.remove();
            progressBar.style.width = "0%";
            detailsText.textContent = "";
            ToastManager.show(
              "Successfully fetched fresh data from LHDN",
              "success"
            );
            this.startRefreshTimer();
          }, 1000);
        } catch (error) {
          console.error("Error refreshing LHDN data:", error);
          ToastManager.show(
            error.message ||
              "Unable to fetch fresh data from LHDN. Please try again.",
            "error"
          );
        } finally {
          try {
            if (loadingModal) {
              loadingModal.classList.remove("show");
              loadingModal.style.display = "none";
              document.body.classList.remove("modal-open");
            }
            if (backdrop) backdrop.remove();
            if (progressBar) progressBar.style.width = "0%";
            if (detailsText) detailsText.textContent = "";
          } catch (_) {}

          // Add delay before re-enabling button to prevent rapid clicking
          setTimeout(() => {
            const refreshBtn = $("#refreshLHDNData");
            refreshBtn.removeClass("loading");
            refreshBtn.prop("disabled", false);
            refreshBtn.html(
              '<i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data'
            );
            this.isRefreshing = false;
          }, 2000); // 2 second delay

          window.forceRefreshLHDN = false;
        }
      });

    this.startRefreshTimer();
  }

  initializeFilters() {
    const self = this;

    // Global search
    $("#globalSearch").on("input", function () {
      self.table.search(this.value).draw();
    });

    // Status filter buttons
    $(".quick-filters .btn[data-filter]").on("click", function () {
      $(".quick-filters .btn").removeClass("active");
      $(this).addClass("active");

      const filter = $(this).data("filter");
      const statusColumn = self.table.column(8); // Status column

      if (filter === "all") {
        statusColumn.search("").draw();
      } else {
        // Convert filter value to match the actual status text
        let searchValue =
          filter.charAt(0).toUpperCase() + filter.slice(1).toLowerCase();

        // Special handling for 'queue' status
        if (filter === "queue") {
          searchValue = "Queued|Submitted|Pending";
        }

        statusColumn.search(searchValue, true, false, true).draw();
      }
    });

    // Date range filter
    $("#tableStartDate, #tableEndDate").on("change", function () {
      const startDate = $("#tableStartDate").val();
      const endDate = $("#tableEndDate").val();

      // Validate date range
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start > end) {
          ToastManager.show(
            "Start date cannot be later than end date",
            "error"
          );
          return;
        }
      }

      self.applyFilters();
    });

    // Amount range filter
    $("#minAmount, #maxAmount").on(
      "input",
      debounce(function () {
        self.applyFilters();
      }, 300)
    );

    // Company filter
    $("#companyFilter").on(
      "input",
      debounce(function () {
        self.applyFilters();
      }, 300)
    );

    // Document type filter
    $("#documentTypeFilter").on("change", function () {
      self.applyFilters();
    });

    // Source filter
    $("#sourceFilter").on("change", function () {
      self.applyFilters();
    });

    // Clear all filters
    $(document).on("click", "#clearFilters, #clearAllFilters", function () {
      // Reset all inputs
      $(
        "#tableStartDate, #tableEndDate, #minAmount, #maxAmount, #companyFilter"
      ).val("");
      $("#documentTypeFilter, #sourceFilter").val("");

      // Reset quick filters
      $(".quick-filters .btn[data-filter='all']")
        .addClass("active")
        .siblings()
        .removeClass("active");

      // Clear DataTable filters
      self.table.search("").columns().search("");

      // Clear global search
      $("#globalSearch").val("");

      // Reset and redraw table
      self.applyFilters();

      // Show success message
      ToastManager.show("All filters have been cleared", "success");
    });

    // Remove individual filter
    $(document).on("click", ".filter-tag .btn-close", function () {
      const filterText = $(this).siblings(".filter-text").text();
      const filterType = filterText.split(":")[0].trim().toLowerCase();

      // Clear the corresponding filter input
      switch (filterType) {
        case "date":
          $("#tableStartDate, #tableEndDate").val("");
          break;
        case "amount":
          $("#minAmount, #maxAmount").val("");
          break;
        case "company":
          $("#companyFilter").val("");
          break;
        case "type":
          $("#documentTypeFilter").val("");
          break;
        case "source":
          $("#sourceFilter").val("");
          break;
      }

      // Reapply filters
      self.applyFilters();

      // Show success message
      ToastManager.show("Filter removed", "success");
    });

    // Helper function for debouncing
    function debounce(func, wait) {
      let timeout;
      return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }
  }

  initializeTableStyles() {
    $(".dataTables_filter input").addClass("form-control form-control-sm");
    $(".dataTables_length select").addClass("form-select form-select-sm");
  }

  initializeEventListeners() {
    $("#invoiceTable").on("click", ".view-details", async (e) => {
      const uuid = $(e.currentTarget).data("uuid");
      await viewInvoiceDetails(uuid);
    });
  }

  renderSource(data) {
    if (!data) return this.createSourceBadge("LHDN");
    return this.createSourceBadge(data);
  }

  renderDateInfo(validatedDate, row) {
    // console.log(validatedDate);
    const validatedFormatted = validatedDate
      ? this.formatDate(validatedDate)
      : null;
    const showCountdown = row?.status === "Valid";

    return `
            <div class="date-info" style="position: relative;">
                ${
                  validatedFormatted
                    ? `
                    <div class="date-row validated"
                         data-bs-toggle="tooltip"
                         data-bs-placement="top"
                         title="LHDN validation completed on ${validatedFormatted}"
                         style="position: relative; padding-left: 28px;">
                        <i class="bi bi-shield-check text-success"
                           style="position: absolute; left: 0; top: 3px; font-size: 1.1rem;"></i>
                        <div class="date-content">
                            <div class="d-flex align-items-center gap-2">
                                <span class="date-value text-dark fw-medium">
                                    ${validatedFormatted}
                                </span>
                                <span class="badge bg-success bg-opacity-10 text-success py-1 px-2"
                                      style="font-size: 0.55rem; border: 1px solid rgba(25, 135, 84, 0.15);">
                                    Validated
                                </span>
                            </div>
                            <div class="date-label text-muted" style="font-size: 0.65rem;">
                                LHDN Validation Date
                            </div>
                            ${
                              showCountdown
                                ? `
                            <div class="date-row mt-1" style="font-size: 0.75rem;">
                                <span class="text-muted">Time remaining to cancel:</span>
                                <span class="ms-1 fw-semibold inbound-cancel-countdown"
                                      data-validated="${
                                        row.dateTimeValidated || ""
                                      }"
                                      data-uuid="${
                                        row.uuid
                                      }">calculating...</span>
                            </div>`
                                : ""
                            }
                        </div>
                    </div>
                `
                    : ""
                }
            </div>
        `;
  }

  renderInvoiceNumber(data, type, row) {
    if (!data) return '<span class="text-muted">N/A</span>';

    // Get document type icon based on type
    const getDocTypeIcon = (docType) => {
      const icons = {
        Invoice: "receipt",
        "Credit Note": "arrow-return-left",
        "Debit Note": "arrow-return-right",
        "Refund Note": "cash-stack",
        "Self-billed Invoice": "receipt",
        "Self-billed Credit Note": "arrow-return-left",
        "Self-billed Debit Note": "arrow-return-right",
        "Self-billed Refund Note": "cash-stack",
      };
      return icons[docType] || "file-text";
    };

    // Get document type color based on type
    const getDocTypeColor = (docType) => {
      const colors = {
        Invoice: "#0d6efd",
        "Credit Note": "#198754",
        "Debit Note": "#dc3545",
        "Refund Note": "#6f42c1",
        "Self-billed Invoice": "#0d6efd",
        "Self-billed Credit Note": "#198754",
        "Self-billed Debit Note": "#dc3545",
        "Self-billed Refund Note": "#6f42c1",
      };
      return colors[docType] || "#6c757d";
    };
    const docType = row.typeName;
    // + ' ' + row.typeVersionName || 'NA'
    const docTypeIcon = getDocTypeIcon(docType);
    const docTypeColor = getDocTypeColor(docType);

    return `
            <div class="invoice-info-wrapper" style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
                <div class="invoice-main" style="display: flex; align-items: center; gap: 12px;">

                </div>
                <div class="invoice-number" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 500;
                    color: #2c3345;
                    padding-left: 0;
                ">
                    <i class="bi bi-hash text-primary"></i>
                    <span class="invoice-text" title="${data}" style="
                        max-width: 180px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${data}</span>
                </div>
              <div class="document-type" style="padding-left: 0;">
                        <span class="badge-document-type" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 4px 8px;
                            border-radius: 4px;
                            font-size: 0.75rem;
                            font-weight: 500;
                            background-color: ${docTypeColor}15;
                            color: ${docTypeColor};
                        ">
                            <i class="bi bi-${docTypeIcon}"></i>
                            ${docType + " " + row.typeVersionName}
                        </span>
                    </div>
            </div>`;
  }

  renderTotalAmount(data) {
    if (!data) return '<span class="text-muted">N/A</span>';

    return `
            <div class="total-amount-wrapper" style="
                display: flex;
                align-items: center;
                justify-content: flex-end;
            ">
                <span class="total-amount" style="
                    font-weight: 500;
                    color: #1e40af;
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    background: rgba(30, 64, 175, 0.1);
                    padding: 4px 8px;
                    border-radius: 4px;
                    display: inline-block;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                ">
                    ${data}
                </span>
            </div>
        `;
  }
  renderCompanyInfo(data) {
    if (!data)
      return `
        <div class="cell-group">
            <div class="cell-main">
                <i class="bi bi-building me-1"></i>
                <span class="supplier-text">N/A</span>
            </div>
            <div class="cell-sub">
                <i class="bi bi-card-text me-1"></i>
                <span class="reg-text">Company Name</span>
            </div>
        </div>`;
    return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-building me-1"></i>
                    <span class="supplier-text">${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-card-text me-1"></i>
                    <span class="reg-text">Company Name</span>
                </div>
            </div>`;
  }

  // Helper methods
  formatDate(date) {
    if (!date) return "N/A";
    const d = new Date(date);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(amount || 0);
  }

  createStatusBadge(status, reason) {
    const statusClasses = {
      Valid: "bg-success",
      Invalid: "bg-danger",
      Pending: "bg-warning",
      Rejected: "bg-danger",
      Cancelled: "bg-secondary",
      Queued: "bg-info",
    };
    const className = statusClasses[status] || "bg-secondary";
    const reasonHtml = reason
      ? `<br><small class="text-muted">${reason}</small>`
      : "";
    return `<span class="badge ${className}">${
      status || "Unknown"
    }</span>${reasonHtml}`;
  }

  createSourceBadge(source) {
    let badgeClass = "bg-info";
    let iconClass = "bi-building";
    let tooltipText = "Document from external system";
    let customStyle = "";

    switch (source) {
      case "PixelCare":
        badgeClass = "bg-primary";
        iconClass = "bi-pc-display";
        tooltipText = "Document managed through PixelCare system";
        break;
      case "Pixel Pinnacle":
        badgeClass = "bg-success";
        iconClass = "bi-file-earmark-spreadsheet";
        tooltipText = "Document created through Pixel Pinnacle portal";
        break;
      case "LHDN":
        badgeClass = ""; // Remove the default bg class
        iconClass = "bi-cloud-download";
        tooltipText = "Document imported/submitted directly from LHDN ";
        customStyle = "background-color: #1e40af; color: #ffffff;";
        break;
      default:
        badgeClass = "bg-info";
        iconClass = "bi-building";
    }

    return `<span class="badge ${badgeClass}"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="${tooltipText}"
            style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 0.85rem;
                font-weight: 500;
                white-space: nowrap;
                cursor: help;
                ${customStyle}
            ">
            <i class="bi ${iconClass}"></i>
            ${source || "Unknown"}
        </span>`;
  }

  initializeSelectAll() {
    // Handle "Select All" checkbox
    $("#selectAll").on("change", (e) => {
      const isChecked = $(e.target).prop("checked");
      $(".row-checkbox").prop("checked", isChecked);
      this.updateExportButton();
    });

    // Handle individual checkbox changes
    $("#invoiceTable").on("change", ".row-checkbox", () => {
      const totalCheckboxes = $(".row-checkbox").length;
      const checkedCheckboxes = $(".row-checkbox:checked").length;
      $("#selectAll").prop("checked", totalCheckboxes === checkedCheckboxes);
      this.updateExportButton();
    });
  }

  addExportButton() {
    // Add export button after the table length control
    const exportBtn = $(`
            <button id="exportSelected" class="outbound-action-btn submit btn-sm ms-2" disabled>
                <i class="bi bi-download me-1"></i>Export Selected
                <span class="selected-count ms-1">(0)</span>
            </button>
        `);

    $(".dataTables_length").append(exportBtn);

    // Handle export button click
    $("#exportSelected").on("click", () => this.exportSelectedRecords());
  }

  updateExportButton() {
    const selectedCount = $(".row-checkbox:checked").length;
    const exportBtn = $("#exportSelected");

    if (selectedCount > 0) {
      exportBtn.prop("disabled", false);
      exportBtn.find(".selected-count").text(`(${selectedCount})`);
    } else {
      exportBtn.prop("disabled", true);
      exportBtn.find(".selected-count").text("(0)");
    }
  }

  async exportSelectedRecords() {
    const exportBtn = $("#exportSelected");
    const originalHtml = exportBtn.html();

    try {
      const selectedRows = [];
      $(".row-checkbox:checked").each((_, checkbox) => {
        const rowData = this.table.row($(checkbox).closest("tr")).data();
        selectedRows.push(rowData);
      });

      if (selectedRows.length === 0) {
        ToastManager.show(
          "Please select at least one record to export",
          "error"
        );
        return;
      }

      // Show loading state
      exportBtn.prop("disabled", true);
      exportBtn.html(
        '<i class="bi bi-arrow-repeat spin me-1"></i>Exporting...'
      );

      // Add a small delay to show the loading state
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Prepare export data
      const exportData = selectedRows.map((row) => ({
        UUID: row.uuid,
        LONGID: row.longId,
        "Internal ID": row.internalId,
        Type: row.typeName,
        Supplier: row.issuerName || row.supplierName || "",
        Receiver: row.receiverName,
        "Issue Date": new Date(row.dateTimeIssued).toLocaleString(),
        "Received Date": new Date(row.dateTimeReceived).toLocaleString(),
        "Validated Date": new Date(row.dateTimeValidated).toLocaleString(),
        Status: row.status,
        "Total Sales": `RM ${parseFloat(row.totalSales).toFixed(2)}`,
      }));

      // Convert to CSV
      const csvContent = this.convertToCSV(exportData);

      // Create and trigger download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `inbound_invoices_${
        new Date().toISOString().split("T")[0]
      }.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL
      URL.revokeObjectURL(link.href);

      // Show success message
      ToastManager.show(
        `Successfully exported ${selectedRows.length} records`,
        "success"
      );
    } catch (error) {
      console.error("Export error:", error);
      ToastManager.show("Failed to export selected records", "error");
    } finally {
      // Always reset button state
      exportBtn.prop("disabled", false);
      exportBtn.html(originalHtml);
    }
  }

  convertToCSV(data) {
    if (data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const rows = [
      headers.join(","), // Header row
      ...data.map((row) =>
        headers.map((header) => JSON.stringify(row[header] || "")).join(",")
      ),
    ];

    return rows.join("\n");
  }

  updateCardTotals() {
    // Check if table is initialized
    if (!this.table || !$.fn.DataTable.isDataTable("#invoiceTable")) {
      return;
    }

    try {
      const data = this.table.rows().data();
      const totals = {
        invoices: 0,
        valid: 0,
        invalid: 0,
        rejected: 0,
        cancelled: 0,
        submitted: 0,
      };

      // Calculate average processing time
      let processingTimes = [];
      let totalAmount = 0;

      // Count totals and collect processing times
      if (data && data.length) {
        data.each((row) => {
          totals.invoices++;

          // Calculate processing time if dates are available
          if (row.dateTimeIssued && row.dateTimeValidated) {
            try {
              const issued = new Date(row.dateTimeIssued);
              const validated = new Date(row.dateTimeValidated);
              if (!isNaN(issued.getTime()) && !isNaN(validated.getTime())) {
                const processingTime =
                  (validated.getTime() - issued.getTime()) / (1000 * 60 * 60); // hours
                if (processingTime >= 0 && processingTime <= 168) {
                  // reasonable range (0-168 hours)
                  processingTimes.push(processingTime);
                }
              }
            } catch (e) {
              console.warn("Error parsing dates for processing time:", e);
            }
          }

          // Sum total amounts
          if (row.totalSales && !isNaN(parseFloat(row.totalSales))) {
            totalAmount += parseFloat(row.totalSales);
          }

          switch (row.status) {
            case "Valid":
              totals.valid++;
              break;
            case "Invalid":
              totals.invalid++;
              break;
            case "Rejected":
              totals.rejected++;
              break;
            case "Cancelled":
              totals.cancelled++;
              break;
            case "Submitted":
              totals.submitted++;
              break;
          }
        });
      }

      // Calculate average processing time
      const avgProcessingTime =
        processingTimes.length > 0
          ? processingTimes.reduce((sum, time) => sum + time, 0) /
            processingTimes.length
          : 0;

      // Update card values and hide spinners
      $(".total-invoice-value")
        .text(totals.invoices)
        .show()
        .closest(".info-card")
        .find(".card-icon")
        .append(
          `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-primary">${totals.invoices}</span>`
        );

      $(".total-valid-value")
        .text(totals.valid)
        .show()
        .closest(".info-card")
        .find(".card-icon")
        .append(
          `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-success">${totals.valid}</span>`
        );

      $(".total-invalid-value")
        .text(totals.invalid)
        .show()
        .closest(".info-card")
        .find(".card-icon")
        .append(
          `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${totals.invalid}</span>`
        );

      $(".total-rejected-value")
        .text(totals.rejected)
        .show()
        .closest(".info-card")
        .find(".card-icon")
        .append(
          `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${totals.rejected}</span>`
        );

      $(".total-cancel-value")
        .text(totals.cancelled)
        .show()
        .closest(".info-card")
        .find(".card-icon")
        .append(
          `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-warning">${totals.cancelled}</span>`
        );

      $(".total-queue-value")
        .text(totals.submitted)
        .show()
        .closest(".info-card")
        .find(".card-icon")
        .append(
          `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-info">${totals.submitted}</span>`
        );

      // Update average processing time
      const avgTimeElement = $(".avg-processing-time");
      if (avgTimeElement.length > 0) {
        if (avgProcessingTime > 0) {
          let timeDisplay;
          if (avgProcessingTime < 1) {
            // Less than 1 hour, show in minutes
            const minutes = Math.round(avgProcessingTime * 60);
            timeDisplay = `${minutes}m`;
          } else if (avgProcessingTime < 24) {
            // Less than 24 hours, show in hours
            timeDisplay = `${avgProcessingTime.toFixed(1)}h`;
          } else {
            // More than 24 hours, show in days
            const days = (avgProcessingTime / 24).toFixed(1);
            timeDisplay = `${days}d`;
          }

          avgTimeElement.text(timeDisplay).show();

          // Add tooltip with detailed info
          avgTimeElement.attr(
            "title",
            `Average processing time: ${avgProcessingTime.toFixed(2)} hours\n` +
              `Based on ${processingTimes.length} processed documents\n` +
              `Total amount: MYR ${totalAmount.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}`
          );

          // Initialize tooltip if not already done
          if (typeof bootstrap !== "undefined" && bootstrap.Tooltip) {
            new bootstrap.Tooltip(avgTimeElement[0]);
          }
        } else {
          avgTimeElement.text("N/A").show();
          avgTimeElement.attr("title", "No processing time data available");
        }
      }

      // Update detailed processing analytics
      this.updateProcessingAnalytics(processingTimes, avgProcessingTime);

      // Hide all spinners
      $(".loading-spinner").hide();

      // Remove any existing badges before adding new ones
      $(".card-icon .badge").remove();
    } catch (error) {
      console.error("Error updating card totals:", error);
      // Don't hide spinners if there was an error
    }
  }

  // Update processing analytics in the chart section
  updateProcessingAnalytics(processingTimes, avgProcessingTime) {
    try {
      if (processingTimes.length > 0) {
        // Calculate statistics
        const fastest = Math.min(...processingTimes);
        const slowest = Math.max(...processingTimes);

        // Format time display function
        const formatTime = (hours) => {
          if (hours < 1) {
            return `${Math.round(hours * 60)}m`;
          } else if (hours < 24) {
            return `${hours.toFixed(1)}h`;
          } else {
            return `${(hours / 24).toFixed(1)}d`;
          }
        };

        // Update analytics display
        $("#avgProcessingHours").text(formatTime(avgProcessingTime));
        $("#fastestProcessing").text(formatTime(fastest));
        $("#slowestProcessing").text(formatTime(slowest));

        // Add tooltips with detailed information
        $("#avgProcessingHours").attr(
          "title",
          `Average: ${avgProcessingTime.toFixed(2)} hours\nBased on ${
            processingTimes.length
          } documents`
        );
        $("#fastestProcessing").attr(
          "title",
          `Fastest processing: ${fastest.toFixed(2)} hours`
        );
        $("#slowestProcessing").attr(
          "title",
          `Slowest processing: ${slowest.toFixed(2)} hours`
        );

        // Initialize tooltips
        if (typeof bootstrap !== "undefined" && bootstrap.Tooltip) {
          [
            "#avgProcessingHours",
            "#fastestProcessing",
            "#slowestProcessing",
          ].forEach((selector) => {
            const element = document.querySelector(selector);
            if (element) {
              new bootstrap.Tooltip(element);
            }
          });
        }
      } else {
        // No data available
        $("#avgProcessingHours").text("-");
        $("#fastestProcessing").text("-");
        $("#slowestProcessing").text("-");

        // Clear tooltips
        [
          "#avgProcessingHours",
          "#fastestProcessing",
          "#slowestProcessing",
        ].forEach((selector) => {
          $(selector).attr("title", "No processing time data available");
        });
      }
    } catch (error) {
      console.error("Error updating processing analytics:", error);
    }
  }

  initializeTooltipsAndCopy() {
    const copyToClipboard = async (text, element) => {
      try {
        if (!text || text === "N/A") {
          throw new Error("No valid text to copy");
        }

        // Create temporary textarea
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();

        // Try to copy using document.execCommand first (more compatible)
        let success = false;
        try {
          success = document.execCommand("copy");
        } catch (err) {
          success = false;
        }

        // If execCommand fails, try clipboard API
        if (!success && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          success = true;
        }

        // Clean up textarea
        document.body.removeChild(textarea);

        if (!success) {
          throw new Error("Copy operation failed");
        }

        // Visual feedback
        const clipboardIcon = element.querySelector(".bi-clipboard");
        if (clipboardIcon) {
          clipboardIcon.classList.remove("bi-clipboard");
          clipboardIcon.classList.add("bi-check2");
          clipboardIcon.style.color = "#198754";
          clipboardIcon.style.opacity = "1";
        }

        // Update tooltip
        const tooltip = bootstrap.Tooltip.getInstance(element);
        if (tooltip) {
          tooltip.dispose();
        }
        element.setAttribute("data-bs-original-title", "Copied!");
        new bootstrap.Tooltip(element, { trigger: "manual" }).show();

        // Reset after 1.5 seconds
        setTimeout(() => {
          if (clipboardIcon) {
            clipboardIcon.classList.remove("bi-check2");
            clipboardIcon.classList.add("bi-clipboard");
            clipboardIcon.style.color = "";
            clipboardIcon.style.opacity = "0.6";
          }

          const currentTooltip = bootstrap.Tooltip.getInstance(element);
          if (currentTooltip) {
            currentTooltip.dispose();
          }
          element.setAttribute("data-bs-original-title", "Click to copy");
          new bootstrap.Tooltip(element);
        }, 1500);

        // Show success toast with specific message based on what was copied
        const itemType = element.classList.contains("copy-uuid")
          ? "UUID"
          : "Long ID";
        ToastManager.show(`${itemType} copied to clipboard!`, "success");
      } catch (err) {
        console.error("Failed to copy:", err);
        const itemType = element.classList.contains("copy-uuid")
          ? "UUID"
          : "Long ID";
        ToastManager.show(`Failed to copy ${itemType}`, "error");
      }
    };

    // Initialize tooltips
    const initTooltips = () => {
      $('[data-bs-toggle="tooltip"]').tooltip("dispose").tooltip();
    };

    // Initialize tooltips on load
    initTooltips();

    // Reinitialize tooltips after table draw
    this.table.on("draw", initTooltips);

    // Handle UUID copy
    $(document).on("click", ".copy-uuid", function (e) {
      e.preventDefault();
      const uuid = $(this).data("uuid");
      copyToClipboard(uuid, this);
    });

    // Handle longId copy
    $(document).on("click", ".copy-longId", function (e) {
      e.preventDefault();
      const longId = $(this).data("longid");
      copyToClipboard(longId, this);
    });
  }

  // Add new function to check data freshness
  checkDataFreshness() {
    const lastUpdate = localStorage.getItem("lastDataUpdate");
    if (!lastUpdate) return false;

    const currentTime = new Date().getTime();
    const lastUpdateTime = parseInt(lastUpdate);
    const fifteenMinutes = 15 * 60 * 1000;

    return currentTime - lastUpdateTime < fifteenMinutes;
  }

  // Add refresh timer functionality
  startRefreshTimer() {
    const timerElement = $(".refresh-timer");
    const updateTimer = () => {
      const lastUpdate = localStorage.getItem("lastDataUpdate");
      if (!lastUpdate) {
        timerElement.hide();
        return;
      }

      const now = new Date().getTime();
      const timeSinceUpdate = now - parseInt(lastUpdate);
      const minutesAgo = Math.floor(timeSinceUpdate / 60000);

      if (minutesAgo < 15) {
        timerElement.show().text(`(${15 - minutesAgo}m until next refresh)`);
      } else {
        timerElement.hide();
      }
    };

    // Clear any existing timer to avoid multiple intervals stacking
    if (this.refreshTimerInterval) {
      clearInterval(this.refreshTimerInterval);
    }
    // Update timer immediately and every minute
    updateTimer();
    this.refreshTimerInterval = setInterval(updateTimer, 60000);
  }

  getUniqueColumnValues(columnName, columnIndex, dataType = "text") {
    const table = this.table;

    // For HTML columns, we need to get both the rendered data and the raw data
    let processedData = [];

    // Use DataTables API to get column data
    if (dataType === "html") {
      // Get the rendered data (HTML) from the column
      const columnData = table.column(columnIndex).nodes().to$();

      // Extract text content from HTML
      columnData.each(function () {
        let text = "";

        // For source column
        if (columnName === "source") {
          // Extract the source name from the badge
          const sourceBadge = $(this).find(".source-badge");
          if (sourceBadge.length) {
            text = sourceBadge.text().trim();
          } else {
            // Fallback to any text in the cell
            text = $(this).text().trim();
          }
        }
        // For status column
        else if (columnName === "status") {
          const statusBadge = $(this).find(".inbound-status");
          if (statusBadge.length) {
            // Extract only the status text, not the icon
            const iconElement = statusBadge.find("i");
            if (iconElement.length) {
              iconElement.remove(); // Temporarily remove icon to get clean text
              text = statusBadge.text().trim();
              statusBadge.prepend(iconElement); // Restore icon
            } else {
              text = statusBadge.text().trim();
            }
          } else {
            // Fallback to any text in the cell
            text = $(this).text().trim();
          }
        }
        // For other HTML columns
        else {
          text = $(this).text().trim();
        }

        if (text) {
          processedData.push(text);
        }
      });
    } else {
      // For text columns, use the standard DataTables API
      processedData = table
        .column(columnIndex)
        .data()
        .toArray()
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          } else if (
            item &&
            typeof item === "object" &&
            item[columnName] !== undefined
          ) {
            return item[columnName].toString().trim();
          }
          return (item || "").toString().trim();
        })
        .filter(Boolean); // Remove empty values
    }

    // Get unique values
    const uniqueValues = [...new Set(processedData)];
    return uniqueValues.sort();
  }

  applyFilters() {
    const self = this;
    const table = this.table;

    // Remove any existing custom filter
    $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
      (fn) => fn.name !== "customInboundFilter"
    );

    // Track active filters
    const activeFilters = [];

    // Date Range Filter
    const startDate = $("#tableStartDate").val();
    const endDate = $("#tableEndDate").val();

    if (startDate || endDate) {
      if (startDate && endDate) {
        activeFilters.push(`Date: ${startDate} to ${endDate}`);
      } else if (startDate) {
        activeFilters.push(`Date: From ${startDate}`);
      } else if (endDate) {
        activeFilters.push(`Date: Until ${endDate}`);
      }
    }

    // Amount Range Filter
    const minAmount = parseFloat($("#minAmount").val()) || 0;
    const maxAmount = parseFloat($("#maxAmount").val()) || Infinity;
    if (minAmount > 0 || maxAmount < Infinity) {
      if (minAmount > 0 && maxAmount < Infinity) {
        activeFilters.push(
          `Amount: MYR ${minAmount.toFixed(2)} - MYR ${maxAmount.toFixed(2)}`
        );
      } else if (minAmount > 0) {
        activeFilters.push(`Amount: Min MYR ${minAmount.toFixed(2)}`);
      } else if (maxAmount < Infinity) {
        activeFilters.push(`Amount: Max MYR ${maxAmount.toFixed(2)}`);
      }
    }

    // Company Filter
    const companyFilter = $("#companyFilter").val();
    if (companyFilter) {
      activeFilters.push(`Company: ${companyFilter}`);
    }

    // Document Type Filter
    const typeFilter = $("#documentTypeFilter").val();
    if (typeFilter) {
      activeFilters.push(`Type: ${typeFilter}`);
    }

    // Source Filter
    const sourceFilter = $("#sourceFilter").val();
    if (sourceFilter) {
      activeFilters.push(`Source: ${sourceFilter}`);
    }

    // Update active filters display
    this.updateActiveFilterTags(activeFilters);

    // Add custom filtering function
    $.fn.dataTable.ext.search.push(function customInboundFilter(
      settings,
      searchData,
      index,
      rowData
    ) {
      let showRow = true;

      // Date Range Filter
      if (startDate || endDate) {
        // Prefer raw row data dates; fall back to parsing the cell text
        let rawDate =
          (rowData &&
            (rowData.dateTimeValidated ||
              rowData.dateTimeReceived ||
              rowData.validatedAt ||
              rowData.date)) ||
          null;
        let rowDate = rawDate ? new Date(rawDate) : null;

        if (!rowDate || isNaN(rowDate)) {
          // Fallback: attempt to parse any date-like text in the DATE INFO cell
          const dateText = $(table.cell(index, 7).node()).text().trim();
          const parsed = Date.parse(dateText);
          if (!isNaN(parsed)) rowDate = new Date(parsed);
        }

        if (rowDate && !isNaN(rowDate)) {
          rowDate.setHours(0, 0, 0, 0);

          if (startDate) {
            const startDateTime = new Date(startDate);
            startDateTime.setHours(0, 0, 0, 0);
            if (rowDate < startDateTime) showRow = false;
          }

          if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setHours(23, 59, 59, 999);
            if (rowDate > endDateTime) showRow = false;
          }
        }
      }

      // Amount Range Filter
      const amountStr = (searchData[9] || "").replace(/[^\d.-]/g, ""); // TOTAL AMOUNT column (index 9)
      const amount = parseFloat(amountStr) || 0;
      if (amount < minAmount || amount > maxAmount) showRow = false;

      // Company Filter
      if (companyFilter) {
        const supplierName = (searchData[5] || "").toLowerCase(); // SUPPLIER column
        const receiverName = (searchData[6] || "").toLowerCase(); // RECEIVER column
        if (
          !supplierName.includes(companyFilter.toLowerCase()) &&
          !receiverName.includes(companyFilter.toLowerCase())
        ) {
          showRow = false;
        }
      }

      // Document Type Filter
      if (typeFilter) {
        const docTypeCell = $(table.cell(index, 4).node())
          .find(".badge-document-type")
          .text()
          .trim();
        if (!docTypeCell.includes(typeFilter)) showRow = false;
      }

      // Source Filter
      if (sourceFilter) {
        const source =
          rowData && rowData.source ? String(rowData.source) : "LHDN";
        if (!source.toLowerCase().includes(String(sourceFilter).toLowerCase()))
          showRow = false;
      }

      return showRow;
    });

    // Apply filters
    table.draw();
  }

  updateActiveFilterTags(activeFilters) {
    const container = $("#activeFilterTags");
    container.empty();

    if (activeFilters.length === 0) {
      container.html('<span class="text-muted">No active filters</span>');
      return;
    }

    activeFilters.forEach((filter) => {
      const tag = $(`
                <div class="filter-tag">
                    <span class="filter-text">${filter}</span>
                    <button type="button" class="btn-close btn-close-white btn-sm" aria-label="Remove filter"></button>
                </div>
            `);
      container.append(tag);
    });

    // Add clear all button if there are filters
    if (activeFilters.length > 0) {
      const clearAllBtn = $(`
                <button type="button" class="btn btn-link btn-sm text-danger" id="clearAllFilters">
                    <i class="bi bi-x-circle me-1"></i>Clear all filters
                </button>
            `);
      container.append(clearAllBtn);
    }
  }

  resetFilters() {
    // Reset all dropdown filters
    $(".filter-select").val("");

    // Reset date filters
    $("#start-date-filter").val("");
    $("#end-date-filter").val("");

    // Redraw the table with no filters
    this.table.draw();
  }

  refresh() {
    if (this.table) {
      // Check if table has AJAX configuration (live data) or uses local data (archive)
      if (this.table.ajax && this.table.ajax.reload) {
        // AJAX-based table (live data)
        this.table.ajax.reload(() => {
          this.updateCardTotals();
          updateCharts(); // Update charts after refresh
        }, false);
      } else {
        // Local data table (archive data) - refresh by calling the appropriate method
        this.refreshCurrentDataSource();
      }
    }
  }

  // Show refresh cooldown timer
  showRefreshCooldown(remainingTime) {
    const button = $("#refreshLHDNData");
    const originalHtml = button.html();

    // Disable button during cooldown
    button.prop("disabled", true);
    button.addClass("btn-secondary").removeClass("btn-primary");

    let countdown = remainingTime;
    const timer = setInterval(() => {
      button.html(`<i class="bi bi-clock me-1"></i>Wait ${countdown}s`);
      countdown--;

      if (countdown < 0) {
        clearInterval(timer);
        button.html(originalHtml);
        button.prop("disabled", false);
        button.removeClass("btn-secondary").addClass("btn-primary");
      }
    }, 1000);
  }

  // Enhanced rate limit status display
  updateRateLimitStatus() {
    const statusContainer = $("#rateLimitStatus");
    if (statusContainer.length === 0) {
      // Create status container if it doesn't exist
      $(".dataTables_length").append(`
        <div id="rateLimitStatus" class="small text-muted mt-2" style="max-width: 300px;">
          <div class="d-flex align-items-center">
            <i class="bi bi-speedometer2 me-1"></i>
            <span>LHDN API Status</span>
          </div>
          <div id="rateLimitDetails" class="mt-1"></div>
        </div>
      `);
    }

    // Update status details
    const criticalEndpoints = [
      "getRecentDocuments",
      "getDocumentDetails",
      "getDocument",
    ];
    const statusDetails = criticalEndpoints
      .map((endpoint) => {
        const remaining = this.rateLimiter.getRemainingRequests(endpoint);
        const nextAvailable = this.rateLimiter.getNextAvailableTime(endpoint);
        const status =
          remaining === 0 || nextAvailable > 0 ? "warning" : "success";
        const color = status === "warning" ? "#ffc107" : "#198754";

        return `
        <div class="d-flex justify-content-between align-items-center">
          <span style="font-size: 0.75rem;">${endpoint
            .replace("get", "")
            .replace("Documents", "Docs")}:</span>
          <span style="color: ${color}; font-weight: 500; font-size: 0.75rem;">
            ${remaining || 0}/min
            ${nextAvailable > 0 ? ` (${Math.ceil(nextAvailable / 1000)}s)` : ""}
          </span>
        </div>
      `;
      })
      .join("");

    $("#rateLimitDetails").html(statusDetails);

    // Update queue status
    const queueStatus = this.requestQueue.getQueueStatus();
    if (queueStatus.running > 0 || queueStatus.queued > 0) {
      $("#rateLimitDetails").append(`
        <div class="d-flex justify-content-between align-items-center mt-1 pt-1" style="border-top: 1px solid #dee2e6;">
          <span style="font-size: 0.75rem;">Queue:</span>
          <span style="color: #0d6efd; font-weight: 500; font-size: 0.75rem;">
            ${queueStatus.running}/${queueStatus.maxConcurrent} active, ${queueStatus.queued} waiting
          </span>
        </div>
      `);
    }
  }

  // Start periodic rate limit status updates
  startRateLimitMonitoring() {
    // Update immediately
    this.updateRateLimitStatus();

    // Update every 5 seconds
    setInterval(() => {
      this.updateRateLimitStatus();
    }, 5000);
  }

  cleanup() {
    if (this.table) {
      this.table.destroy();
      this.table = null;
    }
  }

  // Check if data is fresh (within 15 minutes)
  checkDataFreshness() {
    const lastUpdate = localStorage.getItem("lastDataUpdate");
    if (!lastUpdate) return false;

    const now = new Date().getTime();
    const lastUpdateTime = parseInt(lastUpdate);
    const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds

    return now - lastUpdateTime < fifteenMinutes;
  }
}

// Inbound document cancellation with rate limiting
async function cancelInboundDocument(uuid) {
  const manager = InvoiceTableManager.getInstance();

  try {
    // Check rate limits for cancel operations
    const endpoint = "cancelDocument";
    const remainingRequests =
      manager.rateLimiter.getRemainingRequests(endpoint);
    const nextAvailable = manager.rateLimiter.getNextAvailableTime(endpoint);

    if (remainingRequests === 0 || nextAvailable > 0) {
      const waitTime = Math.ceil(Math.max(nextAvailable, 1000) / 1000);
      ToastManager.showRateLimit("Cancel operation rate limited", waitTime);
      return;
    }

    const modalEl = document.getElementById("inboundCancelModal");
    if (!modalEl) {
      throw new Error("Cancellation modal not found on page");
    }

    // Keep reference to triggering element for focus return
    const triggerEl = document.activeElement;

    // Reset form state
    const form = modalEl.querySelector("#inboundCancelForm");
    const reasonInput = modalEl.querySelector("#cancelReasonInput");
    const confirmBtn = modalEl.querySelector("#confirmInboundCancelBtn");

    form?.classList.remove("was-validated");
    if (reasonInput) {
      reasonInput.value = "";
      reasonInput.classList.remove("is-invalid");
      reasonInput.setAttribute("aria-invalid", "false");
    }

    // Attach uuid to modal dataset
    modalEl.dataset.uuid = uuid;

    const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);

    // Focus management when shown
    const onShown = () => {
      setTimeout(() => reasonInput?.focus(), 100);
    };
    modalEl.addEventListener("shown.bs.modal", onShown, { once: true });

    // Restore focus when hidden
    const onHidden = () => {
      if (triggerEl && typeof triggerEl.focus === "function") {
        triggerEl.focus();
      }
    };
    modalEl.addEventListener("hidden.bs.modal", onHidden, { once: true });

    // Confirm handler (one-time)
    const onConfirm = async () => {
      const value = reasonInput?.value?.trim();
      if (!value || value.length < 5) {
        reasonInput.classList.add("is-invalid");
        reasonInput.setAttribute("aria-invalid", "true");
        reasonInput.focus();
        return;
      }
      reasonInput.classList.remove("is-invalid");
      reasonInput.setAttribute("aria-invalid", "false");

      confirmBtn.disabled = true;
      confirmBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing...';

      try {
        bsModal.hide();

        Swal.fire({
          title: "Cancelling...",
          text: "Please wait while we process your cancellation request",
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading(),
        });

        // Wait for rate limit slot before making the API call
        await manager.rateLimiter.waitForSlot("cancelDocument");

        // Queue the cancel request to manage concurrency
        const data = await manager.requestQueue.add(async () => {
          const response = await fetch(`/api/outbound-files/${uuid}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: value }),
          });

          if (!response.ok) {
            // Handle rate limiting specifically
            if (response.status === 429) {
              const retryAfter = response.headers.get("retry-after") || 30;
              throw new Error(
                `Rate limited. Please wait ${retryAfter} seconds before trying again.`
              );
            }

            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              errorData.message ||
                errorData.error?.message ||
                `HTTP ${response.status}: Failed to cancel document`
            );
          }

          const result = await response.json();
          if (result.success === false) {
            throw new Error(
              result.message ||
                result.error?.message ||
                "Failed to cancel document"
            );
          }

          return result;
        }, 3); // Highest priority for cancel operations

        Swal.fire({
          icon: "success",
          title: "Cancelled",
          text: data.message || "Document cancelled successfully",
        });

        if (window.inboundDataTable) {
          window.inboundDataTable.ajax
            ? window.inboundDataTable.ajax.reload(null, false)
            : window.location.reload();
        } else {
          window.location.reload();
        }
      } catch (err) {
        console.error("Inbound cancellation failed:", err);
        Swal.fire({
          icon: "error",
          title: "Cancellation Failed",
          text: err.message || "Please try again later.",
        });
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML =
          '<i class="bi bi-exclamation-triangle me-1"></i>Confirm Cancellation';
      }
    };

    // Bind click and keyboard (Ctrl/Cmd+Enter) once per open
    confirmBtn.addEventListener("click", onConfirm, { once: true });
    const onKeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        confirmBtn.click();
      }
    };
    reasonInput.addEventListener("keydown", onKeydown, { once: true });

    bsModal.show();
  } catch (error) {
    console.error("Error preparing cancellation modal:", error);
    Swal.fire({
      icon: "error",
      title: "Error",
      text: error.message || "Unable to open cancellation dialog.",
    });
  }
}

// Countdown updater for cancellation window on inbound page
(function startInboundCountdowns() {
  const update = () => {
    document.querySelectorAll(".inbound-cancel-countdown").forEach((el) => {
      const validated = el.getAttribute("data-validated");
      if (!validated) {
        el.textContent = "Not Available";
        return;
      }
      const validatedDate = new Date(validated);
      const deadline = new Date(validatedDate.getTime() + 72 * 60 * 60 * 1000);
      const now = new Date();
      if (now >= deadline) {
        el.textContent = "Not Available";
        // Also disable related cancel button if present
        const uuid = el.getAttribute("data-uuid");
        const btn = document.querySelector(
          `.btn-cancel-inbound[data-uuid="${uuid}"]`
        );
        if (btn) {
          //btn.setAttribute("disabled", "disabled");
          btn.style.opacity = "0.5";
          btn.style.cursor = "not-allowed";
        }
        return;
      }
      const diff = deadline - now;
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      el.textContent = `${hours}h ${minutes}m ${seconds}s`;
    });
  };
  // Run immediately then every second
  update();
  setInterval(update, 1000);
})();

// Add CSS styles for loading states
const loadingStyles = `
  <style id="invoice-loading-styles">
    .outbound-action-btn.loading {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .spinner-border-sm {
      width: 0.875rem;
      height: 0.875rem;
    }
  </style>
`;

// Inject styles if not already present
if (!document.getElementById("invoice-loading-styles")) {
  document.head.insertAdjacentHTML("beforeend", loadingStyles);
}

// Rate limiting and loading state management
const viewInvoiceState = {
  activeRequests: new Set(),
  lastRequestTime: new Map(),
  RATE_LIMIT_MS: 2000, // 2 seconds between requests for same UUID
};

// Use global toast notification utility
// Available via window.toastNotification.success() and window.toastNotification.error()
// Helper function to map old API to new global toast API
function showToast(message, type = "info", duration = 3000) {
  if (type === "success") {
    return window.toastNotification.success("Success", message, duration);
  } else if (type === "error") {
    return window.toastNotification.error("Error", message, duration);
  } else if (type === "warning") {
    return window.toastNotification.error("Warning", message, duration);
  } else {
    return window.toastNotification.success("Info", message, duration);
  }
}

// Enhanced button state management
function setButtonLoading(uuid, loading = true) {
  const button = document.querySelector(`button[data-uuid="${uuid}"]`);
  if (!button) return;

  if (loading) {
    button.disabled = true;
    button.innerHTML =
      '<i class="spinner-border spinner-border-sm me-1"></i>Loading...';
    button.classList.add("loading");
  } else {
    button.disabled = false;
    button.innerHTML = '<i class="bi bi-eye me-1"></i>View';
    button.classList.remove("loading");
  }
}

async function viewInvoiceDetails(uuid) {
  const manager = InvoiceTableManager.getInstance();

  try {
    // Check if request is already in progress
    if (viewInvoiceState.activeRequests.has(uuid)) {
      showToast("Request already in progress. Please wait...", "warning");
      return;
    }

    // Check client-side cache first (15 minute cache)
    const cacheKey = `document_details_${uuid}`;
    const cachedData = sessionStorage.getItem(cacheKey);
    const cacheExpiry = sessionStorage.getItem(`${cacheKey}_expiry`);

    if (cachedData && cacheExpiry && Date.now() < parseInt(cacheExpiry)) {
      console.log(`Using cached document details for ${uuid}`);
      try {
        const parsedData = JSON.parse(cachedData);
        populateInvoiceModal(parsedData.documentInfo, uuid);

        // Show cache indicator
        showToast("Loaded from cache (faster response)", "info", 2000);
        return;
      } catch (e) {
        console.warn("Failed to parse cached data, fetching fresh data");
        sessionStorage.removeItem(cacheKey);
        sessionStorage.removeItem(`${cacheKey}_expiry`);
      }
    }

    // Enhanced rate limiting using the new RateLimiter
    const endpoint = "getDocumentDetails";
    const remainingRequests =
      manager.rateLimiter.getRemainingRequests(endpoint);
    const nextAvailable = manager.rateLimiter.getNextAvailableTime(endpoint);

    if (remainingRequests === 0 || nextAvailable > 0) {
      const waitTime = Math.max(nextAvailable, 1000);
      const waitSeconds = Math.ceil(waitTime / 1000);
      ToastManager.showRateLimit("Document details rate limited", waitSeconds);
      return;
    }

    // Check legacy rate limiting for backward compatibility
    const lastRequest = viewInvoiceState.lastRequestTime.get(uuid);
    const now = Date.now();
    if (lastRequest && now - lastRequest < viewInvoiceState.RATE_LIMIT_MS) {
      const remainingTime = Math.ceil(
        (viewInvoiceState.RATE_LIMIT_MS - (now - lastRequest)) / 1000
      );
      showToast(
        `Please wait ${remainingTime} seconds before trying again`,
        "warning"
      );
      return;
    }

    // Mark request as active and update timestamp
    viewInvoiceState.activeRequests.add(uuid);
    viewInvoiceState.lastRequestTime.set(uuid, now);

    // Set button loading state
    setButtonLoading(uuid, true);

    // Get the table row data first
    const table = $("#invoiceTable").DataTable();
    const rowData = table
      .rows()
      .data()
      .toArray()
      .find((row) => row.uuid === uuid);

    // Show loading state with rate limit info
    $("#modalLoadingOverlay").removeClass("d-none");

    // Show enhanced loading toast with queue info
    const queueStatus = manager.requestQueue.getQueueStatus();
    showToast(
      `Loading document details... (Queue: ${queueStatus.running}/${queueStatus.maxConcurrent} active)`,
      "info",
      3000
    );

    // Wait for rate limit slot
    await manager.rateLimiter.waitForSlot(endpoint);

    // Queue the request to manage concurrency
    const result = await manager.requestQueue.add(async () => {
      console.log(`Fetching document details for UUID: ${uuid}`);

      const response = await fetch(
        `/api/lhdn/documents/${uuid}/display-details`
      );

      console.log(`Response status: ${response.status} ${response.statusText}`);
      console.log(
        `Response headers:`,
        Object.fromEntries(response.headers.entries())
      );

      if (!response.ok) {
        // Handle rate limiting specifically
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after") || 30;
          throw new Error(
            `Rate limited. Please wait ${retryAfter} seconds before trying again.`
          );
        }

        // Try to get error details
        let errorData = {};
        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("application/json")) {
          try {
            errorData = await response.json();
          } catch (e) {
            console.warn("Failed to parse error response as JSON:", e);
          }
        } else {
          // If not JSON, get text for debugging
          const errorText = await response.text();
          console.error(
            "Non-JSON error response:",
            errorText.substring(0, 500)
          );
          errorData.message = `Server returned ${response.status}: ${response.statusText}`;
        }

        throw new Error(
          errorData.message ||
            `Failed to fetch document details (Status: ${response.status})`
        );
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const responseText = await response.text();
        console.error("Expected JSON but got:", contentType);
        console.error("Response text:", responseText.substring(0, 500));
        throw new Error("Server returned non-JSON response");
      }

      return response.json();
    }, 2); // High priority for document details

    //console.log("API Response:", result);

    if (!result.success) {
      throw new Error(result.message || "Failed to fetch invoice details");
    }

    // // Cache the successful response (15 minute cache)
    // const cacheKey = `document_details_${uuid}`;
    // const cacheExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes
    // try {
    //   sessionStorage.setItem(cacheKey, JSON.stringify(result));
    //   sessionStorage.setItem(`${cacheKey}_expiry`, cacheExpiry.toString());
    //   console.log(
    //     `Cached document details for ${uuid} (expires in 15 minutes)`
    //   );
    // } catch (e) {
    //   console.warn("Failed to cache document details:", e);
    // }

    // Parse document data if it exists
    if (result.documentInfo?.document) {
      try {
        const documentData = JSON.parse(result.documentInfo.document);
        //console.log("Parsed Document Data:", documentData);
        result.documentInfo.parsedDocument = documentData;
      } catch (parseError) {
        console.warn("Failed to parse document data:", parseError);
      }
    }

    const documentInfo = result.documentInfo;
    //console.log("Document Info:", documentInfo);

    // Check document status first
    if (documentInfo.status === "Invalid") {
      // Close any existing modals
      const existingModal = bootstrap.Modal.getInstance(
        document.getElementById("documentDetailsModal")
      );
      if (existingModal) {
        existingModal.hide();
      }

      // Show validation results modal
      await openValidationResultsModal(uuid);
      return;
    }

    if (documentInfo.status === "Submitted") {
      Swal.fire({
        icon: "warning",
        title: "Document Pending",
        text: "This document is still being processed. Please wait for validation to complete.",
        confirmButtonColor: "#ffc107",
      });
      return;
    }

    // Get the document details modal element
    const modalElement = document.getElementById("documentDetailsModal");
    if (!modalElement) {
      throw new Error("Document details modal element not found");
    }

    // Create and show document details modal
    const modal = new bootstrap.Modal(modalElement);

    // Only proceed to show modal if document is Valid or Cancelled
    if (["Valid", "Cancelled"].includes(documentInfo.status)) {
      await populateViewDetailsModal(modalElement, rowData, result);

      // Show modal
      modal.show();

      // Only load PDF for valid documents
      try {
        const pdfLoaded = await loadPDF(uuid, result);
        if (pdfLoaded) {
          // Show success toast only after PDF is loaded successfully
          showToast(
            "Document details and PDF loaded successfully",
            "success",
            2000
          );
        } else {
          // PDF loading was skipped (document not Valid/Cancelled)
          showToast("Document details loaded successfully", "success", 2000);
        }
      } catch (pdfError) {
        console.warn("PDF loading failed, but modal is still shown:", pdfError);
        // Show partial success toast if PDF fails but modal loads
        showToast(
          "Document details loaded (PDF generation failed)",
          "warning",
          3000
        );
      }
    } else {
      // For any other status
      showToast(
        `Document cannot be viewed when status is ${documentInfo.status}`,
        "warning",
        3000
      );
      Swal.fire({
        icon: "info",
        title: "Document Unavailable",
        text: `Document cannot be viewed when status is ${documentInfo.status}.`,
        confirmButtonColor: "#0dcaf0",
      });
    }
  } catch (error) {
    console.error("Error showing document details:", error);

    // Show error toast instead of SweetAlert for better UX
    let errorMessage = "Failed to show document details";
    if (error.message) {
      if (error.message.includes("429")) {
        errorMessage = "Too many requests. Please wait a moment and try again.";
      } else if (error.message.includes("500")) {
        errorMessage = "Server error. Please try again later.";
      } else {
        errorMessage = error.message;
      }
    }

    showToast(errorMessage, "error", 5000);

    // Also show SweetAlert for critical errors
    if (!error.message?.includes("429")) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: errorMessage,
      });
    }
  } finally {
    // Clean up loading states and active requests
    setButtonLoading(uuid, false);
    viewInvoiceState.activeRequests.delete(uuid);

    // Hide loading state
    $("#modalLoadingOverlay").addClass("d-none");
  }
}

// Function to populate the view details modal
async function populateViewDetailsModal(modalElement, rowData, result) {
  const documentInfo = result.documentInfo;

  // Debug logging to help identify mapping issues
  console.log("Modal Population Debug:", {
    result: result,
    documentInfo: documentInfo,
    rowData: rowData,
    supplierInfo: result.supplierInfo,
    customerInfo: result.customerInfo,
    paymentInfo: result.paymentInfo,
  });
  // Update modal header content
  const modalTitle = modalElement.querySelector(".modal-title");
  const modalInvoiceNumber = modalElement.querySelector(
    "#modal-invoice-number"
  );
  const statusBadge = modalElement.querySelector(".badge-status");

  modalTitle.innerHTML = '<i class="bi bi-file-text me-2"></i>Document Details';
  modalInvoiceNumber.textContent = `#${documentInfo.internalId}`;
  statusBadge.className = `badge-status ${documentInfo.status} me-3`;
  statusBadge.textContent = documentInfo.status;

  // Use the enhanced supplier info from the API response
  const supplierInfo = {
    company:
      result.supplierInfo?.company ||
      documentInfo.supplierInfo?.company ||
      documentInfo.supplierName ||
      rowData.issuerName ||
      "N/A",
    tin:
      result.supplierInfo?.tin ||
      documentInfo.supplierInfo?.tin ||
      documentInfo.supplierTIN ||
      rowData.issuerTIN ||
      null,
    registrationNo:
      result.supplierInfo?.registrationNo ||
      documentInfo.supplierInfo?.registrationNo ||
      documentInfo.supplierRegistrationNo ||
      rowData.issuerID ||
      null,
    taxRegNo:
      result.supplierInfo?.taxRegNo ||
      documentInfo.supplierInfo?.taxRegNo ||
      documentInfo.supplierSstNo ||
      rowData.issuerTaxRegNo ||
      null,
    msicCode:
      result.supplierInfo?.msicCode ||
      documentInfo.supplierInfo?.msicCode ||
      documentInfo.supplierMsicCode ||
      rowData.issuerMsicCode ||
      null,
    address:
      result.supplierInfo?.address ||
      documentInfo.supplierInfo?.address ||
      documentInfo.supplierAddress ||
      rowData.issuerAddress ||
      null,
  };

  // Use the enhanced customer info from the API response
  const customerInfo = {
    company:
      result.customerInfo?.company ||
      documentInfo.customerInfo?.company ||
      documentInfo.receiverName ||
      rowData.receiverName ||
      "N/A",
    tin:
      result.customerInfo?.tin ||
      documentInfo.customerInfo?.tin ||
      documentInfo.receiverTIN ||
      rowData.receiverTIN ||
      null,
    registrationNo:
      result.customerInfo?.registrationNo ||
      documentInfo.customerInfo?.registrationNo ||
      documentInfo.receiverRegistrationNo ||
      rowData.receiverId ||
      null,
    taxRegNo:
      result.customerInfo?.taxRegNo ||
      documentInfo.customerInfo?.taxRegNo ||
      documentInfo.receiverSstNo ||
      rowData.receiverTaxRegNo ||
      null,
    address:
      result.customerInfo?.address ||
      documentInfo.customerInfo?.address ||
      documentInfo.receiverAddress ||
      rowData.receiverAddress ||
      null,
  };

  // Use the enhanced payment info from the API response
  const paymentInfo = {
    totalIncludingTax:
      result.paymentInfo?.totalIncludingTax ||
      documentInfo.paymentInfo?.totalIncludingTax ||
      documentInfo.totalIncludingTax ||
      documentInfo.totalSales ||
      rowData.totalSales ||
      0,
    totalExcludingTax:
      result.paymentInfo?.totalExcludingTax ||
      documentInfo.paymentInfo?.totalExcludingTax ||
      documentInfo.totalExcludingTax ||
      rowData.totalExcludingTax ||
      0,
    taxAmount:
      result.paymentInfo?.taxAmount ||
      documentInfo.paymentInfo?.taxAmount ||
      documentInfo.taxAmount ||
      rowData.taxAmount ||
      0,
    totalPayableAmount:
      result.paymentInfo?.totalPayableAmount ||
      documentInfo.paymentInfo?.totalPayableAmount ||
      documentInfo.totalPayableAmount ||
      rowData.totalPayableAmount ||
      0,
    irbmUniqueNo: documentInfo.uuid || documentInfo.irbmUniqueNo,
    irbmlongId: documentInfo.longId || documentInfo.irbmlongId,
    irbmURL: documentInfo.longId
      ? `https://myinvois.hasil.gov.my/${documentInfo.uuid}/share/${documentInfo.longId}`
      : "N/A",
    uuid: documentInfo.uuid,
    longId: documentInfo.longId,
  };

  // Update info sections content
  const supplierContentDiv = modalElement.querySelector(
    "#supplier-info-content"
  );
  const buyerContentDiv = modalElement.querySelector("#buyer-info-content");
  const paymentContentDiv = modalElement.querySelector("#payment-info-content");

  supplierContentDiv.innerHTML = createSupplierContent(supplierInfo);
  buyerContentDiv.innerHTML = createBuyerContent(customerInfo);
  paymentContentDiv.innerHTML = createPaymentContent(paymentInfo);

  // Cancellation details for Cancelled documents
  const cancelSection = modalElement.querySelector(
    "#cancellation-info-section"
  );
  const cancelContent = modalElement.querySelector(
    "#cancellation-info-content"
  );
  const info = result.documentInfo || {};
  if (info.status === "Cancelled") {
    const reason =
      info.documentStatusReason ||
      rowData?.documentStatusReason ||
      "Not provided";
    const cancelledBy =
      info.cancelledByUsername || rowData?.cancelledBy || "Unknown";
    const when = info.cancelDateTime || rowData?.cancelDateTime || null;
    const whenDisplay = when ? new Date(when).toLocaleString() : "N/A";
    cancelContent.innerHTML = `
            <div class="info-row">
                <div class="label">REASON</div>
                <div class="value">${reason}</div>
            </div>
            <div class="info-row">
                <div class="label">CANCELLED BY</div>
                <div class="value">${cancelledBy}</div>
            </div>
            <div class="info-row">
                <div class="label">CANCELLED AT</div>
                <div class="value">${whenDisplay}</div>
            </div>
        `;
    cancelSection.style.display = "";
  } else {
    cancelSection.style.display = "none";
    cancelContent.innerHTML = "";
  }
}

// Helper functions to create content sections
function createSupplierContent(supplierInfo) {
  return `
        <div class="info-content">
            <div class="info-row">
                <div class="label">COMPANY NAME</div>
                <div class="value">${supplierInfo?.company || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX ID</div>
                <div class="value">${supplierInfo?.tin || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">REGISTRATION NO.</div>
                <div class="value">${
                  supplierInfo?.registrationNo || "N/A"
                }</div>
            </div>
            <div class="info-row">
                <div class="label">SST REGISTRATION</div>
                <div class="value">${supplierInfo?.taxRegNo || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">MSIC CODE</div>
                <div class="value">${supplierInfo?.msicCode || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">ADDRESS</div>
                <div class="value text-wrap">${
                  supplierInfo?.address || "N/A"
                }</div>
            </div>
        </div>
    `;
}

function createBuyerContent(customerInfo) {
  return `
        <div class="info-content">
            <div class="info-row">
                <div class="label">COMPANY NAME</div>
                <div class="value">${customerInfo?.company || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX ID</div>
                <div class="value">${customerInfo?.tin || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">REGISTRATION NO.</div>
                <div class="value">${
                  customerInfo?.registrationNo || "N/A"
                }</div>
            </div>
            <div class="info-row">
                <div class="label">SST REGISTRATION</div>
                <div class="value">${customerInfo?.taxRegNo || "N/A"}</div>
            </div>
            <div class="info-row">
                <div class="label">ADDRESS</div>
                <div class="value text-wrap small">${
                  customerInfo?.address || "N/A"
                }</div>
            </div>
        </div>
    `;
}

function createPaymentContent(paymentInfo) {
  const totalAmount = parseFloat(paymentInfo?.totalIncludingTax || 0);
  const subtotal = parseFloat(paymentInfo?.totalExcludingTax || 0);
  const taxAmount = parseFloat(paymentInfo?.taxAmount || 0);
  const totalPayableAmount = parseFloat(paymentInfo?.totalPayableAmount || 0);
  const uuid = paymentInfo?.uuid || "N/A";

  return `
        <style>


            .info-row {
                display: block; /* Maintain stacked layout */
                margin-bottom: 1rem;
                align-items: flex-start;
            }
            .info-row.highlight-row {
                background-color: #f1f5f9;
                padding: 0.8rem;
                border-radius: 4px;
                border-left: 4px solid #007bff;
            }
            .label {
                font-weight: 300;
                color: #6c757d;
                text-align: left;
                margin-bottom: 0.5rem;
            }
            .copy-icon {
                opacity: 0.6;
                transition: opacity 0.2s ease;
                margin-top: 2px;
            }
            .badge:hover .copy-icon {
                opacity: 1;
            }
            .value {
                font-size: 1rem;
                font-weight: 300;
                color: #212529;
                text-align: left; /* Changed to left-align for stacked layout */
                word-break: break-word;
            }
            .value span {
                font-size: 0.9rem;
                font-weight: 400;
            }

            .card {
                border: none;
                border-radius: 8px;
            }
            .supplier-card, .buyer-card {
                background-color: #ffffff;
            }
            .payment-card {
                background-color: #f8f9fa;
            }
            .copy-animation {
                animation: copyPulse 0.3s ease-in-out;
            }
            @keyframes copyPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            .badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
                color: #212529;
                line-height: 1.2;
                max-width: 100%;
                overflow-wrap: break-word;
                white-space: normal;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                user-select: none;
            }
            .badge:hover {
                background-color: #e9ecef;
            }
            .badge:active {
                transform: scale(0.98);
            }
            .copy-icon {
                opacity: 0.6;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
            }
            .badge:hover .copy-icon {
                opacity: 1;
            }
        </style>
        <div class="info-content">
            <div class="info-row highlight-row">
                <div class="label">TOTAL AMOUNT</div>
                <div class="value">${formatCurrency(totalAmount)}</div>
            </div>
            <div class="info-row">
                <div class="label">SUBTOTAL</div>
                <div class="value">${formatCurrency(subtotal)}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX AMOUNT</div>
                <div class="value">${formatCurrency(taxAmount)}</div>
            </div>
            <div class="info-row">
                <div class="label">TOTAL PAYABLE AMOUNT</div>
                <div class="value">${formatCurrency(totalPayableAmount)}</div>
            </div>
            <div class="info-row highlight-row">
                <div class="label">IRBM UNIQUE IDENTIFIER NO</div>
                <div class="value text-align-left">
                    <span
                        id="${uuid}"
                        class="badge bg-light text-dark border"
                        data-bs-toggle="tooltip"
                        data-bs-placement="top"
                        title="Click to copy"
                        onclick="copyToClipboard('${uuid}', '${uuid}') disabled"
                        style="cursor: pointer;"
                    >
                        ${uuid}
                        <span class="copy-icon">
                            <i class="bi bi-clipboard"></i>
                        </span>
                    </span>
                </div>
            </div>



        </div>
    `;
}
function showCustomAlert(url) {
  if (url === "N/A") {
    return; // Don't show anything if the URL is 'N/A'
  }

  // Show the custom confirmation popup
  const popup = document.getElementById("confirmationPopup");
  const confirmButton = document.getElementById("confirmButton");

  popup.style.display = "flex"; // Show the popup

  // When the "Yes" button is clicked, open the link in a new tab
  confirmButton.onclick = function () {
    window.open(url, "_blank"); // Open in a new tab
    closePopup(); // Close the popup
  };
}

function copyToClipboard(text, elementId) {
  // Don't copy if text is N/A
  if (!text || text === "N/A") {
    ToastManager.show("No valid text to copy", "error");
    return;
  }

  try {
    // Create temporary textarea
    const textarea = document.createElement("textarea");
    textarea.value = text;

    // Make it readonly to avoid focus and virtual keyboard on mobile
    textarea.setAttribute("readonly", "");

    // Hide the textarea
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";

    // Append to body
    document.body.appendChild(textarea);

    // Check if the device is iOS
    const isIOS = navigator.userAgent.match(/ipad|iphone/i);

    if (isIOS) {
      // Save current scroll position
      const scrollY = window.scrollY;

      // Create selection range
      const range = document.createRange();
      range.selectNodeContents(textarea);

      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      // Special handling for iOS
      textarea.setSelectionRange(0, textarea.value.length);

      // Restore scroll position
      window.scrollTo(0, scrollY);
    } else {
      // Select the text
      textarea.select();
    }

    // Copy the text
    const successful = document.execCommand("copy");

    // Remove the temporary textarea
    document.body.removeChild(textarea);

    if (successful) {
      // Show success message
      const customMessage =
        text.length > 20
          ? `Copied ${text.substring(0, 20)}... to clipboard!`
          : `Copied ${text} to clipboard!`;
      ToastManager.show(customMessage, "success");

      // Update visual feedback if elementId is provided
      if (elementId) {
        const element = document.getElementById(elementId);
        if (element) {
          // Update icon
          const icon = element.querySelector(".copy-icon");
          if (icon) {
            const originalHTML = icon.innerHTML;
            icon.innerHTML = '<i class="bi bi-check-lg"></i>';

            // Add animation class
            element.classList.add("copy-animation");

            // Reset after animation
            setTimeout(() => {
              element.classList.remove("copy-animation");
              icon.innerHTML = originalHTML;
            }, 2000);
          }

          // Update tooltip
          const tooltip = bootstrap.Tooltip.getInstance(element);
          if (tooltip) {
            tooltip.dispose();
            element.setAttribute("data-bs-original-title", "Copied!");
            const newTooltip = new bootstrap.Tooltip(element);
            newTooltip.show();

            // Reset tooltip after delay
            setTimeout(() => {
              newTooltip.dispose();
              element.setAttribute("data-bs-original-title", "Click to copy");
              new bootstrap.Tooltip(element);
            }, 2000);
          }
        }
      }
    } else {
      throw new Error("Copy command failed");
    }
  } catch (err) {
    console.error("Copy failed:", err);
    ToastManager.show("Failed to copy text. Please try again.", "error");
  }
}
// Close the popup when "Cancel" or the "×" button is clicked
function closePopup() {
  const popup = document.getElementById("confirmationPopup");
  popup.style.display = "none"; // Hide the popup
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-MY", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatAddressFromParts(address) {
  if (!address) return "N/A";

  const parts = [
    ...address.lines,
    address.city,
    address.postal,
    address.state,
    address.country,
  ].filter((part) => part && part !== "N/A");

  return parts.length > 0 ? parts.join(", ") : "N/A";
}

async function loadPDF(uuid, documentData) {
  // Only proceed if document is Valid or Cancelled
  if (!["Valid", "Cancelled"].includes(documentData.documentInfo.status)) {
    console.log(
      "PDF generation skipped - document status:",
      documentData.documentInfo.status
    );
    return false; // Return false to indicate PDF was not loaded
  }

  const manager = InvoiceTableManager.getInstance();
  const loadingKey = `pdf_${uuid}`;

  // Prevent concurrent PDF loads for the same document
  if (manager.loadingStates.has(loadingKey)) {
    console.log(`PDF already loading for ${uuid}, skipping duplicate request`);
    return false;
  }

  // Check if PDF is already loaded in the viewer
  const currentPdfViewer = $("#pdfViewer");
  if (currentPdfViewer.length > 0) {
    const currentSrc = currentPdfViewer.attr("src");
    if (currentSrc && currentSrc.includes(uuid)) {
      console.log(`PDF already loaded for ${uuid}, skipping reload`);
      return true;
    }
  }

  manager.loadingStates.set(loadingKey, true);

  try {
    // Initial loading state with enhanced progress container
    $(".pdf-viewer-container").html(`
            <div class="d-flex flex-column align-items-center justify-content-center h-100">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div id="pdf-progress" class="text-center">
                    <p class="text-muted mb-2" id="pdf-main-status">Initializing PDF generation...</p>
                    <small class="text-muted d-block" id="pdf-status-message"></small>
                    <div class="progress mt-2" style="width: 200px; height: 4px;">
                        <div class="progress-bar" role="progressbar" style="width: 0%"></div>
                    </div>
                </div>
            </div>
        `);

    // Function to update status with progress
    const updateStatus = (mainStatus, detailMessage = "", progress = 0) => {
      $("#pdf-main-status").text(mainStatus);
      $("#pdf-status-message").text(detailMessage);
      $(".progress-bar").css("width", `${progress}%`);
    };

    updateStatus(
      "Checking rate limits...",
      "Ensuring compliance with LHDN limits",
      10
    );

    // Use rate limiter for PDF generation requests
    await manager.rateLimiter.waitForSlot("getDocument");

    updateStatus("Checking PDF status...", "Looking for existing PDF file", 25);

    // Queue the PDF request to manage concurrency
    const pdfData = await manager.requestQueue.add(async () => {
      updateStatus("Processing request...", "Generating or retrieving PDF", 50);

      const response = await fetch(`/api/lhdn/documents/${uuid}/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(documentData),
      });

      if (!response.ok) {
        // Handle rate limiting specifically
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after") || 30;
          throw new Error(
            `Rate limited. Please wait ${retryAfter} seconds before trying again.`
          );
        }

        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: Failed to load PDF`
        );
      }

      return response.json();
    }, 1); // High priority for PDF requests

    console.log("PDF response:", pdfData);

    if (!pdfData.success) {
      throw new Error(pdfData.message || "Failed to load PDF");
    }

    if (pdfData.cached) {
      updateStatus(
        "Loading cached PDF...",
        "Using existing PDF from cache",
        75
      );
    } else {
      updateStatus("PDF generated successfully...", "Loading PDF viewer", 90);
    }

    // Load the PDF with cache busting
    const timestamp = new Date().getTime();
    const pdfUrl = `${pdfData.url}?t=${timestamp}`;

    updateStatus("Loading PDF viewer...", "Almost done", 95);

    // Short delay to show the final status message
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Create iframe for PDF with loading handler
    const iframeHtml = `
      <iframe id="pdfViewer"
              class="w-100 h-100"
              style="border: none;"
              src="${pdfUrl}"
              onload="this.style.opacity='1'"
              style="opacity: 0; transition: opacity 0.3s ease;">
      </iframe>
    `;

    $(".pdf-viewer-container").html(iframeHtml);
    updateStatus("PDF loaded successfully", "Ready for viewing", 100);

    // Hide progress after a short delay
    setTimeout(() => {
      $("#pdf-progress").fadeOut(300);
    }, 1000);

    // PDF loaded successfully
    return true;
  } catch (error) {
    console.error("Error loading PDF:", error);

    // Enhanced error handling with specific messages
    let errorMessage = error.message;
    let retryButton = "";

    if (error.message.includes("Rate limited")) {
      errorMessage =
        "Server is busy processing requests. Please wait a moment before trying again.";
      retryButton = `
        <button class="btn btn-outline-warning btn-sm ms-3"
                onclick="setTimeout(() => loadPDF('${uuid}', ${JSON.stringify(
        documentData
      ).replace(/"/g, "&quot;")}), 5000)">
          <i class="bi bi-clock me-1"></i>Retry in 5s
        </button>
      `;
    } else if (
      error.message.includes("Failed to launch") ||
      error.message.includes("chrome-pdf")
    ) {
      errorMessage =
        "PDF generation service is temporarily unavailable. Please try again later.";
      retryButton = `
        <button class="btn btn-outline-danger btn-sm ms-3"
                onclick="loadPDF('${uuid}', ${JSON.stringify(
        documentData
      ).replace(/"/g, "&quot;")})">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      `;
    } else {
      retryButton = `
        <button class="btn btn-outline-danger btn-sm ms-3"
                onclick="loadPDF('${uuid}', ${JSON.stringify(
        documentData
      ).replace(/"/g, "&quot;")})">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      `;
    }

    $(".pdf-viewer-container").html(`
            <div class="alert alert-danger m-3">
                <i class="bi bi-exclamation-triangle me-2"></i>
                <strong>PDF Loading Failed</strong><br>
                <small class="text-muted">${errorMessage}</small>
                ${retryButton}
            </div>
        `);

    // Re-throw the error so the calling function can handle it
    throw error;
  } finally {
    // Always clean up loading state
    manager.loadingStates.delete(loadingKey);
  }
}

async function openValidationResultsModal(uuid) {
  try {
    // Show loading state
    Swal.fire({
      title: "Loading...",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    const response = await fetch(`/api/lhdn/documents/${uuid}/display-details`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Failed to fetch validation results");
    }

    Swal.close();

    // Get the validation results container
    const validationResultsDiv = document.getElementById("validationResults");
    if (!validationResultsDiv) {
      throw new Error("Validation results container not found");
    }
    validationResultsDiv.innerHTML = "";

    // Extract validation results from the response
    const data = result.data || result;
    const validationResults =
      data.documentInfo?.validationResults ||
      data.validationResults ||
      data.detailsData.validationResults;

    console.log("Validation Results:", validationResults);

    if (!validationResults || !validationResults.validationSteps) {
      validationResultsDiv.innerHTML = `
                <div class="lhdn-validation-message error">
                    <i class="bi bi-exclamation-circle-fill"></i>
                    <span>No validation results available</span>
                </div>`;
      return;
    }

    validationResults.validationSteps.forEach((step, index) => {
      const stepDiv = document.createElement("div");
      stepDiv.classList.add("lhdn-validation-step");
      const isValid = step.status === "Valid";
      const statusClass = isValid ? "lhdn-step-valid" : "lhdn-step-invalid";
      const statusIcon = isValid ? "check-circle-fill" : "x-circle-fill";
      const cleanedName = step.name
        .replace(/Step[- ]?\d+/, "")
        .trim()
        .replace(/^[\.\-\s]+|[\.\-\s]+$/g, "");

      // Get all errors from the step
      const errors = step.error?.errors || [];
      const allInnerErrors =
        errors.length > 0
          ? errors.reduce((acc, err) => {
              if (err.innerError && Array.isArray(err.innerError)) {
                acc.push(...err.innerError);
              }
              return acc;
            }, [])
          : step.error?.innerError || [];

      const contentId = `collapse${index}`;
      stepDiv.innerHTML = `
                <div class="lhdn-step-header ${statusClass}" data-bs-toggle="collapse" data-bs-target="#${contentId}" aria-expanded="${!isValid}" aria-controls="${contentId}">
                    <div class="lhdn-step-title">
                        <i class="bi bi-${statusIcon}"></i>
                        <span>${cleanedName}</span>
                        ${
                          !isValid
                            ? `<span class="error-count">(${
                                allInnerErrors.length
                              } ${
                                allInnerErrors.length === 1 ? "error" : "errors"
                              })</span>`
                            : ""
                        }
                    </div>
                    <div class="lhdn-step-status">
                        ${isValid ? "Valid" : "Invalid"}
                        <i class="bi bi-chevron-down ms-2"></i>
                    </div>
                </div>
                <div id="${contentId}" class="lhdn-step-content collapse ${
        !isValid ? "show" : ""
      }" aria-labelledby="heading${index}">
                    ${
                      !isValid && allInnerErrors.length > 0
                        ? `
                                <div class="lhdn-validation-message">
                                    ${allInnerErrors
                                      .map(
                                        (err, i) => `
                                        ${
                                          i > 0
                                            ? '<div class="lhdn-inner-error mt-3">'
                                            : ""
                                        }
                                     <div class="lhdn-error-location">
                                        <strong class="lhdn-step-error">Field:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getFieldName(
                                          err.propertyPath
                                        )}</span>
                                    </div>
                                    <div class="lhdn-error-message">
                                        <strong class="lhdn-step-error">Issue:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorMessage(
                                          err.error
                                        )}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong class="lhdn-step-error">Error Type:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorType(
                                          err.errorCode
                                        )}</span>
                                    </div>
                                        ${i > 0 ? "</div>" : ""}

                                    `
                                      )
                                      .join("")}
                                    ${
                                      allInnerErrors.length > 1
                                        ? `
                                        <div class="error-summary mt-4">
                                            <div class="alert alert-danger">
                                                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                                <strong>Found ${allInnerErrors.length} validation issues in this step.</strong> Please fix all issues to proceed.
                                            </div>
                                        </div>
                                    `
                                        : ""
                                    }
                                </div>
                            `
                        : !isValid
                        ? `
                                <div class="lhdn-validation-message">
                                    <div class="alert alert-danger mb-3">
                                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                        <strong>Validation Error:</strong> Please fix the following issue to proceed.
                                    </div>
                                    <div class="lhdn-error-message">
                                        <strong>Issue:</strong>
                                        <span class="text-break lhdn-step-error">${ValidationTranslations.getErrorMessage(
                                          step.error?.error
                                        )}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong>Error Type:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorType(
                                          step.error?.errorCode
                                        )}</span>
                                    </div>
                                </div>
                            `
                        : '<div class="lhdn-validation-success"><i class="bi bi-check-circle-fill"></i>No errors found</div>'
                    }
                </div>
            `;
      validationResultsDiv.appendChild(stepDiv);

      // Initialize collapse functionality
      const collapseElement = document.getElementById(contentId);
      if (collapseElement) {
        new bootstrap.Collapse(collapseElement, {
          toggle: !isValid,
        });
      }
    });

    // Show the modal
    const modal = new bootstrap.Modal(
      document.getElementById("validationResultsModal")
    );

    // Add event listener for modal show
    const modalElement = document.getElementById("validationResultsModal");
    modalElement.addEventListener("shown.bs.modal", function () {
      // Reinitialize all collapses after modal is shown
      validationResultsDiv.querySelectorAll(".collapse").forEach((collapse) => {
        bootstrap.Collapse.getInstance(collapse)?.dispose();
        new bootstrap.Collapse(collapse, {
          toggle: collapse.classList.contains("show"),
        });
      });
    });

    // Add event listener for modal close
    modalElement.addEventListener(
      "hidden.bs.modal",
      function (e) {
        // Remove modal-specific classes and backdrop
        document.body.classList.remove("modal-open");
        const backdrop = document.querySelector(".modal-backdrop");
        if (backdrop) {
          backdrop.remove();
        }

        // Prevent event from bubbling up
        e.stopPropagation();

        // Adjust columns without redrawing the table
        if (inboundDataTable) {
          inboundDataTable.columns.adjust().draw(false);
        }
      },
      { once: true }
    );

    modal.show();
  } catch (error) {
    console.error("Error opening validation results:", error);
    Swal.fire({
      icon: "error",
      title: "Error",
      text: `Failed to load validation results: ${error.message}`,
    });
  }
}

// Initialize Charts
function initializeCharts() {
  // Document Status Distribution Chart
  const statusCtx = document
    .getElementById("documentStatusChart")
    .getContext("2d");
  const statusChart = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: ["Valid", "Invalid", "Cancelled", "Queue"],
      datasets: [
        {
          data: [15, 4, 8, 0], // Initial data, will be updated
          backgroundColor: [
            "rgba(25, 135, 84, 0.8)",
            "rgba(220, 53, 69, 0.8)",
            "rgba(255, 193, 7, 0.8)",
            "rgba(13, 110, 253, 0.8)",
          ],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });

  // Daily Submissions Chart
  const submissionsCtx = document
    .getElementById("dailySubmissionsChart")
    .getContext("2d");
  const submissionsChart = new Chart(submissionsCtx, {
    type: "line",
    data: {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      datasets: [
        {
          label: "Submissions",
          data: [12, 19, 3, 5, 2, 3, 7],
          borderColor: "rgba(13, 110, 253, 0.8)",
          tension: 0.4,
          fill: true,
          backgroundColor: "rgba(13, 110, 253, 0.1)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
          },
        },
      },
    },
  });

  // Processing Time Chart
  // const timeCtx = document
  //   .getElementById("processingTimeChart")
  //   .getContext("2d");
  // const timeChart = new Chart(timeCtx, {
  //   type: "bar",
  //   data: {
  //     labels: ["< 1min", "1-5min", "5-15min", "15-30min", "> 30min"],
  //     datasets: [
  //       {
  //         label: "Documents",
  //         data: [4, 8, 15, 3, 1],
  //         backgroundColor: "rgba(13, 110, 253, 0.8)",
  //         borderRadius: 4,
  //       },
  //     ],
  //   },
  //   options: {
  //     responsive: true,
  //     maintainAspectRatio: false,
  //     plugins: {
  //       legend: {
  //         display: false,
  //       },
  //     },
  //     scales: {
  //       y: {
  //         beginAtZero: true,
  //         ticks: {
  //           stepSize: 1,
  //         },
  //       },
  //     },
  //   },
  // });

  return { statusChart, submissionsChart };
}

// Quick Actions Event Handlers
function initializeQuickActions() {
  try {
    // Export All Documents
    const exportAllBtn = document.getElementById("exportAllBtn");
    if (exportAllBtn) {
      exportAllBtn.addEventListener("click", () => {
        const table = $("#invoiceTable").DataTable();
        const data = table.data().toArray();
        if (data.length === 0) {
          ToastManager.show("No documents available to export", "error");
          return;
        }
        // Trigger export for all documents with button reference
        exportToExcel(data, "all_documents", exportAllBtn);
      });
    }

    // Download Valid Documents
    const downloadValidBtn = document.getElementById("downloadValidBtn");
    if (downloadValidBtn) {
      downloadValidBtn.addEventListener("click", () => {
        const table = $("#invoiceTable").DataTable();
        const validDocs = table
          .data()
          .toArray()
          .filter((doc) => doc.status === "Valid");
        if (validDocs.length === 0) {
          ToastManager.show("No valid documents available", "error");
          return;
        }
        // Trigger export for valid documents with button reference
        exportToExcel(validDocs, "valid_documents", downloadValidBtn);
      });
    }

    // Export Invalid List
    const exportInvalidBtn = document.getElementById("exportInvalidBtn");
    if (exportInvalidBtn) {
      exportInvalidBtn.addEventListener("click", () => {
        const table = $("#invoiceTable").DataTable();
        const invalidDocs = table
          .data()
          .toArray()
          .filter((doc) => doc.status === "Invalid");
        if (invalidDocs.length === 0) {
          ToastManager.show("No invalid documents to export", "error");
          return;
        }
        // Trigger export for invalid documents with button reference
        exportToExcel(invalidDocs, "invalid_documents", exportInvalidBtn);
      });
    }

    // Refresh All Data
    const refreshDataBtn = document.getElementById("refreshDataBtn");
    if (refreshDataBtn) {
      refreshDataBtn.addEventListener("click", async () => {
        try {
          refreshDataBtn.disabled = true;
          refreshDataBtn.innerHTML =
            '<i class="bi bi-arrow-clockwise me-2 spin"></i>Refreshing...';

          const table = $("#invoiceTable").DataTable();
          const invoiceManager = InvoiceTableManager.getInstance();

          // Check if table has AJAX capability or use refresh method
          if (table.ajax && table.ajax.reload) {
            await table.ajax.reload();
          } else if (invoiceManager && invoiceManager.refresh) {
            await invoiceManager.refresh();
          } else {
            // Fallback to refreshing current data source
            if (invoiceManager && invoiceManager.refreshCurrentDataSource) {
              await invoiceManager.refreshCurrentDataSource();
            }
          }

          updateCharts(); // Update charts with new data
          ToastManager.show("Data refreshed successfully", "success");
        } catch (error) {
          console.error("Error refreshing data:", error);
          ToastManager.show("Failed to refresh data", "error");
        } finally {
          refreshDataBtn.disabled = false;
          refreshDataBtn.innerHTML =
            '<i class="bi bi-arrow-clockwise me-2"></i>Refresh All Data';
        }
      });
    }

    // Settings Dropdown Actions
    const settingsDropdown = document.getElementById("settingsDropdown");
    if (settingsDropdown) {
      // Initialize Bootstrap dropdown
      new bootstrap.Dropdown(settingsDropdown);

      // Add event listeners for dropdown items
      document.querySelectorAll(".dropdown-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.preventDefault();
          const action = e.target.textContent.trim();
          handleSettingsAction(action);
        });
      });
    }
  } catch (error) {
    console.error("Error initializing quick actions:", error);
    ToastManager.show("Failed to initialize quick actions", "error");
  }
}

// Helper function to handle settings actions
function handleSettingsAction(action) {
  const table = $("#invoiceTable").DataTable();

  switch (action) {
    case "Column Visibility":
      // Implement column visibility toggle
      ToastManager.show("Column visibility settings coming soon", "info");
      break;
    case "Default Sorting":
      // Implement sorting preferences
      ToastManager.show("Sorting preferences coming soon", "info");
      break;
    case "Filter Preferences":
      // Implement filter preferences
      ToastManager.show("Filter preferences coming soon", "info");
      break;
    case "Reset All Settings":
      // Reset all table settings
      try {
        table.state.clear();
        table.draw();
        ToastManager.show("All settings have been reset", "success");
      } catch (error) {
        console.error("Error resetting settings:", error);
        ToastManager.show("Failed to reset settings", "error");
      }
      break;
    default:
      console.warn("Unknown settings action:", action);
  }
}

// Helper function to export data to Excel with loading state management
function exportToExcel(data, filename, buttonElement = null) {
  let originalButtonHtml = null;

  try {
    // Manage button loading state if button is provided
    if (buttonElement) {
      originalButtonHtml = buttonElement.innerHTML;
      buttonElement.disabled = true;
      buttonElement.innerHTML =
        '<i class="bi bi-arrow-repeat spin me-1"></i>Exporting...';
    }

    // Add a small delay to show the loading state
    setTimeout(() => {
      try {
        // Convert data to CSV format
        const headers = [
          "UUID",
          "Long ID",
          "Internal ID",
          "Supplier",
          "Receiver",
          "Date Issued",
          "Status",
          "Total Amount",
        ];
        const csvContent = [
          headers.join(","),
          ...data.map((row) =>
            [
              row.uuid || "",
              row.longId || "",
              row.internalId || "",
              row.issuerName || row.supplierName || "",
              row.receiverName || "",
              formatDate(row.dateTimeIssued) || "",
              row.status || "",
              formatCurrency(row.totalSales) || "",
            ].join(",")
          ),
        ].join("\n");

        // Create and trigger download
        const blob = new Blob([csvContent], {
          type: "text/csv;charset=utf-8;",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${filename}_${
          new Date().toISOString().split("T")[0]
        }.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL
        URL.revokeObjectURL(link.href);

        ToastManager.show("Export completed successfully", "success");
      } catch (error) {
        console.error("Error exporting to Excel:", error);
        ToastManager.show("Failed to export data", "error");
      } finally {
        // Always restore button state if button was provided
        if (buttonElement && originalButtonHtml) {
          buttonElement.disabled = false;
          buttonElement.innerHTML = originalButtonHtml;
        }
      }
    }, 100); // Small delay to ensure loading state is visible
  } catch (error) {
    console.error("Error setting up export:", error);
    ToastManager.show("Failed to export data", "error");
    // Restore button state immediately if there's an error in setup
    if (buttonElement && originalButtonHtml) {
      buttonElement.disabled = false;
      buttonElement.innerHTML = originalButtonHtml;
    }
  }
}

// Enhanced Filter Functionality
function initializeEnhancedFilters() {
  const startDate = document.getElementById("startDate");
  const endDate = document.getElementById("endDate");
  const statusSelect = document.getElementById("documentStatus");
  const sourceSelect = document.getElementById("documentSource");

  // Apply filters when any filter changes
  [startDate, endDate, statusSelect, sourceSelect].forEach((element) => {
    element.addEventListener("change", () => {
      const table = $("#invoiceTable").DataTable();
      table.draw(); // This will trigger the custom filtering function
    });
  });

  // Reset filters
  document
    .querySelector(".enhanced-filter-section .btn-link")
    .addEventListener("click", () => {
      startDate.value = "";
      endDate.value = "";
      statusSelect.value = "";
      sourceSelect.value = "";
      $("#invoiceTable").DataTable().draw();
      ToastManager.show("Filters have been reset", "success");
    });
}

// Document Preview Functionality
function initializeDocumentPreview() {
  const previewSection = document.querySelector(".document-preview-section");

  // Show preview when clicking on a table row
  $("#invoiceTable tbody").on("click", "tr", function () {
    const table = $("#invoiceTable").DataTable();
    const data = table.row(this).data();
    if (!data) return;

    // Update preview data
    document.getElementById("previewDocId").textContent =
      data.internalId || "-";
    document.getElementById("previewStatus").textContent = data.status;
    document.getElementById(
      "previewStatus"
    ).className = `badge bg-${getStatusColor(data.status)}`;
    document.getElementById("previewDate").textContent =
      formatDate(data.dateTimeIssued) || "-";
    document.getElementById("previewAmount").textContent =
      formatCurrency(data.totalSales) || "-";

    // Show preview section
    previewSection.classList.remove("d-none");
  });

  // Close preview
  document
    .querySelector(".document-preview-section .btn-close")
    .addEventListener("click", () => {
      previewSection.classList.add("d-none");
    });
}

// Helper function to get status color
function getStatusColor(status) {
  const colors = {
    Valid: "success",
    Invalid: "danger",
    Cancelled: "warning",
    Queue: "info",
  };
  return colors[status] || "secondary";
}

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing enhanced features...");
  try {
    const charts = initializeCharts();

    // Initialize invoice table using singleton
    const invoiceManager = InvoiceTableManager.getInstance();

    // Initialize date/time display
    DateTimeManager.updateDateTime();

    console.log("Enhanced features initialized successfully");
  } catch (error) {
    console.error("Error initializing enhanced features:", error);
    Swal.fire({
      icon: "error",
      title: "Initialization Error",
      text: "Failed to initialize some features. Please refresh the page.",
      confirmButtonText: "Refresh",
      showCancelButton: true,
    }).then((result) => {
      if (result.isConfirmed) {
        window.location.reload();
      }
    });
  }
});

// Add helper methods to InvoiceTableManager class
InvoiceTableManager.prototype.showLoadingBackdrop = function (
  message = "Loading..."
) {
  // Remove any existing backdrop
  $("#loadingBackdrop").remove();

  const backdrop = $(`
        <div id="loadingBackdrop" class="loading-backdrop">
            <div class="loading-content">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="loading-message">${message}</div>
            </div>
        </div>
    `);

  $("body").append(backdrop);
  backdrop.fadeIn(200);
};

InvoiceTableManager.prototype.hideLoadingBackdrop = function () {
  $("#loadingBackdrop").fadeOut(200, function () {
    $(this).remove();
  });
};

InvoiceTableManager.prototype.showErrorMessage = function (message) {
  Swal.fire({
    icon: "error",
    title: "Error",
    text: message,
    confirmButtonText: "OK",
  });
};

function updateCharts() {
  try {
    const table = $("#invoiceTable").DataTable();
    if (!table) {
      console.warn("Table not initialized yet");
      return;
    }

    // Get all data from the table
    const allData = table.rows().data().toArray();

    // Status Distribution Chart Update
    const statusCounts = {
      Valid: 0,
      Invalid: 0,
      Cancelled: 0,
      Queue: 0,
    };

    // Process status counts
    allData.forEach((row) => {
      if (row.status === "Valid") statusCounts.Valid++;
      else if (row.status === "Invalid") statusCounts.Invalid++;
      else if (row.status === "Cancelled") statusCounts.Cancelled++;
      else if (["Submitted", "Pending", "Queued"].includes(row.status))
        statusCounts.Queue++;
    });

    // Update Status Chart
    const statusChart = Chart.getChart("documentStatusChart");
    if (statusChart) {
      statusChart.data.datasets[0].data = [
        statusCounts.Valid,
        statusCounts.Invalid,
        statusCounts.Cancelled,
        statusCounts.Queue,
      ];
      statusChart.update();
    }

    // Daily Submissions Chart Update
    const dailySubmissions = new Map();
    const last7Days = [];

    // Generate last 7 days dates
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      last7Days.push(dateStr);
      dailySubmissions.set(dateStr, 0);
    }

    // Count submissions per day
    allData.forEach((row) => {
      if (row.dateTimeReceived) {
        const submissionDate = new Date(row.dateTimeReceived)
          .toISOString()
          .split("T")[0];
        if (dailySubmissions.has(submissionDate)) {
          dailySubmissions.set(
            submissionDate,
            dailySubmissions.get(submissionDate) + 1
          );
        }
      }
    });

    // Update Daily Submissions Chart
    const submissionsChart = Chart.getChart("dailySubmissionsChart");
    if (submissionsChart) {
      submissionsChart.data.labels = last7Days.map((date) => {
        const d = new Date(date);
        return d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
      });
      submissionsChart.data.datasets[0].data = last7Days.map((date) =>
        dailySubmissions.get(date)
      );
      submissionsChart.update();
    }

    // // Processing Time Chart Update
    // const processingTimes = [0, 0, 0, 0, 0]; // [<1min, 1-5min, 5-15min, 15-30min, >30min]

    // allData.forEach((row) => {
    //   // Use processingTimeMinutes from backend if available
    //   const processingTime =
    //     typeof row.processingTimeMinutes === "number"
    //       ? row.processingTimeMinutes
    //       : null;
    //   if (processingTime !== null && !isNaN(processingTime)) {
    //     if (processingTime < 1) processingTimes[0]++;
    //     else if (processingTime < 5) processingTimes[1]++;
    //     else if (processingTime < 15) processingTimes[2]++;
    //     else if (processingTime < 30) processingTimes[3]++;
    //     else processingTimes[4]++;
    //   }
    // });

    // Update Processing Time Chart
    // const timeChart = Chart.getChart("processingTimeChart");
    // if (timeChart) {
    //   timeChart.data.datasets[0].data = processingTimes;
    //   timeChart.update();
    // }

    console.log("Charts updated with table data:", {
      statusCounts,
      dailySubmissions: Object.fromEntries(dailySubmissions),
      // processingTimes,
    });
  } catch (error) {
    console.error("Error updating charts:", error);
  }
}
