class DateTimeManager {
    static intervalId = null;

    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');

        function update() {
            const now = new Date();

            // Update time
            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }

            // Update date
            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }

        // Clear existing interval if any
        if (this.intervalId) {
            // Use managed cleanup if available
            if (window.managedClearInterval) {
                window.managedClearInterval(this.intervalId);
            } else {
                clearInterval(this.intervalId);
            }
        }

        // Update immediately and then every second
        update();

        // Use managed interval if available
        if (window.managedSetInterval) {
            this.intervalId = window.managedSetInterval(update, 1000);
        } else {
            this.intervalId = setInterval(update, 1000);
        }
    }

    static cleanup() {
        if (this.intervalId) {
            // Use managed cleanup if available
            if (window.managedClearInterval) {
                window.managedClearInterval(this.intervalId);
            } else {
                clearInterval(this.intervalId);
            }
            this.intervalId = null;
        }
    }
}

// Cleanup on page unload (fallback if memory manager not available)
window.addEventListener('beforeunload', () => {
    DateTimeManager.cleanup();
});

// Export the class
window.DateTimeManager = DateTimeManager;
