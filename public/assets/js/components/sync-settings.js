/**
 * Sync Settings Component
 * Provides UI for managing LHDN sync strategies and optimization settings
 */

class SyncSettingsComponent {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.settings = {};
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.render();
        this.attachEventListeners();
    }

    async loadSettings() {
        try {
            const response = await fetch('/api/lhdn/sync/config');
            const data = await response.json();
            
            if (data.success) {
                this.settings = data.config;
            } else {
                console.error('Failed to load sync settings:', data.error);
                this.settings = this.getDefaultSettings();
            }
        } catch (error) {
            console.error('Error loading sync settings:', error);
            this.settings = this.getDefaultSettings();
        }
    }

    getDefaultSettings() {
        return {
            syncStrategy: 'incremental',
            incrementalSync: true,
            maxIncrementalPages: 5,
            syncThresholdMinutes: 15,
            rateLimitHandling: {
                enabled: true,
                adaptiveDelay: true,
                baseDelay: 500,
                maxDelay: 60000
            },
            paginationControl: {
                smartPagination: true,
                earlyStopThreshold: 10,
                maxConsecutiveErrors: 3,
                pageSize: 100
            }
        };
    }

    render() {
        this.container.innerHTML = `
            <div class="sync-settings-panel">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title">
                            <i class="fas fa-sync-alt"></i>
                            LHDN Sync Optimization Settings
                        </h5>
                    </div>
                    <div class="card-body">
                        <!-- Sync Strategy Section -->
                        <div class="settings-section">
                            <h6 class="section-title">Sync Strategy</h6>
                            <div class="form-group">
                                <label for="syncStrategy">Strategy Type</label>
                                <select id="syncStrategy" class="form-control">
                                    <option value="incremental" ${this.settings.syncStrategy === 'incremental' ? 'selected' : ''}>
                                        Incremental (Recommended)
                                    </option>
                                    <option value="full" ${this.settings.syncStrategy === 'full' ? 'selected' : ''}>
                                        Full Refresh
                                    </option>
                                    <option value="smart" ${this.settings.syncStrategy === 'smart' ? 'selected' : ''}>
                                        Smart Adaptive
                                    </option>
                                </select>
                                <small class="form-text text-muted">
                                    Incremental sync only fetches new documents, reducing API calls and rate limiting.
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="maxIncrementalPages">Max Incremental Pages</label>
                                <input type="number" id="maxIncrementalPages" class="form-control" 
                                       value="${this.settings.maxIncrementalPages}" min="1" max="20">
                                <small class="form-text text-muted">
                                    Limit incremental sync to prevent excessive API calls (1-20 pages).
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="syncThresholdMinutes">Sync Threshold (minutes)</label>
                                <input type="number" id="syncThresholdMinutes" class="form-control" 
                                       value="${this.settings.syncThresholdMinutes}" min="1" max="1440">
                                <small class="form-text text-muted">
                                    Minimum time between automatic syncs (1-1440 minutes).
                                </small>
                            </div>
                        </div>

                        <!-- Rate Limiting Section -->
                        <div class="settings-section">
                            <h6 class="section-title">Rate Limiting</h6>
                            <div class="form-check">
                                <input type="checkbox" id="rateLimitEnabled" class="form-check-input" 
                                       ${this.settings.rateLimitHandling.enabled ? 'checked' : ''}>
                                <label for="rateLimitEnabled" class="form-check-label">
                                    Enable Smart Rate Limiting
                                </label>
                            </div>
                            
                            <div class="form-check">
                                <input type="checkbox" id="adaptiveDelay" class="form-check-input" 
                                       ${this.settings.rateLimitHandling.adaptiveDelay ? 'checked' : ''}>
                                <label for="adaptiveDelay" class="form-check-label">
                                    Adaptive Delay Based on API Response
                                </label>
                            </div>
                        </div>

                        <!-- Pagination Control Section -->
                        <div class="settings-section">
                            <h6 class="section-title">Pagination Control</h6>
                            <div class="form-check">
                                <input type="checkbox" id="smartPagination" class="form-check-input" 
                                       ${this.settings.paginationControl.smartPagination ? 'checked' : ''}>
                                <label for="smartPagination" class="form-check-label">
                                    Smart Pagination (Stop Early on Existing Documents)
                                </label>
                            </div>
                            
                            <div class="form-group">
                                <label for="earlyStopThreshold">Early Stop Threshold</label>
                                <input type="number" id="earlyStopThreshold" class="form-control" 
                                       value="${this.settings.paginationControl.earlyStopThreshold}" min="1" max="50">
                                <small class="form-text text-muted">
                                    Stop pagination after finding this many consecutive existing documents.
                                </small>
                            </div>
                        </div>

                        <!-- Action Buttons -->
                        <div class="settings-actions">
                            <button type="button" id="saveSettings" class="btn btn-primary">
                                <i class="fas fa-save"></i> Save Settings
                            </button>
                            <button type="button" id="resetSettings" class="btn btn-secondary">
                                <i class="fas fa-undo"></i> Reset to Defaults
                            </button>
                            <button type="button" id="testSync" class="btn btn-info">
                                <i class="fas fa-play"></i> Test Background Sync
                            </button>
                        </div>

                        <!-- Status Display -->
                        <div id="settingsStatus" class="mt-3"></div>
                    </div>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Save settings
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });

        // Reset settings
        document.getElementById('resetSettings').addEventListener('click', () => {
            this.resetSettings();
        });

        // Test background sync
        document.getElementById('testSync').addEventListener('click', () => {
            this.testBackgroundSync();
        });

        // Real-time validation
        document.getElementById('maxIncrementalPages').addEventListener('input', (e) => {
            this.validateNumericInput(e.target, 1, 20);
        });

        document.getElementById('syncThresholdMinutes').addEventListener('input', (e) => {
            this.validateNumericInput(e.target, 1, 1440);
        });
    }

    validateNumericInput(input, min, max) {
        const value = parseInt(input.value);
        if (value < min || value > max) {
            input.classList.add('is-invalid');
        } else {
            input.classList.remove('is-invalid');
        }
    }

    async saveSettings() {
        try {
            const formData = this.collectFormData();
            
            const response = await fetch('/api/lhdn/sync/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();
            
            if (data.success) {
                this.showStatus('Settings saved successfully!', 'success');
                this.settings = { ...this.settings, ...formData };
            } else {
                this.showStatus('Failed to save settings: ' + data.error.message, 'error');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus('Error saving settings: ' + error.message, 'error');
        }
    }

    collectFormData() {
        return {
            syncStrategy: document.getElementById('syncStrategy').value,
            incrementalSync: document.getElementById('syncStrategy').value === 'incremental',
            maxIncrementalPages: parseInt(document.getElementById('maxIncrementalPages').value),
            syncThresholdMinutes: parseInt(document.getElementById('syncThresholdMinutes').value),
            rateLimitHandling: {
                enabled: document.getElementById('rateLimitEnabled').checked,
                adaptiveDelay: document.getElementById('adaptiveDelay').checked
            },
            paginationControl: {
                smartPagination: document.getElementById('smartPagination').checked,
                earlyStopThreshold: parseInt(document.getElementById('earlyStopThreshold').value)
            }
        };
    }

    async resetSettings() {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
            this.settings = this.getDefaultSettings();
            this.render();
            this.attachEventListeners();
            this.showStatus('Settings reset to defaults', 'info');
        }
    }

    async testBackgroundSync() {
        try {
            this.showStatus('Starting background sync test...', 'info');
            
            const response = await fetch('/api/lhdn/sync/background', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            
            if (data.success) {
                this.showStatus(`Background sync test completed: ${data.count} documents processed`, 'success');
            } else {
                this.showStatus('Background sync test failed: ' + data.error.message, 'error');
            }
        } catch (error) {
            console.error('Error testing background sync:', error);
            this.showStatus('Background sync test error: ' + error.message, 'error');
        }
    }

    showStatus(message, type) {
        const statusDiv = document.getElementById('settingsStatus');
        const alertClass = type === 'success' ? 'alert-success' : 
                          type === 'error' ? 'alert-danger' : 'alert-info';
        
        statusDiv.innerHTML = `
            <div class="alert ${alertClass} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert">
                    <span>&times;</span>
                </button>
            </div>
        `;

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 5000);
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncSettingsComponent;
} else if (typeof window !== 'undefined') {
    window.SyncSettingsComponent = SyncSettingsComponent;
}
