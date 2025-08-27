/**
 * Dashboard v2 - Clean External JavaScript
 * Handles all dashboard functionality without inline scripts
 */

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
    loadDashboardData();
});

function refreshDashboard() {
    console.log('Refreshing dashboard...');

    // Add visual feedback to refresh button
    const refreshBtn = document.querySelector('[onclick="checkLHDNStatus()"]');
    if (refreshBtn) {
        const originalContent = refreshBtn.innerHTML;
        refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise me-1 spin"></i>Refreshing...';
        refreshBtn.disabled = true;

        // Restore button after 2 seconds
        setTimeout(() => {
            refreshBtn.innerHTML = originalContent;
            refreshBtn.disabled = false;
        }, 2000);
    }

    loadDashboardData();
}

function loadDashboardData() {
    console.log('Loading dashboard data...');

    // Load all dashboard components
    loadCounts();
    loadSuccessRate();
    loadTopCustomers();
    loadStatusDistribution();
    loadWeeklyPerformance();
    loadActivityLogs();
    loadSDKUpdates();
    checkLHDNStatus();
    // Note: loadLastSync() is now integrated into checkLHDNStatus()
}

function loadCounts() {
    // Load outbound count
    fetch('/api/dashboard/outbound/count')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('outbound-count').textContent = data.count || 0;
            }
        })
        .catch(error => {
            console.error('Error loading outbound count:', error);
            document.getElementById('outbound-count').textContent = '0';
        });

    // Load inbound count
    fetch('/api/dashboard/inbound/count')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('inbound-count').textContent = data.count || 0;
            }
        })
        .catch(error => {
            console.error('Error loading inbound count:', error);
            document.getElementById('inbound-count').textContent = '0';
        });

    // Load company count
    fetch('/api/dashboard/companies/count')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('company-count').textContent = data.count || 0;
            }
        })
        .catch(error => {
            console.error('Error loading company count:', error);
            document.getElementById('company-count').textContent = '0';
        });
}

function loadSuccessRate() {
    fetch('/api/dashboard/success-rate')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const successRate = data.successRate || 0;
                document.getElementById('success-rate').textContent = successRate + '%';
            }
        })
        .catch(error => {
            console.error('Error loading success rate:', error);
            document.getElementById('success-rate').textContent = '0%';
        });
}

function loadTopCustomers() {
    const customersList = document.getElementById('top-customers-list');
    const loading = document.getElementById('customers-loading');
    const empty = document.getElementById('customers-empty');

    if (!customersList) return;

    fetch('/api/dashboard/top-customers')
        .then(response => response.json())
        .then(data => {
            if (loading) loading.classList.add('d-none');

            // Handle both array format and object format
            let customers = [];
            if (Array.isArray(data)) {
                customers = data;
            } else if (data.success && data.customers) {
                customers = data.customers;
            }

            if (customers && customers.length > 0) {
                customersList.innerHTML = customers.map(customer => {
                    // Handle different API response formats
                    const customerName = customer.name || customer.CompanyName || customer.buyerName || 'Unknown Customer';
                    const invoiceCount = customer.invoiceCount || customer.invoice_count || 0;
                    const totalAmount = customer.totalAmount || customer.total_amount || 0;

                    return `
                    <div class="d-flex align-items-center mb-3 p-2 rounded customer-item">
                        <div class="me-3">
                            <div class="avatar-wrapper" style="width: 40px; height: 40px; border-radius: 8px; background: #405189; color: white; display: flex; align-items: center; justify-content: center; font-weight: 600;">
                                ${customerName.substring(0, 2).toUpperCase()}
                            </div>
                        </div>
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6 class="mb-0 customer-name">${customerName}</h6>
                                <span class="badge bg-success-subtle text-success">${invoiceCount}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center mt-1">
                                <small class="text-muted">
                                    <i class="bi bi-file-earmark-text me-1"></i>
                                    ${invoiceCount} invoices
                                </small>
                                <span class="fw-semibold text-secondary">RM ${parseFloat(totalAmount || 0).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                    `;
                }).join('');
            } else {
                if (empty) empty.classList.remove('d-none');
            }
        })
        .catch(error => {
            console.error('Error loading top customers:', error);
            if (loading) loading.classList.add('d-none');
            if (empty) empty.classList.remove('d-none');
        });
}

