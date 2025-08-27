/**
 * Security Dashboard JavaScript
 */

let refreshInterval;

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', function() {
    loadDashboard();
    
    // Set up auto-refresh every 30 seconds
    refreshInterval = setInterval(loadDashboard, 30000);
    
    // Set up timeframe selector
    document.getElementById('timeframeSelect').addEventListener('change', function() {
        loadLoginStats(this.value);
    });
});

// Load complete dashboard data
async function loadDashboard() {
    try {
        await Promise.all([
            loadSecurityStats(),
            loadBlacklist(),
            loadSecurityLogs(),
            loadLoginStats()
        ]);
        
        updateLastRefresh();
    } catch (error) {
        console.error('Dashboard load error:', error);
        showAlert('Failed to load dashboard data', 'danger');
    }
}

// Load security statistics
async function loadSecurityStats() {
    try {
        const response = await fetch('/api/security-admin/dashboard');
        const result = await response.json();
        
        if (result.success) {
            const stats = result.data.stats;
            document.getElementById('blacklistedCount').textContent = stats.blacklistedIPs;
            document.getElementById('trackedCount').textContent = stats.trackedIPs;
            document.getElementById('rateLimitedCount').textContent = stats.rateLimitedIPs;
        }
    } catch (error) {
        console.error('Load stats error:', error);
    }
}

// Load blacklisted IPs
async function loadBlacklist() {
    try {
        const response = await fetch('/api/security-admin/blacklist');
        const result = await response.json();
        
        if (result.success) {
            renderBlacklist(result.data);
        }
    } catch (error) {
        console.error('Load blacklist error:', error);
        document.getElementById('blacklistContainer').innerHTML = 
            '<div class="text-danger">Failed to load blacklist</div>';
    }
}

