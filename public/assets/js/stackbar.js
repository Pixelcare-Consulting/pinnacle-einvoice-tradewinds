// Initialize stacked bar chart
let dashboardChart = null;

function initStackedBarChart() {
    // Check if the chart container exists
    const chartContainer = document.querySelector("#stackedBarChart");
    if (!chartContainer) {
        console.warn('Chart container #stackedBarChart not found');
        return null;
    }

    // Check if ApexCharts is available
    if (typeof ApexCharts === 'undefined') {
        console.error('ApexCharts library not loaded');
        return null;
    }

    const options = {
        series: [{
            name: 'Valid',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Invalid',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Rejected',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Cancelled',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Pending',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Submitted',
            data: [0, 0, 0, 0, 0, 0]
        }],
        chart: {
            type: 'bar',
            height: 500,
            stacked: true,
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            },
            background: '#fff',
            fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"'
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '40%',
                borderRadius: 2
            }
        },
        dataLabels: {
            enabled: false
        },
        stroke: {
            show: false
        },
        colors: [
            '#10B981', // Valid - Success Green
            '#EF4444', // Invalid - Red
            '#EF4444', // Rejected - Danger Red
            '#FACC15', // Cancelled - Yellow
            '#F97316', // Pending - Orange
            '#6B7280'  // Queue - Dark Gray
        ],
        xaxis: {
            categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            labels: {
                style: {
                    fontSize: '12px',
                    fontWeight: 500
                }
            },
            axisBorder: {
                show: false
            },
            axisTicks: {
                show: false
            },
            tooltip: {
                enabled: false
            }
        },
        yaxis: {
            labels: {
                style: {
                    fontSize: '12px',
                    fontWeight: 500
                }
            }
        },
        tooltip: {
            shared: true,
            intersect: false,
            y: {
                formatter: function (val) {
                    return val + " invoices"
                }
            }
        },
        legend: {
            position: 'top',
            horizontalAlign: 'left',
            offsetY: 10,
            itemMargin: {
                horizontal: 10
            }
        }
    };

    try {
        // If chart exists, destroy it first
        if (dashboardChart && typeof dashboardChart.destroy === 'function') {
            dashboardChart.destroy();
        }

        // Create new chart
        dashboardChart = new ApexCharts(chartContainer, options);

        // Render the chart
        dashboardChart.render().then(() => {
            console.log('Chart rendered successfully');
        }).catch(error => {
            console.error('Error rendering chart:', error);
        });

        return dashboardChart;
    } catch (error) {
        console.error('Error creating chart:', error);
        return null;
    }
}

// Function to update chart data with debouncing
let updateTimeout = null;
function updateChartData(dates, data) {
    // Check if chart exists and has required methods
    if (!dashboardChart || typeof dashboardChart.updateOptions !== 'function' || typeof dashboardChart.updateSeries !== 'function') {
        console.warn('Chart not available for update');
        return;
    }

    // Validate input data
    if (!dates || !data) {
        console.warn('Invalid data provided for chart update');
        return;
    }
    
    // Clear any pending updates
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    
    // Debounce the update
    updateTimeout = setTimeout(() => {
        try {
            // Format dates for display
            const formattedDates = dates.map(date => {
                const d = new Date(date);
                return d.toLocaleDateString('en-US', {
                    weekday: 'short'
                });
            });

            // Batch update the chart
            dashboardChart.updateOptions({
                xaxis: {
                    categories: formattedDates
                }
            }, false, false);

            // Prepare series data with fallbacks
            const seriesData = [{
                name: 'Valid',
                data: data.valid || [0, 0, 0, 0, 0, 0]
            }, {
                name: 'Invalid',
                data: data.invalid || [0, 0, 0, 0, 0, 0]
            }, {
                name: 'Rejected',
                data: data.rejected || [0, 0, 0, 0, 0, 0]
            }, {
                name: 'Cancelled',
                data: data.cancelled || [0, 0, 0, 0, 0, 0]
            }, {
                name: 'Pending',
                data: data.pending || [0, 0, 0, 0, 0, 0]
            }, {
                name: 'Submitted',
                data: data.submitted || [0, 0, 0, 0, 0, 0]
            }];

            dashboardChart.updateSeries(seriesData, false);

            console.log('Chart updated successfully');
        } catch (error) {
            console.error('Error updating chart:', error);
        }
    }, 100);
}