function loadStatusDistribution() {
    const chartCanvas = document.getElementById('statusChart');
    if (!chartCanvas) {
        console.log('Status chart canvas not found');
        return;
    }

    fetch('/api/dashboard/invoice-status')
        .then(response => response.json())
        .then(data => {
            if (Array.isArray(data) && data.length > 0) {
                // API returns array directly
                createStatusChart(chartCanvas, data);
            } else if (data.success) {
                // API returns object with success property
                createStatusChart(chartCanvas, data);
            } else {
                console.error('Failed to load status distribution:', data.message || 'No data available');
                createDefaultStatusChart(chartCanvas);
            }
        })
        .catch(error => {
            console.error('Error loading status distribution:', error);
            createDefaultStatusChart(chartCanvas);
        });
}

function createStatusChart(canvas, data) {
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (window.statusChart && typeof window.statusChart.destroy === 'function') {
        window.statusChart.destroy();
    }

    // Handle both old format and new array format
    let chartLabels = [];
    let chartValues = [];
    let chartColors = [];

    if (Array.isArray(data)) {
        // New format: array of objects with status, count, percentage
        // Filter out statuses with 0 count for cleaner chart
        const filteredData = data.filter(item => item.count > 0);

        if (filteredData.length === 0) {
            // If no data, show a placeholder
            chartLabels = ['No Data'];
            chartValues = [1];
            chartColors = ['#e9ecef'];
        } else {
            filteredData.forEach(item => {
                chartLabels.push(item.status);
                chartValues.push(item.count);

                // Assign colors based on status
                switch(item.status.toLowerCase()) {
                    case 'submitted':
                        chartColors.push('#28a745'); // Green
                        break;
                    case 'pending':
                        chartColors.push('#ffc107'); // Yellow
                        break;
                    case 'valid':
                        chartColors.push('#17a2b8'); // Blue
                        break;
                    case 'invalid':
                        chartColors.push('#dc3545'); // Red
                        break;
                    case 'cancelled':
                        chartColors.push('#6c757d'); // Gray
                        break;
                    default:
                        chartColors.push('#6c757d'); // Default gray
                }
            });
        }
    } else {
        // Old format: object with properties
        chartLabels = ['Submitted', 'Pending', 'Valid', 'Invalid', 'Cancelled'];
        chartValues = [
            data.submitted || 0,
            data.pending || 0,
            data.valid || 0,
            data.invalid || 0,
            data.cancelled || 0
        ];
        chartColors = [
            '#28a745', // Submitted - Green
            '#ffc107', // Pending - Yellow
            '#17a2b8', // Valid - Blue
            '#dc3545', // Invalid - Red
            '#6c757d'  // Cancelled - Gray
        ];
    }

    const chartData = {
        labels: chartLabels,
        datasets: [{
            data: chartValues,
            backgroundColor: chartColors,
            borderWidth: 2,
            borderColor: '#fff'
        }]
    };

    console.log('Status Chart Data:', {
        labels: chartLabels,
        values: chartValues,
        colors: chartColors
    });

    window.statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

function createDefaultStatusChart(canvas) {
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (window.statusChart && typeof window.statusChart.destroy === 'function') {
        window.statusChart.destroy();
    }

    const defaultData = {
        labels: ['Submitted', 'Pending', 'Valid', 'Invalid', 'Cancelled'],
        datasets: [{
            data: [5, 3, 8, 2, 1],
            backgroundColor: [
                '#28a745', // Submitted - Green
                '#ffc107', // Pending - Yellow
                '#17a2b8', // Valid - Blue
                '#dc3545', // Invalid - Red
                '#6c757d'  // Cancelled - Gray
            ],
            borderWidth: 2,
            borderColor: '#fff'
        }]
    };

    window.statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: defaultData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

function loadWeeklyPerformance() {
    const chartCanvas = document.getElementById('weeklyChart');
    if (!chartCanvas) {
        console.log('Weekly chart canvas not found');
        return;
    }

    fetch('/api/dashboard/weekly-performance')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                createWeeklyChart(chartCanvas, data);
            } else {
                console.error('Failed to load weekly performance:', data.message);
                createWeeklyChart(chartCanvas);
            }
        })
        .catch(error => {
            console.error('Error loading weekly performance:', error);
            createWeeklyChart(chartCanvas);
        });
}

