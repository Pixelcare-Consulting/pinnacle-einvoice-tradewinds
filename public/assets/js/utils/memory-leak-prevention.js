/**
 * Memory Leak Prevention Utility
 * Provides centralized management for intervals, timeouts, and event listeners
 * to prevent memory leaks in JavaScript applications
 */

class MemoryLeakPrevention {
    constructor() {
        this.intervals = new Set();
        this.timeouts = new Set();
        this.eventListeners = new Map();
        this.observers = new Set();
        this.isDestroyed = false;
        
        // Auto-cleanup on page unload
        this.setupAutoCleanup();
    }
    
    /**
     * Create a managed setInterval
     * @param {Function} callback - Function to execute
     * @param {number} delay - Delay in milliseconds
     * @returns {number} - Interval ID
     */
    setInterval(callback, delay) {
        if (this.isDestroyed) {
            console.warn('MemoryLeakPrevention: Cannot create interval after destruction');
            return null;
        }
        
        const intervalId = setInterval(callback, delay);
        this.intervals.add(intervalId);
        return intervalId;
    }
    
    /**
     * Create a managed setTimeout
     * @param {Function} callback - Function to execute
     * @param {number} delay - Delay in milliseconds
     * @returns {number} - Timeout ID
     */
    setTimeout(callback, delay) {
        if (this.isDestroyed) {
            console.warn('MemoryLeakPrevention: Cannot create timeout after destruction');
            return null;
        }
        
        const timeoutId = setTimeout(() => {
            // Auto-remove from tracking when timeout executes
            this.timeouts.delete(timeoutId);
            callback();
        }, delay);
        
        this.timeouts.add(timeoutId);
        return timeoutId;
    }
    
    /**
     * Clear a managed interval
     * @param {number} intervalId - Interval ID to clear
     */
    clearInterval(intervalId) {
        if (intervalId && this.intervals.has(intervalId)) {
            clearInterval(intervalId);
            this.intervals.delete(intervalId);
        }
    }
    
    /**
     * Clear a managed timeout
     * @param {number} timeoutId - Timeout ID to clear
     */
    clearTimeout(timeoutId) {
        if (timeoutId && this.timeouts.has(timeoutId)) {
            clearTimeout(timeoutId);
            this.timeouts.delete(timeoutId);
        }
    }
    
    /**
     * Add a managed event listener
     * @param {Element} element - DOM element
     * @param {string} event - Event type
     * @param {Function} listener - Event listener function
     * @param {Object|boolean} options - Event listener options
     */
    addEventListener(element, event, listener, options = false) {
        if (this.isDestroyed) {
            console.warn('MemoryLeakPrevention: Cannot add event listener after destruction');
            return;
        }
        
        if (!element || typeof element.addEventListener !== 'function') {
            console.warn('MemoryLeakPrevention: Invalid element for addEventListener');
            return;
        }
        
        element.addEventListener(event, listener, options);
        
        // Store for cleanup
        if (!this.eventListeners.has(element)) {
            this.eventListeners.set(element, []);
        }
        
        this.eventListeners.get(element).push({
            event,
            listener,
            options
        });
    }
    
    /**
     * Remove a specific event listener
     * @param {Element} element - DOM element
     * @param {string} event - Event type
     * @param {Function} listener - Event listener function
     * @param {Object|boolean} options - Event listener options
     */
    removeEventListener(element, event, listener, options = false) {
        if (!element || typeof element.removeEventListener !== 'function') {
            return;
        }
        
        element.removeEventListener(event, listener, options);
        
        // Remove from tracking
        if (this.eventListeners.has(element)) {
            const listeners = this.eventListeners.get(element);
            const index = listeners.findIndex(l => 
                l.event === event && 
                l.listener === listener && 
                l.options === options
            );
            
            if (index !== -1) {
                listeners.splice(index, 1);
                
                // Clean up empty arrays
                if (listeners.length === 0) {
                    this.eventListeners.delete(element);
                }
            }
        }
    }
    
    /**
     * Add a managed observer (MutationObserver, IntersectionObserver, etc.)
     * @param {Object} observer - Observer instance
     */
    addObserver(observer) {
        if (this.isDestroyed) {
            console.warn('MemoryLeakPrevention: Cannot add observer after destruction');
            return;
        }
        
        if (observer && typeof observer.disconnect === 'function') {
            this.observers.add(observer);
        }
    }
    
    /**
     * Remove and disconnect an observer
     * @param {Object} observer - Observer instance
     */
    removeObserver(observer) {
        if (observer && this.observers.has(observer)) {
            if (typeof observer.disconnect === 'function') {
                observer.disconnect();
            }
            this.observers.delete(observer);
        }
    }
    
    /**
     * Setup automatic cleanup on page unload
     */
    setupAutoCleanup() {
        const cleanup = () => this.destroy();
        
        // Multiple event types to ensure cleanup
        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('unload', cleanup);
        
        // For SPAs that might not trigger unload events
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    // Optional: cleanup when page becomes hidden
                    // Uncomment if needed for aggressive cleanup
                    // this.destroy();
                }
            });
        }
    }
    
    /**
     * Get current status of managed resources
     * @returns {Object} - Status object
     */
    getStatus() {
        return {
            intervals: this.intervals.size,
            timeouts: this.timeouts.size,
            eventListeners: this.eventListeners.size,
            observers: this.observers.size,
            isDestroyed: this.isDestroyed
        };
    }
    
    /**
     * Clean up all managed resources
     */
    destroy() {
        if (this.isDestroyed) {
            return;
        }
        
        console.log('MemoryLeakPrevention: Cleaning up resources...', this.getStatus());
        
        // Clear all intervals
        this.intervals.forEach(intervalId => {
            clearInterval(intervalId);
        });
        this.intervals.clear();
        
        // Clear all timeouts
        this.timeouts.forEach(timeoutId => {
            clearTimeout(timeoutId);
        });
        this.timeouts.clear();
        
        // Remove all event listeners
        this.eventListeners.forEach((listeners, element) => {
            listeners.forEach(({ event, listener, options }) => {
                try {
                    element.removeEventListener(event, listener, options);
                } catch (error) {
                    console.warn('Error removing event listener:', error);
                }
            });
        });
        this.eventListeners.clear();
        
        // Disconnect all observers
        this.observers.forEach(observer => {
            try {
                if (typeof observer.disconnect === 'function') {
                    observer.disconnect();
                }
            } catch (error) {
                console.warn('Error disconnecting observer:', error);
            }
        });
        this.observers.clear();
        
        this.isDestroyed = true;
        console.log('MemoryLeakPrevention: Cleanup completed');
    }
}

// Create a global instance
const globalMemoryManager = new MemoryLeakPrevention();

// Export for use in modules
window.MemoryLeakPrevention = MemoryLeakPrevention;
window.memoryManager = globalMemoryManager;

// Convenience functions for global use
window.managedSetInterval = (callback, delay) => globalMemoryManager.setInterval(callback, delay);
window.managedSetTimeout = (callback, delay) => globalMemoryManager.setTimeout(callback, delay);
window.managedClearInterval = (intervalId) => globalMemoryManager.clearInterval(intervalId);
window.managedClearTimeout = (timeoutId) => globalMemoryManager.clearTimeout(timeoutId);
window.managedAddEventListener = (element, event, listener, options) => 
    globalMemoryManager.addEventListener(element, event, listener, options);
window.managedRemoveEventListener = (element, event, listener, options) => 
    globalMemoryManager.removeEventListener(element, event, listener, options);