// Render blacklist items
function renderBlacklist(blacklistEntries) {
    const container = document.getElementById('blacklistContainer');
    
    if (blacklistEntries.length === 0) {
        container.innerHTML = '<div class="text-muted text-center">No blacklisted IPs</div>';
        return;
    }
    
    const html = blacklistEntries.map(entry => `
        <div class="blacklist-item p-3 mb-2 rounded">
            <div class="d-flex justify-content-between align-items-start">
                <div>
                    <h6 class="mb-1">
                        <i class="fas fa-ban text-danger me-2"></i>${entry.ip}
                    </h6>
                    <p class="mb-1 text-muted small">${entry.reason}</p>
                    <small class="text-muted">
                        <i class="fas fa-clock me-1"></i>
                        Expires: ${new Date(entry.expiresAt).toLocaleString()}
                    </small>
                </div>
                <button class="btn btn-sm btn-outline-success" 
                        onclick="removeFromBlacklist('${entry.ip}')"
                        title="Remove from blacklist">
                    <i class="fas fa-check"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = html;
}

// Load recent security logs
async function loadSecurityLogs() {
    try {
        const response = await fetch('/api/security-admin/logs?limit=20');
        const result = await response.json();
        
        if (result.success) {
            renderSecurityLogs(result.data);
        }
    } catch (error) {
        console.error('Load security logs error:', error);
        document.getElementById('securityLogsContainer').innerHTML = 
            '<div class="text-danger">Failed to load security logs</div>';
    }
}

// Render security logs
function renderSecurityLogs(logs) {
    const container = document.getElementById('securityLogsContainer');
    
    if (logs.length === 0) {
        container.innerHTML = '<div class="text-muted text-center">No recent security events</div>';
        return;
    }
    
    const html = logs.map(log => {
        const statusClass = getStatusClass(log.status);
        const actionIcon = getActionIcon(log.action);
        
        return `
            <div class="log-entry p-2">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <i class="${actionIcon} me-2"></i>
                            <span class="fw-bold">${log.description}</span>
                            <span class="badge bg-secondary ms-2">${log.action}</span>
                        </div>
                        <div class="small text-muted">
                            <i class="fas fa-user me-1"></i>${log.username || 'System'}
                            <i class="fas fa-globe ms-2 me-1"></i>${log.ipAddress || 'N/A'}
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="${statusClass} small fw-bold">${log.status}</div>
                        <div class="small text-muted">
                            ${new Date(log.createdAt).toLocaleTimeString()}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

// Load login attempt statistics
async function loadLoginStats(timeframe = '24h') {
    try {
        const response = await fetch(`/api/security-admin/stats/attempts?timeframe=${timeframe}`);
        const result = await response.json();
        
        if (result.success) {
            renderLoginStats(result.data);
            document.getElementById('successRate').textContent = result.data.successRate + '%';
        }
    } catch (error) {
        console.error('Load login stats error:', error);
        document.getElementById('statsContainer').innerHTML = 
            '<div class="text-danger">Failed to load statistics</div>';
    }
}

// Render login statistics
function renderLoginStats(stats) {
    const container = document.getElementById('statsContainer');
    
    const html = `
        <div class="row">
            <div class="col-md-3">
                <div class="text-center">
                    <h4 class="text-primary">${stats.totalAttempts}</h4>
                    <p class="mb-0">Total Attempts</p>
                </div>
            </div>
            <div class="col-md-3">
                <div class="text-center">
                    <h4 class="text-success">${stats.successfulLogins}</h4>
                    <p class="mb-0">Successful</p>
                </div>
            </div>
            <div class="col-md-3">
                <div class="text-center">
                    <h4 class="text-danger">${stats.failedLogins}</h4>
                    <p class="mb-0">Failed</p>
                </div>
            </div>
            <div class="col-md-3">
                <div class="text-center">
                    <h4 class="text-info">${stats.uniqueIPs}</h4>
                    <p class="mb-0">Unique IPs</p>
                </div>
            </div>
        </div>
        <div class="mt-3">
            <div class="progress" style="height: 20px;">
                <div class="progress-bar bg-success" role="progressbar" 
                     style="width: ${stats.successRate}%" 
                     aria-valuenow="${stats.successRate}" aria-valuemin="0" aria-valuemax="100">
                    ${stats.successRate}% Success
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// Show add blacklist modal
function showAddBlacklistModal() {
    const modal = new bootstrap.Modal(document.getElementById('addBlacklistModal'));
    modal.show();
}

// Add IP to blacklist
async function addToBlacklist() {
    const ip = document.getElementById('ipAddress').value.trim();
    const reason = document.getElementById('reason').value.trim();
    const duration = document.getElementById('duration').value;
    
    if (!ip) {
        showAlert('IP address is required', 'danger');
        return;
    }
    
    // Basic IP validation
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip)) {
        showAlert('Invalid IP address format', 'danger');
        return;
    }
    
    try {
        const response = await fetch('/api/security-admin/blacklist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ip,
                reason: reason || 'Manually blacklisted by admin',
                duration: duration ? parseInt(duration) * 60 * 60 * 1000 : null // Convert hours to milliseconds
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showAlert(result.message, 'success');
            bootstrap.Modal.getInstance(document.getElementById('addBlacklistModal')).hide();
            document.getElementById('addBlacklistForm').reset();
            loadBlacklist(); // Refresh blacklist
            loadSecurityStats(); // Refresh stats
        } else {
            showAlert(result.message, 'danger');
        }
    } catch (error) {
        console.error('Add to blacklist error:', error);
        showAlert('Failed to add IP to blacklist', 'danger');
    }
}

// Remove IP from blacklist
async function removeFromBlacklist(ip) {
    if (!confirm(`Are you sure you want to remove ${ip} from the blacklist?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/security-admin/blacklist/${encodeURIComponent(ip)}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showAlert(result.message, 'success');
            loadBlacklist(); // Refresh blacklist
            loadSecurityStats(); // Refresh stats
        } else {
            showAlert(result.message, 'danger');
        }
    } catch (error) {
        console.error('Remove from blacklist error:', error);
        showAlert('Failed to remove IP from blacklist', 'danger');
    }
}

// Refresh entire dashboard
function refreshDashboard() {
    const refreshBtn = document.querySelector('.refresh-btn i');
    refreshBtn.classList.add('fa-spin');
    
    loadDashboard().finally(() => {
        refreshBtn.classList.remove('fa-spin');
    });
}

// Utility functions
function getStatusClass(status) {
    switch (status) {
        case 'SUCCESS': return 'status-success';
        case 'FAILED': return 'status-failed';
        case 'WARNING': return 'status-warning';
        default: return 'text-muted';
    }
}

function getActionIcon(action) {
    switch (action) {
        case 'BLOCK': return 'fas fa-ban text-danger';
        case 'UNBLOCK': return 'fas fa-check text-success';
        case 'DETECT': return 'fas fa-eye text-warning';
        case 'LOGIN': return 'fas fa-sign-in-alt text-info';
        default: return 'fas fa-info-circle text-muted';
    }
}

function showAlert(message, type) {
    const alertContainer = document.getElementById('alertContainer');
    const alertId = 'alert-' + Date.now();
    
    const alertHtml = `
        <div id="${alertId}" class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    alertContainer.insertAdjacentHTML('beforeend', alertHtml);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        const alertElement = document.getElementById(alertId);
        if (alertElement) {
            bootstrap.Alert.getOrCreateInstance(alertElement).close();
        }
    }, 5000);
}

function updateLastRefresh() {
    const now = new Date().toLocaleTimeString();
    console.log(`Dashboard refreshed at ${now}`);
}

// Clean up interval when page unloads
window.addEventListener('beforeunload', function() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});