function createWeeklyChart(canvas, data = null) {
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (window.weeklyChart && typeof window.weeklyChart.destroy === 'function') {
        window.weeklyChart.destroy();
    }

    // Use API data if available, otherwise use default data
    let labels, outboundData, inboundData;

    if (data && data.labels && data.outbound && data.inbound) {
        labels = data.labels;
        outboundData = data.outbound;
        inboundData = data.inbound;
    } else {
        // Default data
        labels = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
        }
        outboundData = [12, 19, 8, 15, 22, 18, 25];
        inboundData = [8, 15, 12, 18, 16, 20, 22];
    }

    const chartData = {
        labels: labels,
        datasets: [
            {
                label: 'Outbound Invoices',
                data: outboundData,
                backgroundColor: 'rgba(30, 60, 114, 0.8)',
                borderColor: 'rgba(30, 60, 114, 1)',
                borderWidth: 2,
                borderRadius: 4,
                borderSkipped: false,
            },
            {
                label: 'Inbound Invoices',
                data: inboundData,
                backgroundColor: 'rgba(42, 82, 152, 0.8)',
                borderColor: 'rgba(42, 82, 152, 1)',
                borderWidth: 2,
                borderRadius: 4,
                borderSkipped: false,
            }
        ]
    };

    window.weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y} invoices`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        font: {
                            size: 11
                        },
                        callback: function(value) {
                            return value + ' invoices';
                        }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            }
        }
    });
}

// Global variable to track current activity page
let currentActivityPage = 1;

function loadActivityLogs(page = 1) {
    console.log('Loading activity logs, page:', page);
    const activityList = document.getElementById('activity-list');
    const loading = document.getElementById('activity-loading');

    if (!activityList) {
        console.log('Activity list element not found');
        return;
    }

    // Show loading if it's the first page
    if (page === 1 && loading) {
        loading.classList.remove('d-none');
    }

    fetch(`/api/dashboard-analytics/activity-logs?page=${page}&limit=5`)
        .then(response => response.json())
        .then(data => {
            console.log('Activity logs response:', data);
            if (loading) loading.classList.add('d-none');

            if (data.success && data.activities && data.activities.length > 0) {
                const activitiesHtml = data.activities.map(activity => `
                    <div class="activity-item">
                        <div class="activity-icon" style="background-color: ${getActivityColor(activity.type)};">
                            <i class="bi ${getActivityIcon(activity.type)}"></i>
                        </div>
                        <div class="activity-content">
                            <div class="activity-title">${activity.description}</div>
                            <div class="activity-meta">
                                <div class="activity-user">
                                    <i class="bi bi-person-fill me-1"></i>
                                    <span class="fw-semibold">${activity.username || 'System'}</span>
                                </div>
                                <div class="activity-time">
                                    <i class="bi bi-clock me-1"></i>
                                    ${formatDateTime(activity.timestamp)}
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('');

                // Add pagination controls
                const paginationHtml = createActivityPagination(data.pagination);

                activityList.innerHTML = activitiesHtml + paginationHtml;
                currentActivityPage = page;
            } else {
                activityList.innerHTML = `
                    <div class="text-center py-3">
                        <i class="bi bi-clock-history text-muted" style="font-size: 2rem;"></i>
                        <p class="text-muted mt-2 mb-0">No recent activities</p>
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('Error loading activity logs:', error);
            if (loading) loading.classList.add('d-none');
            if (activityList) {
                activityList.innerHTML = `
                    <div class="text-center py-3">
                        <i class="bi bi-exclamation-triangle text-warning" style="font-size: 2rem;"></i>
                        <p class="text-muted mt-2 mb-0">Error loading activities</p>
                    </div>
                `;
            }
        });
}

function createActivityPagination(pagination) {
    if (!pagination || pagination.totalPages <= 1) return '';

    return `
        <div class="activity-pagination mt-3 pt-3" style="border-top: 1px solid #e9ecef;">
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">
                    Page ${pagination.currentPage} of ${pagination.totalPages}
                    (${pagination.totalCount} total)
                </small>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-secondary"
                            onclick="loadActivityLogs(${pagination.currentPage - 1})"
                            ${!pagination.hasPrev ? 'disabled' : ''}>
                        <i class="bi bi-chevron-left"></i>
                    </button>
                    <button class="btn btn-outline-secondary"
                            onclick="loadActivityLogs(${pagination.currentPage + 1})"
                            ${!pagination.hasNext ? 'disabled' : ''}>
                        <i class="bi bi-chevron-right"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function loadSDKUpdates() {
    const sdkList = document.getElementById('sdk-updates-list');
    const loading = document.getElementById('sdk-loading');

    if (!sdkList) return;

    fetch('/api/dashboard/sdk-updates')
        .then(response => response.json())
        .then(data => {
            if (loading) loading.classList.add('d-none');

            if (data.success && data.updates && data.updates.length > 0) {
                sdkList.innerHTML = data.updates.map(update => `
                    <div class="d-flex align-items-start mb-3 p-3 rounded" style="background: white; border: 1px solid #e9ecef;">
                        <div class="me-3">
                            <div style="width: 40px; height: 40px; background: #405189; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                <i class="bi bi-download text-white"></i>
                            </div>
                        </div>
                        <div class="flex-grow-1">
                            <h6 class="mb-1" style="color: #2d3748; font-weight: 600;">${update.title}</h6>
                            <p class="text-muted mb-2" style="font-size: 0.875rem;">${update.description}</p>
                            <div class="d-flex justify-content-between align-items-center">
                                <small class="text-muted">${formatDate(update.date)}</small>
                                <a href="${update.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                                    <i class="bi bi-box-arrow-up-right me-1"></i>View
                                </a>
                            </div>
                        </div>
                    </div>
                `).join('');
            } else {
                showFallbackSDKUpdates();
            }
        })
        .catch(error => {
            console.error('Error loading SDK updates:', error);
            if (loading) loading.classList.add('d-none');
            showFallbackSDKUpdates();
        });
}

function showFallbackSDKUpdates() {
    const sdkList = document.getElementById('sdk-updates-list');
    if (!sdkList) return;

    sdkList.innerHTML = `
        <div class="d-flex align-items-start mb-3 p-3 rounded" style="background: white; border: 1px solid #e9ecef;">
            <div class="me-3">
                <div style="width: 40px; height: 40px; background: #405189; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                    <i class="bi bi-download text-white"></i>
                </div>
            </div>
            <div class="flex-grow-1">
                <h6 class="mb-1" style="color: #2d3748; font-weight: 600;">Version 1.2.0</h6>
                <p class="text-muted mb-2" style="font-size: 0.875rem;">Added support for new invoice formats</p>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted">2023-04-28</small>
                </div>
            </div>
        </div>
        <div class="d-flex align-items-start mb-3 p-3 rounded" style="background: white; border: 1px solid #e9ecef;">
            <div class="me-3">
                <div style="width: 40px; height: 40px; background: #405189; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                    <i class="bi bi-download text-white"></i>
                </div>
            </div>
            <div class="flex-grow-1">
                <h6 class="mb-1" style="color: #2d3748; font-weight: 600;">Version 1.1.5</h6>
                <p class="text-muted mb-2" style="font-size: 0.875rem;">Performance improvements and bug fixes</p>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted">2023-04-25</small>
                </div>
            </div>
        </div>
    `;
}

// Utility Functions
function getActivityColor(type) {
    const colors = {
        'invoice': '#405189',
        'success': '#28a745',
        'warning': '#ffc107',
        'error': '#dc3545',
        'info': '#17a2b8'
    };
    return colors[type] || '#405189';
}

function getActivityIcon(type) {
    const icons = {
        'invoice': 'bi-file-earmark-text',
        'success': 'bi-check-circle',
        'warning': 'bi-exclamation-triangle',
        'error': 'bi-x-circle',
        'info': 'bi-info-circle'
    };
    return icons[type] || 'bi-file-earmark-text';
}

function formatTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now - time) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} mins ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    return `${Math.floor(diffInSeconds / 86400)} days ago`;
}

function formatSyncTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInHours = Math.floor((now - time) / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInHours / 24);
    const diffInMinutes = Math.floor((now - time) / (1000 * 60));

    if (diffInMinutes < 60) {
        return diffInMinutes <= 1 ? 'Just now' : `${diffInMinutes} mins ago`;
    } else if (diffInHours < 24) {
        return diffInHours === 1 ? '1 hour ago' : `${diffInHours} hours ago`;
    } else {
        return diffInDays === 1 ? '1 day ago' : `${diffInDays} days ago`;
    }
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function checkLHDNStatus() {
    console.log('Checking LHDN system status...');

    // Get all the elements we need to update
    const statusElement = document.getElementById('lhdn-status');
    const lastCheckElement = document.getElementById('api-last-check');
    const environmentElement = document.getElementById('api-environment');
    const queueCountElement = document.getElementById('queue-count');
    const queueProgressElement = document.getElementById('queue-progress');
    const lastSyncTimeElement = document.getElementById('last-sync-time');
    const syncStatusElement = document.getElementById('sync-status');
    const onlineUsersElement = document.getElementById('online-users-count');
    const usersDetailsElement = document.getElementById('users-details');

    // Set loading states
    if (statusElement) {
        statusElement.innerHTML = '<i class="bi bi-circle-fill me-1" style="font-size: 0.6rem;"></i>Checking...';
        statusElement.className = 'badge me-2';
        statusElement.style.background = 'linear-gradient(135deg, #ffc107, #e0a800)';
        statusElement.style.color = 'white';
    }

    if (lastCheckElement) lastCheckElement.textContent = 'Checking...';
    if (environmentElement) environmentElement.textContent = 'Environment: Loading...';
    if (queueCountElement) queueCountElement.textContent = '...';
    if (lastSyncTimeElement) lastSyncTimeElement.textContent = 'Loading...';

    // Fetch comprehensive system status
    fetch('/api/dashboard/system-status')
        .then(response => response.json())
        .then(data => {
            console.log('System status response:', data);

            // Update API Connection Status
            if (statusElement) {
                const now = new Date();
                const timeString = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });

                if (data.apiHealthy) {
                    statusElement.innerHTML = '<i class="bi bi-circle-fill me-1" style="font-size: 0.6rem;"></i>Online';
                    statusElement.style.background = 'linear-gradient(135deg, #48bb78, #38a169)';
                    statusElement.style.color = 'white';
                } else {
                    statusElement.innerHTML = '<i class="bi bi-circle-fill me-1" style="font-size: 0.6rem;"></i>Offline';
                    statusElement.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
                    statusElement.style.color = 'white';
                }

                if (lastCheckElement) {
                    lastCheckElement.textContent = `Last checked: ${timeString}`;
                }
            }

            // Update Environment
            if (environmentElement && data.environment) {
                const envDisplay = data.environment.charAt(0).toUpperCase() + data.environment.slice(1);
                environmentElement.textContent = `Environment: ${envDisplay}`;
            }

            // Update Queue Status
            if (queueCountElement && typeof data.queueCount !== 'undefined') {
                queueCountElement.textContent = data.queueCount;

                // Update queue progress bar (simple visualization)
                if (queueProgressElement) {
                    const maxQueue = 100; // Assume max queue of 100 for progress calculation
                    const progressPercent = Math.min((data.queueCount / maxQueue) * 100, 100);
                    queueProgressElement.style.width = `${progressPercent}%`;

                    // Change color based on queue size
                    if (data.queueCount === 0) {
                        queueProgressElement.style.background = 'linear-gradient(90deg, #48bb78, #38a169)';
                    } else if (data.queueCount < 10) {
                        queueProgressElement.style.background = 'linear-gradient(90deg, #ed8936, #dd6b20)';
                    } else {
                        queueProgressElement.style.background = 'linear-gradient(90deg, #e53e3e, #c53030)';
                    }
                }
            }

            // Update Last Sync
            if (lastSyncTimeElement && data.lastSync) {
                const timeAgoText = formatSyncTimeAgo(data.lastSync);
                lastSyncTimeElement.textContent = timeAgoText;

                if (syncStatusElement) {
                    const syncDate = new Date(data.lastSync);
                    const now = new Date();
                    const diffInHours = Math.floor((now - syncDate) / (1000 * 60 * 60));
                    const diffInDays = Math.floor(diffInHours / 24);

                    if (diffInHours < 1) {
                        syncStatusElement.textContent = 'Synced';
                        syncStatusElement.style.background = 'linear-gradient(135deg, #48bb78, #38a169)';
                    } else if (diffInDays === 0) {
                        syncStatusElement.textContent = 'Recent';
                        syncStatusElement.style.background = 'linear-gradient(135deg, #ed8936, #dd6b20)';
                    } else if (diffInDays <= 2) {
                        syncStatusElement.textContent = 'Outdated';
                        syncStatusElement.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
                    } else {
                        syncStatusElement.textContent = 'Stale';
                        syncStatusElement.style.background = 'linear-gradient(135deg, #6c757d, #495057)';
                    }
                    syncStatusElement.style.color = 'white';
                }
            }

            // Update Online Users
            if (onlineUsersElement && typeof data.onlineUsers !== 'undefined') {
                onlineUsersElement.textContent = data.onlineUsers;
            }

            if (usersDetailsElement) {
                const activeCount = data.activeUsers || 0;
                const totalCount = data.onlineUsers || 0;

                if (activeCount > 0) {
                    usersDetailsElement.textContent = `${activeCount} active in last hour, ${totalCount} total registered`;
                } else {
                    usersDetailsElement.textContent = `${totalCount} total registered users in system`;
                }
            }

        })
        .catch(error => {
            console.error('Error checking LHDN system status:', error);

            // Set error states
            if (statusElement) {
                statusElement.innerHTML = '<i class="bi bi-circle-fill me-1" style="font-size: 0.6rem;"></i>Error';
                statusElement.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
                statusElement.style.color = 'white';
            }

            if (lastCheckElement) lastCheckElement.textContent = 'Last checked: Error';
            if (environmentElement) environmentElement.textContent = 'Environment: Unknown';
            if (queueCountElement) queueCountElement.textContent = '0';
            if (lastSyncTimeElement) lastSyncTimeElement.textContent = 'Error';
            if (syncStatusElement) {
                syncStatusElement.textContent = 'Error';
                syncStatusElement.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
                syncStatusElement.style.color = 'white';
            }
            if (onlineUsersElement) onlineUsersElement.textContent = '0';
        });
}

