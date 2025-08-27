/**
 * Dashboard v2 - Modern Analytics Dashboard
 * Enhanced with smooth animations, real-time updates, and responsive design
 */

class DashboardV2 {
    constructor() {
        this.charts = {};
        this.updateInterval = null;
        this.animationDelay = 100;
        
        this.init();
    }

    async init() {
        console.log('Initializing Dashboard v2...');
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    async setup() {
        try {
            // Add staggered animation to cards
            this.animateCards();
            
            // Initialize charts
            await this.initializeCharts();
            
            // Load initial data
            await this.loadDashboardData();
            
            // Setup real-time updates
            this.setupRealTimeUpdates();
            
            // Setup event listeners
            this.setupEventListeners();
            
            console.log('Dashboard v2 initialized successfully');
        } catch (error) {
            console.error('Error initializing Dashboard v2:', error);
            this.showErrorState();
        }
    }

    animateCards() {
        const cards = document.querySelectorAll('.modern-card');
        cards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(30px)';
            
            setTimeout(() => {
                card.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, index * this.animationDelay);
        });
    }

    async initializeCharts() {
        // Initialize Weekly Performance Chart
        await this.initWeeklyChart();
        
        // Initialize Status Distribution Chart
        await this.initStatusChart();
    }

    async initWeeklyChart() {
        const ctx = document.getElementById('weeklyChart');
        if (!ctx) return;

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.8)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.1)');

        this.charts.weekly = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [{
                    label: 'Invoices Processed',
                    data: [12, 19, 15, 25, 22, 18, 24],
                    borderColor: '#6366f1',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 3,
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#6366f1',
                        borderWidth: 1,
                        cornerRadius: 8,
                        displayColors: false
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        border: {
                            display: false
                        },
                        ticks: {
                            color: '#6b7280',
                            font: {
                                family: 'Inter',
                                size: 12,
                                weight: '500'
                            }
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)',
                            drawBorder: false
                        },
                        border: {
                            display: false
                        },
                        ticks: {
                            color: '#6b7280',
                            font: {
                                family: 'Inter',
                                size: 12,
                                weight: '500'
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                animation: {
                    duration: 2000,
                    easing: 'easeInOutQuart'
                }
            }
        });
    }

    async initStatusChart() {
        const container = document.getElementById('statusChart');
        if (!container) return;

        const options = {
            series: [44, 55, 13, 43],
            chart: {
                type: 'donut',
                height: 350,
                fontFamily: 'Inter, sans-serif'
            },
            labels: ['Valid', 'Pending', 'Invalid', 'Cancelled'],
            colors: ['#10b981', '#f59e0b', '#ef4444', '#6b7280'],
            plotOptions: {
                pie: {
                    donut: {
                        size: '70%',
                        labels: {
                            show: true,
                            total: {
                                show: true,
                                label: 'Total',
                                fontSize: '16px',
                                fontWeight: 600,
                                color: '#1f2937'
                            }
                        }
                    }
                }
            },
            dataLabels: {
                enabled: false
            },
            legend: {
                position: 'bottom',
                fontSize: '14px',
                fontWeight: 500,
                labels: {
                    colors: '#6b7280'
                }
            },
            tooltip: {
                style: {
                    fontSize: '14px',
                    fontFamily: 'Inter, sans-serif'
                }
            },
            animation: {
                animateGradually: {
                    enabled: true,
                    delay: 150
                },
                dynamicAnimation: {
                    enabled: true,
                    speed: 350
                }
            }
        };

        this.charts.status = new ApexCharts(container, options);
        this.charts.status.render();
    }

    async loadDashboardData() {
        try {
            // Show loading state
            this.showLoadingState();
            
            // Fetch data from API
            const response = await fetch('/api/dashboard/stats');
            const data = await response.json();
            
            if (data.success) {
                // Update metrics with animation
                this.updateMetrics(data.stats);
                
                // Update charts
                this.updateCharts(data.stats);
                
                // Load activity data
                await this.loadActivityData();
            } else {
                throw new Error(data.message || 'Failed to load dashboard data');
            }
            
            // Hide loading state
            this.hideLoadingState();
            
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            this.showErrorState();
        }
    }

    updateMetrics(stats) {
        // Animate counter updates
        this.animateCounter('outbound-count', stats.outbound || 0);
        this.animateCounter('inbound-count', stats.inbound || 0);
        this.animateCounter('company-count', stats.companies || 0);
        
        // Calculate and update success rate
        const total = (stats.outbound || 0) + (stats.inbound || 0);
        const successful = total > 0 ? Math.round((stats.valid || 0) / total * 100) : 98;
        this.animateCounter('success-rate', successful, '%');
    }

    animateCounter(elementId, targetValue, suffix = '') {
        const element = document.getElementById(elementId);
        if (!element) return;

        const startValue = parseInt(element.textContent) || 0;
        const duration = 1500;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth animation
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const currentValue = Math.round(startValue + (targetValue - startValue) * easeOutQuart);
            
            element.textContent = currentValue + suffix;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    updateCharts(stats) {
        // Update weekly chart with real data
        if (this.charts.weekly && stats.weeklyData) {
            this.charts.weekly.data.datasets[0].data = stats.weeklyData;
            this.charts.weekly.update('active');
        }

        // Update status chart with real data
        if (this.charts.status && stats.statusData) {
            this.charts.status.updateSeries(stats.statusData);
        }
    }

    async loadActivityData() {
        try {
            const response = await fetch('/api/dashboard-analytics/recent-activity');
            const data = await response.json();
            
            if (data.success && data.activities) {
                this.renderActivityItems(data.activities);
            }
        } catch (error) {
            console.error('Error loading activity data:', error);
        }
    }

    renderActivityItems(activities) {
        const container = document.getElementById('activity-list');
        if (!container) return;

        container.innerHTML = activities.slice(0, 5).map((activity, index) => `
            <div class="activity-item" style="animation-delay: ${index * 100}ms">
                <div class="activity-icon" style="background: ${this.getActivityColor(activity.type)}">
                    <i class="material-icons">${this.getActivityIcon(activity.type)}</i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${activity.message}</div>
                    <div class="activity-time">${this.formatTime(activity.timestamp)}</div>
                </div>
            </div>
        `).join('');
    }

    getActivityColor(type) {
        const colors = {
            'success': '#10b981',
            'warning': '#f59e0b',
            'error': '#ef4444',
            'info': '#3b82f6'
        };
        return colors[type] || '#6b7280';
    }

    getActivityIcon(type) {
        const icons = {
            'success': 'check_circle',
            'warning': 'warning',
            'error': 'error',
            'info': 'info'
        };
        return icons[type] || 'notifications';
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    setupRealTimeUpdates() {
        // Update every 30 seconds
        this.updateInterval = setInterval(() => {
            this.loadDashboardData();
        }, 30000);
    }

    setupEventListeners() {
        // Refresh button
        document.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
            this.loadDashboardData();
        });

        // Export button
        document.querySelector('[data-action="export"]')?.addEventListener('click', () => {
            this.exportData();
        });

        // Handle visibility change to pause/resume updates
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                clearInterval(this.updateInterval);
            } else {
                this.setupRealTimeUpdates();
            }
        });
    }

    showLoadingState() {
        document.querySelectorAll('.metric-value').forEach(el => {
            el.classList.add('loading-skeleton');
        });
    }

    hideLoadingState() {
        document.querySelectorAll('.metric-value').forEach(el => {
            el.classList.remove('loading-skeleton');
        });
    }

    showErrorState() {
        console.error('Dashboard v2 encountered an error');
        // Could show error toast or fallback UI here
    }

    exportData() {
        // Implement data export functionality
        console.log('Exporting dashboard data...');
    }

    destroy() {
        // Cleanup
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        Object.values(this.charts).forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
    }
}

// Initialize Dashboard v2
const dashboardV2 = new DashboardV2();

// Export for global access
window.DashboardV2 = DashboardV2;
