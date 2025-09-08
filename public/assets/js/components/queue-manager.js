/**
 * Queue Management Component for E-Invoice System
 * Handles display and management of queued invoices
 */

class QueueManager {
    constructor(options = {}) {
        this.options = {
            containerId: 'queueContainer',
            autoRefresh: true,
            refreshInterval: 5000,
            maxDisplayItems: 50,
            ...options
        };
        
        this.queueData = [];
        this.refreshTimer = null;
        this.isInitialized = false;
        
        this.init();
    }
    
    init() {
        if (this.isInitialized) return;
        
        this.createQueueContainer();
        this.bindEvents();
        this.startAutoRefresh();
        this.isInitialized = true;
    }
    
    createQueueContainer() {
        const container = document.getElementById(this.options.containerId);
        if (!container) {
            console.error(`Queue container with ID '${this.options.containerId}' not found`);
            return;
        }
        
        container.innerHTML = this.getQueueHTML();
    }
    
    getQueueHTML() {
        return `
            <div class="queue-management-panel">
                <div class="queue-panel-header">
                    <h5 class="queue-panel-title">
                        <i class="bi bi-hourglass-split"></i>
                        Processing Queue
                    </h5>
                    <div class="queue-stats">
                        <div class="queue-stat-item">
                            <i class="bi bi-clock"></i>
                            <span class="queue-stat-value" id="queueCount">0</span>
                            <span>Queued</span>
                        </div>
                        <div class="queue-stat-item">
                            <i class="bi bi-gear"></i>
                            <span class="queue-stat-value" id="processingCount">0</span>
                            <span>Processing</span>
                        </div>
                        <div class="queue-stat-item">
                            <i class="bi bi-speedometer2"></i>
                            <span class="queue-stat-value" id="avgProcessingTime">--</span>
                            <span>Avg Time</span>
                        </div>
                    </div>
                </div>
                <div class="queue-item-list" id="queueItemList">
                    ${this.getEmptyStateHTML()}
                </div>
            </div>
        `;
    }
    
    getEmptyStateHTML() {
        return `
            <div class="queue-empty-state">
                <div class="queue-empty-icon">
                    <i class="bi bi-check-circle"></i>
                </div>
                <div class="queue-empty-title">Queue is Empty</div>
                <div class="queue-empty-message">All invoices have been processed successfully</div>
            </div>
        `;
    }
    
    renderQueueItem(item, index) {
        const estimatedTime = this.calculateETA(index);
        const queuePosition = index + 1;
        const isPriority = item.priority > 0;
        
        return `
            <div class="queue-item ${isPriority ? 'priority' : ''}" data-invoice-id="${item.invoiceId}">
                <div class="queue-item-header">
                    <div class="queue-item-invoice">${item.invoiceNumber}</div>
                    <div class="queue-item-time">${this.formatTime(item.queuedAt)}</div>
                </div>
                <div class="queue-item-details">
                    <div class="queue-item-position">
                        ${isPriority ? '<i class="bi bi-star-fill"></i>' : ''} 
                        Position #${queuePosition}
                    </div>
                    <div class="queue-item-eta">
                        <i class="bi bi-clock"></i> ETA: ${estimatedTime}
                    </div>
                </div>
                <div class="queue-progress-bar">
                    <div class="queue-progress-fill" style="width: ${this.calculateProgress(index)}%"></div>
                </div>
                <div class="queue-item-actions">
                    ${!isPriority ? `
                        <button class="queue-action-btn priority" onclick="queueManager.setPriority('${item.invoiceId}')">
                            <i class="bi bi-star"></i> Priority
                        </button>
                    ` : ''}
                    <button class="queue-action-btn" onclick="queueManager.viewDetails('${item.invoiceId}')">
                        <i class="bi bi-eye"></i> Details
                    </button>
                    <button class="queue-action-btn cancel" onclick="queueManager.cancelFromQueue('${item.invoiceId}')">
                        <i class="bi bi-x"></i> Cancel
                    </button>
                </div>
            </div>
        `;
    }
    
    updateQueue(queueData) {
        this.queueData = queueData || [];
        this.renderQueue();
        this.updateStats();
    }
    
