/**
 * LHDN UI Helper
 * Provides consistent UI error handling for LHDN errors
 */

// Create a namespace for the helper
const lhdnUIHelper = (function() {
    // Common LHDN error codes and their user-friendly messages
    const ERROR_CODES = {
        // Document validation errors
        'DS302': 'This document has already been submitted to LHDN.',
        'CF321': 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.',
        'CF364': 'Invalid item classification code. Please check all item classification codes.',
        'CF401': 'Tax calculation error. Please verify all tax amounts and calculations.',
        'CF402': 'Currency error. Please check that all monetary values use the correct currency code.',
        'CF403': 'Invalid tax code. Please verify the tax codes used in your document.',
        'CF404': 'Missing required field. Please ensure all required fields are completed.',
        'CF405': 'Invalid format. Please check the format of all fields in your document.',
        'CF406': 'Invalid value. One or more fields contain invalid values.',
        'CF407': 'Document number already exists. Please use a unique document number.',

        // Phone number validation errors
        'CF410': 'The supplier phone number format is invalid. Please ensure it includes the country code and is at least 8 characters long.',
        'CF414': 'The supplier phone number is too short. Phone number must be at least 8 characters long.',
        'CF415': 'The buyer phone number format is invalid. Please ensure it includes the country code and is at least 8 characters long.',

        // Authentication errors
        'AUTH001': 'Authentication failed. Please check your credentials.',
        'AUTH002': 'Session expired. Please log in again.',
        'AUTH003': 'Unauthorized access. You do not have permission to perform this action.',

        // System errors
        'SYS001': 'LHDN system error. Please try again later.',
        'SYS002': 'Connection timeout. Please check your internet connection and try again.',
        'SYS003': 'Service unavailable. LHDN services are currently down or under maintenance.',

        // Rate limiting
        'RATE_LIMIT': 'Rate limit exceeded. Please try again later.',

        // Default errors
        'VALIDATION_ERROR': 'Document validation failed. Please check the details and try again.',
        'SUBMISSION_ERROR': 'Document submission failed. Please try again later.',
        'EMPTY_RESPONSE': 'No response received from LHDN. The service might be unavailable.',
        'UNKNOWN_ERROR': 'An unknown error occurred. Please try again or contact support.'
    };

    /**
     * Format LHDN error for display
     * @param {Object|String|Array} error - The error object, string, or array
     * @returns {Object} Formatted error object with code, message, details, and suggestion
     */
    function formatLHDNError(error) {
        // Initialize default error object
        let formattedError = {
            code: 'UNKNOWN_ERROR',
            message: 'An unknown error occurred',
            details: [],
            suggestion: 'Please try again or contact support'
        };

        try {
            console.log('Formatting LHDN error:', error);

            // Handle string errors (try to parse as JSON)
            if (typeof error === 'string') {
                try {
                    error = JSON.parse(error);
                } catch (e) {
                    // If not valid JSON, use as message
                    formattedError.message = error;
                    return formattedError;
                }
            }

            // Handle array errors (take first item)
            if (Array.isArray(error)) {
                error = error[0] || error;
            }

            // Extract error details
            const code = error.code || error.errorCode || 'UNKNOWN_ERROR';
            const message = error.message || error.errorMessage || 'An unknown error occurred';
            let details = error.details || error.errorDetails || [];
            const target = error.target || '';
            const invoiceNumber = error.invoiceNumber || '';

            // Use predefined message if available, otherwise use provided message
            const userFriendlyMessage = ERROR_CODES[code] || message;

            // Format details for display
            let formattedDetails = [];

            // Handle case where details is a string that might contain JSON
            if (typeof details === 'string' && (details.includes('{') || details.includes('['))) {
                try {
                    // Try to parse JSON from the string
                    const jsonMatch = details.match(/(\{.*\}|\[.*\])/s);
                    if (jsonMatch) {
                        const parsedDetails = JSON.parse(jsonMatch[0]);
                        details = Array.isArray(parsedDetails) ? parsedDetails : [parsedDetails];
                    } else {
                        details = [details];
                    }
                } catch (e) {
                    console.error('Error parsing JSON from details string:', e);
                    details = [details];
                }
            }

            // Process details based on type
            if (Array.isArray(details)) {
                // Enhanced processing for the new user-friendly error structure
                formattedDetails = details.map(detail => {
                    if (typeof detail === 'object' && detail.userMessage) {
                        // New user-friendly error structure - prioritize user messages
                        return {
                            userMessage: detail.userMessage,
                            originalMessage: detail.originalMessage,
                            guidance: detail.guidance || [],
                            fieldDescription: detail.fieldDescription || detail.userMessage,
                            severity: detail.severity || 'error',
                            target: detail.target,
                            propertyName: detail.propertyName,
                            propertyPath: detail.propertyPath,
                            errorCode: detail.errorCode,
                            _isUserFriendly: true
                        };
                    } else if (typeof detail === 'object') {
                        // Legacy error structure - convert to user-friendly
                        const message = detail.message || detail.error || 'There is an issue with your invoice.';
                        return {
                            userMessage: message,
                            guidance: ['Please review your invoice information and try again.'],
                            fieldDescription: message,
                            severity: 'error',
                            _isUserFriendly: false
                        };
                    } else {
                        // String detail - convert to user-friendly
                        const message = typeof detail === 'string' ? detail : 'There is an issue with your invoice.';
                        return {
                            userMessage: message,
                            guidance: ['Please review your invoice information and try again.'],
                            fieldDescription: message,
                            severity: 'error',
                            _isUserFriendly: false
                        };
                    }
                });
            }

            // Generate suggestion based on error code
            let suggestion = 'Please check the document and try again';
            if (code.startsWith('CF4')) {
                if (code === 'CF410' || code === 'CF414' || code === 'CF415') {
                    suggestion = 'Please ensure the phone number includes the country code (+60 for Malaysia) and is at least 8 characters long. Example: +60123456789';
                } else {
                    suggestion = 'Please verify all tax information and calculations';
                }
            } else if (code.startsWith('AUTH')) {
                suggestion = 'Please log in again or contact your administrator';
            } else if (code.startsWith('SYS')) {
                suggestion = 'Please try again later or contact support';
            } else if (code === 'RATE_LIMIT') {
                suggestion = 'Please wait a few minutes before trying again';
            } else if (code === 'DS302' || code === 'DUPLICATE_SUBMISSION') {
                suggestion = 'This document has already been submitted. Please check the document status.';
            }

            // Return formatted error
            formattedError = {
                code,
                message: userFriendlyMessage,
                details: formattedDetails,
                target,
                invoiceNumber,
                suggestion
            };

            console.log('Formatted LHDN error:', formattedError);
        } catch (e) {
            console.error('Error formatting LHDN error:', e);
            // Keep default error object
        }

        return formattedError;
    }

    /**
     * Show LHDN error modal with accordion-style error details
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     * @param {String} options.title - Modal title (default: 'LHDN Submission Error')
     * @param {Boolean} options.showDetails - Whether to show error details (default: true)
     * @param {Boolean} options.showSuggestion - Whether to show suggestion (default: true)
     * @param {Function} options.onClose - Callback when modal is closed
     */
    function showLHDNErrorModal(error, options = {}) {
        console.log('🎨 Creating LHDN error modal with your design pattern');
        console.log('Raw error input:', error);

        // Format error with enhanced processing
        const formattedError = formatLHDNError(error);
        console.log('Formatted error:', formattedError);

        // Default options
        const defaultOptions = {
            title: 'LHDN Submission Error',
            showDetails: true,
            showSuggestion: true,
            onClose: null
        };

        // Merge options
        const mergedOptions = { ...defaultOptions, ...options };

        // Determine error severity and styling
        const errorCount = formattedError.details ? formattedError.details.length : 0;
        const isMultipleErrors = errorCount > 1;

        // Create Bootstrap modal structure following your design pattern
        let modalHTML = `
            <div class="modal fade lhdn-error-modal" id="lhdnErrorModal" tabindex="-1" aria-labelledby="lhdnErrorModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <!-- Header with your design pattern -->
                        <div class="modal-header">
                            <div class="header-left">
                                <div class="icon error">
                                    <i class="bi bi-exclamation-triangle-fill"></i>
                                </div>
                                <div class="header-text">
                                    <div class="title">${mergedOptions.title}</div>
                                    <div class="subtitle">Please review the details below</div>
                                </div>
                            </div>
                            <div class="header-right">
                                <div class="error-meta">
                                    <div class="meta-item">
                                        <span class="meta-label">ERROR CODE</span>
                                        <span class="meta-value error-code-badge">${formattedError.code}</span>
                                    </div>
                                    <div class="meta-item">
                                        <span class="meta-label">STATUS</span>
                                        <span class="meta-value status-badge">Failed</span>
                                    </div>
                                    ${formattedError.invoiceNumber ? `
                                    <div class="meta-item">
                                        <span class="meta-label">DOCUMENT</span>
                                        <span class="meta-value">${formattedError.invoiceNumber}</span>
                                    </div>` : ''}
                                </div>
                            </div>
                        </div>

                        <!-- Body -->
                        <div class="modal-body">
                            <div class="lhdn-error-content">
                                <!-- Main Error Alert -->
                                <div class="alert alert-danger d-flex align-items-start" role="alert">
                                    <i class="bi bi-exclamation-circle-fill me-3 flex-shrink-0" style="font-size: 1.1rem; margin-top: 0.125rem;"></i>
                                    <div>
                                        <h6 class="alert-heading mb-2">LHDN Submission Error</h6>
                                        <p class="mb-0">${formattedError.message}</p>
                                        ${isMultipleErrors ? `
                                        <small class="text-muted d-block mt-2">
                                            <i class="bi bi-info-circle me-1"></i>
                                            Found ${errorCount} issues that need your attention
                                        </small>
                                        ` : ''}
                                    </div>
                                </div>

                                <!-- Error Details Section with Accordion -->
                                ${mergedOptions.showDetails && formattedError.details && formattedError.details.length > 0 ? `
                                <div class="error-details-section mt-4">
                                    <div class="error-details-header">
                                        <h6 class="mb-3">
                                            <i class="bi bi-list-ul me-2"></i>
                                            Error Details (${formattedError.details.length})
                                        </h6>
                                    </div>
                                    <div class="accordion" id="errorDetailsAccordion">
                                        ${formattedError.details.map((detail, index) => {
                                            let errorText = '';
                                            let guidanceHTML = '';
                                            let fieldInfo = '';

                                            if (typeof detail === 'string') {
                                                errorText = detail;
                                            } else if (typeof detail === 'object') {
                                                // Prioritize user-friendly messages over technical codes
                                                if (detail.userMessage) {
                                                    errorText = detail.userMessage;
                                                    if (detail.guidance && Array.isArray(detail.guidance) && detail.guidance.length > 0) {
                                                        guidanceHTML = detail.guidance;
                                                    }
                                                } else if (detail.fieldDescription) {
                                                    errorText = detail.fieldDescription;
                                                } else if (detail.originalMessage) {
                                                    errorText = detail.originalMessage;
                                                } else if (detail.message) {
                                                    errorText = detail.message;
                                                } else {
                                                    errorText = 'There is an issue with your invoice that needs to be corrected.';
                                                    guidanceHTML = ['Please review your invoice data and try again.'];
                                                }

                                                // Extract field information - prioritize target over propertyName
                                                if (detail.target) {
                                                    fieldInfo = detail.target;
                                                } else if (detail.propertyName) {
                                                    fieldInfo = detail.propertyName;
                                                } else if (detail.fieldDescription) {
                                                    fieldInfo = detail.fieldDescription;
                                                }
                                            }

                                            return `
                                                <div class="accordion-item">
                                                    <h2 class="accordion-header" id="heading${index}">
                                                        <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="collapse${index}">
                                                            <div class="error-summary">
                                                                <div class="error-number">
                                                                    <span class="error-index">${index + 1}</span>
                                                                </div>
                                                                <div class="error-info">
                                                                    <div class="error-title">${errorText}</div>
                                                                    ${fieldInfo ? `<div class="error-field text-muted">Field: ${fieldInfo}</div>` : ''}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    </h2>
                                                    <div id="collapse${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="heading${index}" data-bs-parent="#errorDetailsAccordion">
                                                        <div class="accordion-body">
                                                            <div class="error-detail-content">
                                                                <div class="error-description">
                                                                    <strong>Issue:</strong>
                                                                    <span>${errorText}</span>
                                                                </div>
                                                                ${guidanceHTML && Array.isArray(guidanceHTML) && guidanceHTML.length > 0 ? `
                                                                <div class="error-guidance mt-3">
                                                                    <div class="alert alert-info">
                                                                        <i class="bi bi-lightbulb me-2"></i>
                                                                        <strong>How to fix this:</strong>
                                                                        <ul class="mb-0 mt-2">
                                                                            ${guidanceHTML.map(guide => `<li>${guide}</li>`).join('')}
                                                                        </ul>
                                                                    </div>
                                                                </div>
                                                                ` : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                                ` : ''}

                                <!-- Suggestion Section -->
                                ${mergedOptions.showSuggestion && formattedError.suggestion ? `
                                <div class="alert alert-warning mt-4">
                                    <h6 class="alert-heading">
                                        <i class="bi bi-lightbulb me-2"></i>
                                        Suggestion
                                    </h6>
                                    <p class="mb-0">${formattedError.suggestion}</p>
                                </div>
                                ` : ''}
                            </div>
                        </div>

                        <!-- Footer -->
                        <div class="modal-footer">
                            <button type="button" class="btn btn-success" data-bs-dismiss="modal">
                                <i class="bi bi-check-lg me-2"></i>
                                I Understand
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Close any existing modals first to prevent stacking
        const existingModals = document.querySelectorAll('.modal.show');
        existingModals.forEach(modal => {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) {
                modalInstance.hide();
            }
        });

        // Specifically close submission progress modal if it exists
        const submissionModal = document.getElementById('submissionProgressModal');
        if (submissionModal) {
            const submissionModalInstance = bootstrap.Modal.getInstance(submissionModal);
            if (submissionModalInstance) {
                submissionModalInstance.hide();
            }
        }

        // Also close any SweetAlert modals that might be open
        if (typeof Swal !== 'undefined') {
            Swal.close();
        }

        // Remove any existing LHDN error modal
        const existingLhdnModal = document.getElementById('lhdnErrorModal');
        if (existingLhdnModal) {
            existingLhdnModal.remove();
        }

        // Wait a moment for existing modals to close, then show the error modal
        setTimeout(() => {
            // Add modal to DOM
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Show the Bootstrap modal
            const modalElement = document.getElementById('lhdnErrorModal');
            const modal = new bootstrap.Modal(modalElement, {
                backdrop: true, // Allow backdrop click to close
                keyboard: true
            });

            // Add event listener for modal close
            modalElement.addEventListener('hidden.bs.modal', function () {
                // Remove modal from DOM
                modalElement.remove();

                // Call onClose callback if provided
                if (mergedOptions.onClose) {
                    mergedOptions.onClose();
                }
            }, { once: true });

            modal.show();

            // Ensure accordion functionality works properly
            setTimeout(() => {
                const accordionButtons = modalElement.querySelectorAll('.accordion-button');
                accordionButtons.forEach(button => {
                    button.addEventListener('click', function() {
                        // Ensure proper Bootstrap collapse behavior
                        const target = this.getAttribute('data-bs-target');
                        const collapseElement = document.querySelector(target);
                        if (collapseElement) {
                            const bsCollapse = new bootstrap.Collapse(collapseElement, {
                                toggle: false
                            });

                            if (this.classList.contains('collapsed')) {
                                bsCollapse.show();
                            } else {
                                bsCollapse.hide();
                            }
                        }
                    });
                });
            }, 100);
        }, 300); // Wait 300ms for existing modals to close
    }

    /**
     * Show LHDN error toast
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     */
    function showLHDNErrorToast(error, options = {}) {
        // Format error
        const formattedError = formatLHDNError(error);

        // Default options
        const defaultOptions = {
            position: 'top-center',
            autoHide: 5000,
            showDetails: false
        };

        // Merge options
        const mergedOptions = { ...defaultOptions, ...options };

        // Show the toast using SweetAlert2 as a toast
        const toast = Swal.fire({
            toast: true,
            position: mergedOptions.position.replace('-', '_'),
            html: `
                <div class="toast-header bg-danger text-white">
                    <strong class="me-auto">${formattedError.code}</strong>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">
                    <div class="fw-bold">${formattedError.message}</div>
                </div>
            `,
            showConfirmButton: false,
            timer: mergedOptions.autoHide > 0 ? mergedOptions.autoHide : undefined,
            timerProgressBar: mergedOptions.autoHide > 0
        });

        return toast;
    }

    /**
     * Close submission progress modal and show error modal
     * This is specifically for transitioning from submission progress to error display
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     */
    function showSubmissionError(error, options = {}) {
        console.log('🔄 Transitioning from submission progress to error modal');

        // Force close submission progress modal immediately
        const submissionModal = document.getElementById('submissionProgressModal');
        if (submissionModal) {
            const modalInstance = bootstrap.Modal.getInstance(submissionModal);
            if (modalInstance) {
                modalInstance.hide();
            }
            // Remove backdrop if it exists
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }
        }

        // Close any SweetAlert modals
        if (typeof Swal !== 'undefined') {
            Swal.close();
        }

        // Wait a moment for cleanup, then show error modal
        setTimeout(() => {
            showLHDNErrorModal(error, {
                title: 'LHDN Submission Failed',
                ...options
            });
        }, 100);
    }

    // Return public API
    return {
        formatLHDNError,
        showLHDNErrorModal,
        showLHDNErrorToast,
        showSubmissionError,
        ERROR_CODES
    };
})();

