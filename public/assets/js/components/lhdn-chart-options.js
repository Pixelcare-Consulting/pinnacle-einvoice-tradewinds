/**
 * LHDN Processing Analytics Chart Options
 * Multiple chart type implementations for processing time visualization
 */

class LHDNChartOptions {
    
    /**
     * Option 2: Donut Chart - Processing Time Distribution
     * Best for: Visual percentage breakdown of processing time categories
     */
    static getDonutChartConfig() {
        return {
            type: 'doughnut',
            data: {
                labels: ['< 1 hour', '1-2 hours', '2-4 hours', '4-8 hours', '8-24 hours', '> 24 hours'],
                datasets: [{
                    label: 'Processing Time Distribution',
                    data: [0, 0, 0, 0, 0, 0],
                    backgroundColor: [
                        '#198754',  // Green for < 1h (fast)
                        '#0d6efd',  // Blue for 1-2h (normal)
                        '#ffc107',  // Yellow for 2-4h (moderate)
                        '#ff8307',  // Orange for 4-8h (slow)
                        '#dc3545',  // Red for 8-24h (very slow)
                        '#6c757d'   // Gray for > 24h (extremely slow)
                    ],
                    borderColor: '#ffffff',
                    borderWidth: 3,
                    hoverBorderWidth: 4,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            font: {
                                size: 11
                            },
                            color: '#495057'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#0d6efd',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return [
                                    `${context.label}: ${value} invoices`,
                                    `${percentage}% of total`
                                ];
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false
                },
                animation: {
                    animateRotate: true,
                    animateScale: true,
                    duration: 1000
                }
            }
        };
    }

    /**
     * Option 3: Gauge Chart - Current Average Processing Time
     * Best for: Real-time monitoring of current processing performance
     */
    static getGaugeChartConfig() {
        return {
            type: 'doughnut',
            data: {
                labels: ['Current Avg', 'Remaining'],
                datasets: [{
                    label: 'Average Processing Time',
                    data: [2.5, 21.5], // 2.5 hours out of 24 hour scale
                    backgroundColor: [
                        '#0d6efd',
                        'rgba(233, 236, 239, 0.3)'
                    ],
                    borderColor: [
                        '#0d6efd',
                        'rgba(233, 236, 239, 0.5)'
                    ],
                    borderWidth: 2,
                    circumference: 180,
                    rotation: 270,
                    cutout: '75%'
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
                        enabled: false
                    }
                },
                animation: {
                    animateRotate: true,
                    duration: 1500
                }
            }
        };
    }

    /**
     * Option 4: Timeline Chart - Individual Invoice Processing Journey
     * Best for: Detailed view of individual invoice processing patterns
     * Uses simple scatter plot without date adapters
     */
    static getTimelineChartConfig() {
        return {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Processing Timeline',
                    data: [],
                    backgroundColor: function(context) {
                        if (!context.parsed) return '#0d6efd';
                        const value = context.parsed.y;
                        if (value < 1) return '#198754';      // Green for < 1h
                        if (value < 2) return '#0d6efd';      // Blue for 1-2h
                        if (value < 4) return '#ffc107';      // Yellow for 2-4h
                        if (value < 8) return '#ff8307';      // Orange for 4-8h
                        if (value < 24) return '#dc3545';     // Red for 8-24h
                        return '#6c757d';                     // Gray for > 24h
                    },
                    borderColor: '#ffffff',
                    borderWidth: 2,
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
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#0d6efd',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                if (!context[0] || !context[0].raw) return 'Processing Time';
                                const timestamp = context[0].raw.timestamp;
                                if (timestamp) {
                                    const date = new Date(timestamp);
                                    return date.toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    });
                                }
                                return 'Processing Time';
                            },
                            label: function(context) {
                                const hours = context.parsed.y;
                                const minutes = Math.round((hours % 1) * 60);
                                const wholeHours = Math.floor(hours);
                                return `Processing Time: ${wholeHours}h ${minutes}m`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Invoice Sequence',
                            color: '#6c757d',
                            font: {
                                size: 11
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        },
                        ticks: {
                            color: '#6c757d',
                            font: {
                                size: 10
                            },
                            stepSize: 1,
                            callback: function(value) {
                                return Number.isInteger(value) ? value : '';
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Processing Time (Hours)',
                            color: '#6c757d',
                            font: {
                                size: 11
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        },
                        ticks: {
                            color: '#6c757d',
                            font: {
                                size: 10
                            },
                            callback: function(value) {
                                return value + 'h';
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'point'
                }
            }
        };
    }

    /**
     * Update methods for each chart type
     */
    static updateDonutChart(chart, processingTimes) {
        if (!chart || processingTimes.length === 0) return;

        const buckets = [0, 0, 0, 0, 0, 0];
        
        processingTimes.forEach(item => {
            const hours = item.processingTimeHours;
            if (hours < 1) buckets[0]++;
            else if (hours < 2) buckets[1]++;
            else if (hours < 4) buckets[2]++;
            else if (hours < 8) buckets[3]++;
            else if (hours < 24) buckets[4]++;
            else buckets[5]++;
        });

        chart.data.datasets[0].data = buckets;
        chart.update('none');
    }

    static updateGaugeChart(chart, averageHours) {
        if (!chart) return;

        const maxHours = 24;
        const remaining = Math.max(0, maxHours - averageHours);
        
        chart.data.datasets[0].data = [averageHours, remaining];
        chart.update('none');
    }

    static updateTimelineChart(chart, processingTimes) {
        if (!chart || processingTimes.length === 0) return;

        // Create data points with sequence numbers instead of timestamps
        const data = processingTimes.map((item, index) => ({
            x: index + 1, // Use sequence number for x-axis
            y: item.processingTimeHours,
            timestamp: item.validationTime // Store timestamp for tooltip
        }));

        chart.data.datasets[0].data = data;
        chart.update('none');
    }

    /**
     * Get center text plugin for gauge chart
     */
    static getCenterTextPlugin() {
        return {
            id: 'centerText',
            beforeDraw: function(chart) {
                if (chart.config.type !== 'doughnut' || !chart.config.options.plugins.centerText) return;

                const ctx = chart.ctx;
                const centerX = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
                const centerY = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;

                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#495057';
                ctx.font = 'bold 18px Arial';
                
                const value = chart.data.datasets[0].data[0];
                const text = `${value.toFixed(1)}h`;
                ctx.fillText(text, centerX, centerY - 5);
                
                ctx.font = '12px Arial';
                ctx.fillStyle = '#6c757d';
                ctx.fillText('Avg Time', centerX, centerY + 15);
                
                ctx.restore();
            }
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LHDNChartOptions;
}