    renderQueue() {
        const listContainer = document.getElementById('queueItemList');
        if (!listContainer) return;
        
        if (this.queueData.length === 0) {
            listContainer.innerHTML = this.getEmptyStateHTML();
            return;
        }
        
        const queueHTML = this.queueData
            .slice(0, this.options.maxDisplayItems)
            .map((item, index) => this.renderQueueItem(item, index))
            .join('');
            
        listContainer.innerHTML = queueHTML;
    }
    
    updateStats() {
        const queueCount = this.queueData.filter(item => item.status === 'queued').length;
        const processingCount = this.queueData.filter(item => item.status === 'processing').length;
        const avgTime = this.calculateAverageProcessingTime();
        
        this.updateElement('queueCount', queueCount);
        this.updateElement('processingCount', processingCount);
        this.updateElement('avgProcessingTime', avgTime);
    }
    
    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }
    
    calculateETA(position) {
        const avgProcessingTime = 30; // seconds per invoice
        const estimatedSeconds = position * avgProcessingTime;
        
        if (estimatedSeconds < 60) {
            return `${estimatedSeconds}s`;
        } else if (estimatedSeconds < 3600) {
            return `${Math.round(estimatedSeconds / 60)}m`;
        } else {
            return `${Math.round(estimatedSeconds / 3600)}h`;
        }
    }
    
    calculateProgress(position) {
        const totalItems = this.queueData.length;
        if (totalItems === 0) return 0;
        
        // Items closer to front have higher progress
        return Math.max(0, 100 - (position / totalItems) * 100);
    }
    
    calculateAverageProcessingTime() {
        // This would typically come from historical data
        return "45s";
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        
        return date.toLocaleDateString();
    }
    
    // Queue Management Actions
    async setPriority(invoiceId) {
        try {
            const response = await fetch(`/api/queue/${invoiceId}/priority`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                this.showToast('Invoice moved to priority queue', 'success');
                this.refreshQueue();
            } else {
                throw new Error('Failed to set priority');
            }
        } catch (error) {
            this.showToast('Failed to set priority: ' + error.message, 'error');
        }
    }
    
    async cancelFromQueue(invoiceId) {
        const confirmed = await this.showConfirmDialog(
            'Cancel Queue Item',
            'Are you sure you want to remove this invoice from the queue?'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/queue/${invoiceId}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                this.showToast('Invoice removed from queue', 'success');
                this.refreshQueue();
            } else {
                throw new Error('Failed to cancel queue item');
            }
        } catch (error) {
            this.showToast('Failed to cancel: ' + error.message, 'error');
        }
    }
    
    viewDetails(invoiceId) {
        // Trigger the existing invoice details modal
        if (window.showInvoiceDetails) {
            window.showInvoiceDetails(invoiceId);
        } else {
            this.showToast('Details view not available', 'warning');
        }
    }
    
    async refreshQueue() {
        try {
            const response = await fetch('/api/queue/status');
            const data = await response.json();
            
            if (response.ok) {
                this.updateQueue(data.queue || []);
            } else {
                throw new Error(data.message || 'Failed to fetch queue data');
            }
        } catch (error) {
            console.error('Failed to refresh queue:', error);
            this.showToast('Failed to refresh queue data', 'error');
        }
    }
    
    startAutoRefresh() {
        if (!this.options.autoRefresh) return;
        
        this.refreshTimer = setInterval(() => {
            this.refreshQueue();
        }, this.options.refreshInterval);
    }
    
    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    
    bindEvents() {
        // Bind refresh button if it exists
        const refreshBtn = document.querySelector('[data-queue-refresh]');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshQueue());
        }
        
        // Handle visibility change to pause/resume auto-refresh
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopAutoRefresh();
            } else {
                this.startAutoRefresh();
            }
        });
    }
    
    // Utility methods
    showToast(message, type = 'info') {
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
    
    async showConfirmDialog(title, message) {
        if (window.CustomModal) {
            const result = await window.CustomModal.show({
                title,
                text: message,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, Cancel',
                cancelButtonText: 'Keep in Queue'
            });
            return result.isConfirmed;
        }
        return confirm(message);
    }
    
    destroy() {
        this.stopAutoRefresh();
        this.isInitialized = false;
    }
}

// Global queue manager instance
let queueManager = null;

// Initialize queue manager when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if queue container exists
    if (document.getElementById('queueContainer')) {
        queueManager = new QueueManager();
    }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QueueManager;
}