function loadLastSync() {
    const lastSyncElement = document.getElementById('last-sync-time');
    const lastSyncStatus = document.getElementById('sync-status');

    if (!lastSyncElement) return;

    // Set initial loading state
    lastSyncElement.textContent = 'Checking...';
    if (lastSyncStatus) {
        lastSyncStatus.className = 'badge bg-warning';
        lastSyncStatus.textContent = 'Checking...';
    }

    fetch('/api/dashboard-analytics/last-sync')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.lastSync) {
                lastSyncElement.textContent = data.lastSync.timeAgo;

                if (lastSyncStatus) {
                    if (data.lastSync.status === 'success') {
                        lastSyncStatus.className = 'badge bg-success';
                        lastSyncStatus.textContent = 'Synced';
                    } else if (data.lastSync.status === 'no-data') {
                        lastSyncStatus.className = 'badge bg-secondary';
                        lastSyncStatus.textContent = 'No Data';
                    } else {
                        lastSyncStatus.className = 'badge bg-warning';
                        lastSyncStatus.textContent = 'Unknown';
                    }
                }
            } else {
                lastSyncElement.textContent = 'Error checking';
                if (lastSyncStatus) {
                    lastSyncStatus.className = 'badge bg-danger';
                    lastSyncStatus.textContent = 'Error';
                }
            }
        })
        .catch(error => {
            console.error('Error fetching last sync:', error);
            lastSyncElement.textContent = 'Error checking';
            if (lastSyncStatus) {
                lastSyncStatus.className = 'badge bg-danger';
                lastSyncStatus.textContent = 'Error';
            }
        });
}

function initializeDashboard() {
    console.log('Dashboard v2 initialized');

    // Setup refresh button
    const refreshBtn = document.querySelector('[onclick="refreshDashboard()"]');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function(e) {
            e.preventDefault();
            refreshDashboard();
        });
    }

    // Setup auto-refresh every 5 minutes
    setInterval(loadDashboardData, 300000);

    // Update time display
    updateTimeDisplay();
    setInterval(updateTimeDisplay, 1000);
}

function updateTimeDisplay() {
    const timeElement = document.querySelector('.current-time');
    const dateElement = document.querySelector('.current-date');

    if (timeElement) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        timeElement.innerHTML = `<i class="bi bi-clock me-2"></i>${timeString}`;
    }

    if (dateElement) {
        const now = new Date();
        const dateString = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dateElement.innerHTML = `<i class="bi bi-calendar me-2"></i>${dateString}`;
    }
}

// Export functions for global access
window.refreshDashboard = refreshDashboard;
window.loadDashboardData = loadDashboardData;
window.loadActivityLogs = loadActivityLogs;
window.checkLHDNStatus = checkLHDNStatus;