// Add CSS styles for the LHDN error modal following your design pattern
if (!document.getElementById('lhdn-error-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'lhdn-error-modal-styles';
    style.textContent = `
        /* LHDN Error Modal - Following your design pattern */
        .lhdn-error-modal .modal-dialog {
            max-width: 800px;
            width: 95%;
            margin: 1.75rem auto;
        }

        .lhdn-error-modal .modal-content {
            overflow: hidden;
        }

        /* Header - Following your design pattern with dark navy blue gradient */
        .lhdn-error-modal .modal-header {
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            color: white;
            border-bottom: none;
            padding: 1.25rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 1020;
        }

        .lhdn-error-modal .header-left {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .lhdn-error-modal .icon.error {
            width: 40px;
            height: 40px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.1rem;
            color: #ffffff;
        }

        .lhdn-error-modal .header-text .title {
            font-size: 1.1rem;
            font-weight: 600;
            margin: 0;
            color: #ffffff;
        }

        .lhdn-error-modal .header-text .subtitle {
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.8);
            margin: 0;
            margin-top: 0.25rem;
        }

        .lhdn-error-modal .header-right {
            display: flex;
            align-items: center;
        }

        .lhdn-error-modal .error-meta {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            text-align: right;
        }

        .lhdn-error-modal .meta-item {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 0.25rem;
        }

        .lhdn-error-modal .meta-label {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.7);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .lhdn-error-modal .meta-value {
            font-size: 0.875rem;
            font-weight: 600;
        }

        .lhdn-error-modal .error-code-badge {
            background: #dc2626;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
        }

        .lhdn-error-modal .status-badge {
            background: #dc2626;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
        }

        /* Body */
        .lhdn-error-modal .modal-body {
            padding: 1.25rem;
            background: white;
            max-height: 60vh;
            overflow-y: auto;
            overflow-x: hidden;
        }

        /* Error Details Accordion */
        .lhdn-error-modal .error-details-section h6 {
            color: #475569;
            font-weight: 600;
            margin-bottom: 1rem;
        }

        .lhdn-error-modal .accordion-item {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            margin-bottom: 0.75rem;
            overflow: hidden;
            transition: all 0.2s ease;
        }

        .lhdn-error-modal .accordion-item:last-child {
            margin-bottom: 0;
        }

        .lhdn-error-modal .accordion-button {
            background: #f8fafc;
            border: none;
            padding: 0.875rem;
            font-weight: 500;
            font-size: 0.9rem;
            transition: all 0.2s ease;
        }

        .lhdn-error-modal .accordion-button:not(.collapsed) {
            background: rgba(15, 23, 42, 0.08);
            color: #374151;
            box-shadow: none;
        }

        .lhdn-error-modal .accordion-button:focus {
            box-shadow: 0 0 0 0.2rem rgba(15, 23, 42, 0.25);
            border-color: transparent;
        }

        .lhdn-error-modal .accordion-button:hover {
            background: rgba(15, 23, 42, 0.05);
        }

        .lhdn-error-modal .error-summary {
            display: flex;
            align-items: center;
            gap: 1rem;
            width: 100%;
        }

        .lhdn-error-modal .error-number {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 600;
            color: #dc2626;
            min-width: 60px;
        }

        .lhdn-error-modal .error-number .error-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 26px;
            height: 26px;
            background: #dc2626;
            color: white;
            border-radius: 50%;
            font-size: 0.85rem;
            font-weight: 700;
            text-align: center;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 4px rgba(220, 38, 38, 0.3);
        }

        .lhdn-error-modal .error-info {
            flex: 1;
        }

        .lhdn-error-modal .error-title {
            font-weight: 600;
            color: #374151;
            margin-bottom: 0.25rem;
            font-size: 0.9rem;
            line-height: 1.4;
        }

        .lhdn-error-modal .error-field {
            font-size: 0.8rem;
            color: #6b7280;
        }

        .lhdn-error-modal .accordion-body {
            padding: 0.875rem;
            background: white;
            border-top: 1px solid #d1d5db;
        }

        .lhdn-error-modal .error-description {
            display: flex;
            gap: 0.875rem;
            align-items: flex-start;
            padding: 0.875rem;
            background: rgba(15, 23, 42, 0.04);
            border-radius: 8px;
            margin-bottom: 0.75rem;
        }

        .lhdn-error-modal .error-description strong {
            min-width: 70px;
            color: #0f172a;
            font-weight: 600;
            flex-shrink: 0;
            font-size: 0.85rem;
        }

        .lhdn-error-modal .error-description span {
            color: #4b5563;
            line-height: 1.5;
            font-size: 0.85rem;
        }

        .lhdn-error-modal .error-guidance .alert {
            margin-bottom: 0;
            font-size: 0.85rem;
        }

        /* Ensure proper accordion collapse behavior */
        .lhdn-error-modal .accordion-collapse {
            transition: height 0.35s ease;
        }

        .lhdn-error-modal .accordion-button::after {
            transition: transform 0.2s ease-in-out;
        }

        /* Fix button focus states */
        .lhdn-error-modal .btn:focus {
            box-shadow: 0 0 0 0.2rem rgba(15, 23, 42, 0.25);
        }

        /* Footer */
        .lhdn-error-modal .modal-footer {
            background: #f8f9fa;
            border-top: 1px solid #e2e8f0;
            padding: 1rem 1.5rem;
        }

        .lhdn-error-modal .modal-footer .btn {
            min-width: 120px;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .lhdn-error-modal .modal-dialog {
                margin: 1rem;
                width: calc(100% - 2rem);
            }

            .lhdn-error-modal .modal-header {
                padding: 1rem;
                flex-direction: column;
                text-align: center;
                gap: 1rem;
            }

            .lhdn-error-modal .header-right {
                align-self: stretch;
            }

            .lhdn-error-modal .error-meta {
                flex-direction: row;
                justify-content: center;
                gap: 1rem;
            }

            .lhdn-error-modal .meta-item {
                align-items: center;
            }

            .lhdn-error-modal .modal-body {
                padding: 1rem;
                max-height: 50vh;
            }

            .lhdn-error-modal .error-description {
                flex-direction: column;
                gap: 0.5rem;
            }

            .lhdn-error-modal .error-description strong {
                min-width: auto;
            }
        }
    `;
    document.head.appendChild(style);
}

// Test function for debugging modal behavior
window.testLHDNModal = function() {
    console.log('🧪 Testing LHDN modal behavior');

    // Simulate the error from your logs
    const testError = {
        "code": "CF404",
        "message": "BadRequest",
        "details": [
            {
                "userMessage": "The supplier phone number format is incorrect.",
                "originalMessage": "Enter valid phone number - SUPPLIER",
                "guidance": [
                    "Please update the supplier phone number to include the country code.",
                    "For Malaysian phone numbers, use this format: +60123456789",
                    "Make sure the phone number starts with a plus sign (+).",
                    "You can find this field in the supplier contact section of your invoice."
                ],
                "fieldDescription": "There is an issue with the supplier phone number format.",
                "severity": "error",
                "target": "supplier contact information",
                "propertyName": "AccountingSupplierParty.Party.Contact.Telephone",
                "propertyPath": "AccountingSupplierParty.Party.Contact.Telephone",
                "errorCode": "CF410"
            },
            {
                "userMessage": "The customer phone number format is incorrect.",
                "originalMessage": "Enter valid phone number - BUYER",
                "guidance": [
                    "Please update the customer phone number to include the country code.",
                    "For Malaysian phone numbers, use this format: +60123456789",
                    "Make sure the phone number starts with a plus sign (+).",
                    "You can find this field in the customer contact section of your invoice."
                ],
                "fieldDescription": "There is an issue with the customer phone number format.",
                "severity": "error",
                "target": "customer contact information",
                "propertyName": "AccountingCustomerParty.Party.Contact.Telephone",
                "propertyPath": "AccountingCustomerParty.Party.Contact.Telephone",
                "errorCode": "CF415"
            }
        ]
    };

    // Test the new submission error function
    if (typeof lhdnUIHelper !== 'undefined' && lhdnUIHelper.showSubmissionError) {
        lhdnUIHelper.showSubmissionError(testError);
    } else {
        console.error('lhdnUIHelper not available');
    }
};

console.log('🎯 LHDN UI Helper loaded. Test with: testLHDNModal()');
