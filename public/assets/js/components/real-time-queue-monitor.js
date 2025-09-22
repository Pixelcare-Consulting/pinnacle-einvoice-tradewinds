/**
 * Real-time Queue Monitor Component
 * Provides live monitoring of LHDN processing queue with precise timing
 */

class RealTimeQueueMonitor {
    constructor(options = {}) {
        this.options = {
            containerId: 'realTimeQueueMonitor',
            updateInterval: 15000, // 15 seconds for real-time updates
            maxDisplayItems: 10,
            showProcessingTimes: true,
            ...options
        };
        
        this.queueData = [];
        this.updateTimer = null;
        this.isInitialized = false;
        this.lastUpdate = null;
        
        this.init();
    }
    
    init() {
        if (this.isInitialized) return;
        
        this.createContainer();
        this.startRealTimeUpdates();
        this.bindEvents();
        this.isInitialized = true;
    }
    
    createContainer() {
        const container = document.getElementById(this.options.containerId);
        if (!container) {
            console.error(`Real-time queue container with ID '${this.options.containerId}' not found`);
            return;
        }
        
        container.innerHTML = this.getContainerHTML();
    }
    
    getContainerHTML() {
        return `
            <div class="real-time-queue-monitor">
                <div class="queue-header">
                    <h6 class="mb-0">
                        <i class="bi bi-broadcast text-primary me-2"></i>
                        Live Processing Queue
                    </h6>
                    <div class="queue-status">
                        <span class="status-indicator" id="queueStatusIndicator"></span>
                        <small class="text-muted" id="lastUpdateTime">Connecting...</small>
                    </div>
                </div>
                <div class="queue-content" id="queueContent">
                    <div class="loading-state">
                        <div class="spinner-border spinner-border-sm text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <span class="ms-2">Loading queue data...</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    async startRealTimeUpdates() {
        // Initial load
        await this.updateQueueData();
        
        // Set up periodic updates
        this.updateTimer = setInterval(() => {
            this.updateQueueData();
        }, this.options.updateInterval);
    }
    
    async updateQueueData() {
        try {
            const response = await fetch('/api/lhdn-analytics/queue-status');
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    this.queueData = result.data.queue || [];
                    this.lastUpdate = new Date(result.data.lastUpdated);
                    this.renderQueue();
                    this.updateStatus('connected');
                }
            } else {
                throw new Error(`API call failed with status ${response.status}`);
            }
        } catch (error) {
            console.error('Error updating queue data:', error);
            this.updateStatus('error');
        }
    }
    
    renderQueue() {
        const contentContainer = document.getElementById('queueContent');
        if (!contentContainer) return;
        
        if (this.queueData.length === 0) {
            contentContainer.innerHTML = this.getEmptyQueueHTML();
            return;
        }
        
        const queueItems = this.queueData
            .slice(0, this.options.maxDisplayItems)
            .map(item => this.renderQueueItem(item))
            .join('');
            
        contentContainer.innerHTML = `
            <div class="queue-items">
                ${queueItems}
            </div>
        `;
        
        // Update last update time
        this.updateLastUpdateTime();
    }
    
    renderQueueItem(item) {
        const processingTime = item.currentProcessingTime;
        const isLongProcessing = processingTime.minutes > 120; // More than 2 hours
        
        return `
            <div class="queue-item ${isLongProcessing ? 'long-processing' : ''}" data-invoice-id="${item.uuid}">
                <div class="queue-item-header">
                    <div class="invoice-info">
                        <span class="invoice-id">${item.internalId || item.uuid}</span>
                        <span class="queue-position">#${item.queuePosition}</span>
                    </div>
                    <div class="processing-time">
                        <span class="time-value ${this.getTimeClass(processingTime.minutes)}">${processingTime.formatted}</span>
                        <small class="time-label">processing</small>
                    </div>
                </div>
                <div class="queue-item-details">
                    <div class="status-info">
                        <span class="status-badge status-${item.status.toLowerCase()}">${item.status}</span>
                        <span class="submission-time">
                            Submitted: ${this.formatSubmissionTime(item.submissionTime)}
                        </span>
                    </div>
                    ${item.estimatedCompletion ? `
                        <div class="eta-info">
                            <i class="bi bi-clock text-muted"></i>
                            <span class="eta-text">ETA: ${item.estimatedCompletion.formatted}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="progress-indicator">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${this.calculateProgress(processingTime.minutes)}%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    getTimeClass(minutes) {
        if (minutes < 5) return 'time-fresh';
        if (minutes < 30) return 'time-normal';
        if (minutes < 120) return 'time-moderate';
        return 'time-long';
    }
    
    calculateProgress(minutes) {
        // Assume average processing time is 2 hours (120 minutes)
        const averageTime = 120;
        const progress = Math.min((minutes / averageTime) * 100, 100);
        return Math.round(progress);
    }
    
    formatSubmissionTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        
        return date.toLocaleDateString();
    }
    
    getEmptyQueueHTML() {
        return `
            <div class="empty-queue">
                <div class="empty-icon">
                    <i class="bi bi-check-circle text-success"></i>
                </div>
                <div class="empty-message">
                    <h6>No invoices in queue</h6>
                    <p class="text-muted mb-0">All invoices have been processed</p>
                </div>
            </div>
        `;
    }
    
    updateStatus(status) {
        const indicator = document.getElementById('queueStatusIndicator');
        if (!indicator) return;
        
        indicator.className = `status-indicator status-${status}`;
        
        switch (status) {
            case 'connected':
                indicator.title = 'Connected - Real-time updates active';
                break;
            case 'error':
                indicator.title = 'Connection error - Retrying...';
                break;
            default:
                indicator.title = 'Connecting...';
        }
    }
    
    updateLastUpdateTime() {
        const timeElement = document.getElementById('lastUpdateTime');
        if (timeElement && this.lastUpdate) {
            const timeStr = this.lastUpdate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            timeElement.textContent = `Last updated: ${timeStr}`;
        }
    }
    
    bindEvents() {
        // Handle visibility change to pause/resume updates
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseUpdates();
            } else {
                this.resumeUpdates();
            }
        });
        
        // Handle window focus/blur
        window.addEventListener('focus', () => {
            this.resumeUpdates();
        });
        
        window.addEventListener('blur', () => {
            this.pauseUpdates();
        });
    }
    
    pauseUpdates() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }
    
    resumeUpdates() {
        if (!this.updateTimer) {
            this.startRealTimeUpdates();
        }
    }
    
    destroy() {
        this.pauseUpdates();
        this.isInitialized = false;
    }
}

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('realTimeQueueMonitor')) {
        window.realTimeQueueMonitor = new RealTimeQueueMonitor();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (window.realTimeQueueMonitor) {
        window.realTimeQueueMonitor.destroy();
    }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RealTimeQueueMonitor;
}
