/**
 * Sync Settings Utility Module
 * Handles sync strategy configuration and optimization settings
 */

const SyncSettingsUtil = {
    // Default sync settings configuration
    defaults: {
        // Sync Strategy Settings
        syncStrategy: 'incremental', // 'incremental', 'full', 'smart'
        incrementalSync: true,
        maxIncrementalPages: 5,
        syncThresholdMinutes: 15,
        
        // Rate Limiting Settings
        rateLimitHandling: {
            enabled: true,
            adaptiveDelay: true,
            baseDelay: 500,
            maxDelay: 60000,
            jitterEnabled: true,
            maxJitter: 200
        },
        
        // Pagination Control
        paginationControl: {
            smartPagination: true,
            earlyStopThreshold: 10, // Stop if finding this many consecutive old documents
            maxConsecutiveErrors: 3,
            pageSize: 100
        },
        
        // Background Sync Settings
        backgroundSync: {
            enabled: true,
            intervalMinutes: 30,
            maxBackgroundPages: 3,
            lowPriorityDelay: 2000
        },
        
        // Performance Optimization
        performance: {
            cacheEnabled: true,
            cacheTTLMinutes: 15,
            batchSize: 50,
            concurrentRequests: 1, // Keep at 1 to avoid rate limits
            requestTimeout: 60000
        },
        
        // Fallback Settings
        fallback: {
            useDatabaseOnError: true,
            maxFallbackAge: 24, // hours
            retryFailedSync: true,
            retryIntervalMinutes: 60
        }
    },

    /**
     * Get sync settings from localStorage or use defaults
     */
    getSettings() {
        try {
            const stored = localStorage.getItem('lhdn_sync_settings');
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...this.defaults, ...parsed };
            }
        } catch (error) {
            console.warn('Error loading sync settings:', error);
        }
        return { ...this.defaults };
    },

    /**
     * Save sync settings to localStorage
     */
    saveSettings(settings) {
        try {
            const merged = { ...this.getSettings(), ...settings };
            localStorage.setItem('lhdn_sync_settings', JSON.stringify(merged));
            return true;
        } catch (error) {
            console.error('Error saving sync settings:', error);
            return false;
        }
    },

    /**
     * Get sync strategy configuration
     */
    getSyncStrategy() {
        const settings = this.getSettings();
        return {
            strategy: settings.syncStrategy,
            incremental: settings.incrementalSync,
            maxPages: settings.maxIncrementalPages,
            threshold: settings.syncThresholdMinutes
        };
    },

    /**
     * Update sync strategy
     */
    setSyncStrategy(strategy, options = {}) {
        const updates = {
            syncStrategy: strategy,
            ...options
        };
        
        // Validate strategy
        if (!['incremental', 'full', 'smart'].includes(strategy)) {
            throw new Error('Invalid sync strategy. Must be: incremental, full, or smart');
        }
        
        return this.saveSettings(updates);
    },

    /**
     * Get rate limiting configuration
     */
    getRateLimitConfig() {
        const settings = this.getSettings();
        return settings.rateLimitHandling;
    },

    /**
     * Update rate limiting settings
     */
    setRateLimitConfig(config) {
        return this.saveSettings({ rateLimitHandling: config });
    },

    /**
     * Get pagination control settings
     */
    getPaginationConfig() {
        const settings = this.getSettings();
        return settings.paginationControl;
    },

    /**
     * Get background sync settings
     */
    getBackgroundSyncConfig() {
        const settings = this.getSettings();
        return settings.backgroundSync;
    },

    /**
     * Enable/disable background sync
     */
    setBackgroundSync(enabled, options = {}) {
        const updates = {
            backgroundSync: {
                ...this.getBackgroundSyncConfig(),
                enabled,
                ...options
            }
        };
        return this.saveSettings(updates);
    },

    /**
     * Get performance optimization settings
     */
    getPerformanceConfig() {
        const settings = this.getSettings();
        return settings.performance;
    },

    /**
     * Get fallback settings
     */
    getFallbackConfig() {
        const settings = this.getSettings();
        return settings.fallback;
    },

    /**
     * Reset to default settings
     */
    resetToDefaults() {
        try {
            localStorage.removeItem('lhdn_sync_settings');
            return true;
        } catch (error) {
            console.error('Error resetting sync settings:', error);
            return false;
        }
    },

    /**
     * Validate sync settings
     */
    validateSettings(settings) {
        const errors = [];
        
        if (settings.syncStrategy && !['incremental', 'full', 'smart'].includes(settings.syncStrategy)) {
            errors.push('Invalid sync strategy');
        }
        
        if (settings.maxIncrementalPages && (settings.maxIncrementalPages < 1 || settings.maxIncrementalPages > 20)) {
            errors.push('Max incremental pages must be between 1 and 20');
        }
        
        if (settings.syncThresholdMinutes && (settings.syncThresholdMinutes < 1 || settings.syncThresholdMinutes > 1440)) {
            errors.push('Sync threshold must be between 1 and 1440 minutes');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    },

    /**
     * Get optimized settings for current conditions
     */
    getOptimizedSettings(conditions = {}) {
        const base = this.getSettings();
        const optimized = { ...base };
        
        // Adjust based on conditions
        if (conditions.highTraffic) {
            optimized.rateLimitHandling.baseDelay = 1000;
            optimized.maxIncrementalPages = 3;
            optimized.performance.concurrentRequests = 1;
        }
        
        if (conditions.lowBandwidth) {
            optimized.paginationControl.pageSize = 50;
            optimized.performance.requestTimeout = 120000;
        }
        
        if (conditions.frequentUpdates) {
            optimized.syncThresholdMinutes = 5;
            optimized.backgroundSync.intervalMinutes = 15;
        }
        
        return optimized;
    },

    /**
     * Export settings for backup
     */
    exportSettings() {
        return JSON.stringify(this.getSettings(), null, 2);
    },

    /**
     * Import settings from backup
     */
    importSettings(settingsJson) {
        try {
            const settings = JSON.parse(settingsJson);
            const validation = this.validateSettings(settings);
            
            if (!validation.valid) {
                throw new Error('Invalid settings: ' + validation.errors.join(', '));
            }
            
            return this.saveSettings(settings);
        } catch (error) {
            console.error('Error importing settings:', error);
            return false;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncSettingsUtil;
} else if (typeof window !== 'undefined') {
    window.SyncSettingsUtil = SyncSettingsUtil;
}
