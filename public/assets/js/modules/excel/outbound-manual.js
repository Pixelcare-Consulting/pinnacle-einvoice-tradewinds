// Clean version of outbound-manual.js - Fixed file upload conflicts
// Use global utilities loaded by load-utils.js

const dataCache = {
    tableData: null,
    lastFetchTime: null,
    cacheExpiry: 2 * 60 * 1000, // 2 minutes in milliseconds

    isCacheValid() {
        return this.tableData &&
               this.lastFetchTime &&
               (Date.now() - this.lastFetchTime < this.cacheExpiry);
    },

    updateCache(data) {
        this.tableData = data;
        this.lastFetchTime = Date.now();
        // Update card counts when cache is updated
        this.updateCardCounts();
    },

    invalidateCache() {
        this.tableData = null;
        this.lastFetchTime = null;
    },

    getCachedData() {
        return this.isCacheValid() ? this.tableData : null;
    },

    updateCardCounts() {
        if (!this.tableData) return;

        // Count files by status
        const counts = {
            total: this.tableData.length,
            submitted: 0,
            invalid: 0,
            pending: 0
        };

        this.tableData.forEach(file => {
            const status = (file.status || 'uploaded').toLowerCase();
            switch (status) {
                case 'submitted':
                    counts.submitted++;
                    break;
                case 'invalid':
                case 'rejected':
                    counts.invalid++;
                    break;
                case 'pending':
                case 'uploaded':
                case 'processed':
                case 'processing':
                    counts.pending++;
                    break;
            }
        });

        // Update card displays
        this.updateCardDisplay('total-invoice-count', counts.total);
        this.updateCardDisplay('total-submitted-count', counts.submitted);
        this.updateCardDisplay('total-invalid-count', counts.invalid);
        this.updateCardDisplay('total-queue-value', counts.pending);
    },

    updateCardDisplay(className, count) {
        const element = document.querySelector(`.${className}`);
        const spinner = element?.parentElement?.querySelector('.loading-spinner');

        if (element) {
            element.textContent = count;
            element.style.display = 'block';
        }

        if (spinner) {
            spinner.style.display = 'none';
        }
    }
};

function formatManualInvoiceDateForDisplay(data) {
    if (!data) return null;

    const value = String(data).trim();
    const dmyMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmyMatch) {
        const [, day, month, year] = dmyMatch;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        const isValidDate =
            date.getFullYear() === Number(year) &&
            date.getMonth() === Number(month) - 1 &&
            date.getDate() === Number(day);

        return isValidDate ? `${day}/${month}/${year}` : null;
    }

    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        return `${day}/${month}/${year}`;
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) return null;

    return date.toLocaleDateString('en-MY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function notifyInboundModule(submissionData) {
    try {
        localStorage.setItem('newSubmissionNotification', JSON.stringify({
            timestamp: Date.now(),
            data: submissionData
        }));
        window.dispatchEvent(new CustomEvent('outboundSubmissionComplete', {
            detail: submissionData
        }));
    } catch (error) {
        console.error('Error notifying inbound module:', error);
    }
}

class ValidationError extends Error {
    constructor(message, validationErrors = [], fileName = null) {
        super(message);
        this.name = 'ValidationError';
        this.validationErrors = validationErrors;
        this.fileName = fileName;
    }
}

class DateTimeManager {
    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');

        function update() {
            const now = new Date();

            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }

            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }

        update();
        setInterval(update, 1000);
    }
}

// File Upload Manager - Simplified and conflict-free
class FileUploadManager {
    constructor() {
        console.log('FileUploadManager initialized');
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('flatFileUpload');
        this.processFileBtn = document.getElementById('processFileBtn');
        this.previewFileBtn = document.getElementById('previewFileBtn');
        this.browseFilesLink = document.getElementById('browseFilesLink');
        this.clearFileBtn = document.getElementById('clearFileBtn');
        this.maxFileSize = 5 * 1024 * 1024; // 5MB
        this.allowedTypes = ['.xlsx', '.xls'];
        this.selectedFile = null;

        // Debug: Log element states
        console.log('Elements found:', {
            uploadArea: !!this.uploadArea,
            fileInput: !!this.fileInput,
            processFileBtn: !!this.processFileBtn,
            previewFileBtn: !!this.previewFileBtn,
            browseFilesLink: !!this.browseFilesLink,
            clearFileBtn: !!this.clearFileBtn
        });

        // Test if file input is functional
        if (this.fileInput) {
            console.log('File input properties:', {
                id: this.fileInput.id,
                type: this.fileInput.type,
                accept: this.fileInput.accept,
                disabled: this.fileInput.disabled,
                style: this.fileInput.style.cssText,
                offsetParent: this.fileInput.offsetParent
            });
        }

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        console.log('Initializing file upload event listeners');

        // Re-check for preview button in case it wasn't available during construction
        if (!this.previewFileBtn) {
            this.previewFileBtn = document.getElementById('previewFileBtn');
            console.log('Re-checked preview button:', !!this.previewFileBtn);
        }

        // Browse files label - Now using label for better compatibility
        // The label automatically triggers the file input, so we just need to handle the file selection
        console.log('Browse files label found:', !!this.browseFilesLink);
        console.log('File input found:', !!this.fileInput);

        // File input change event - Handle file selection
        if (this.fileInput) {
            this.fileInput.addEventListener('change', (e) => {
                console.log('File input changed');
                const files = e.target.files;
                if (files && files.length > 0) {
                    console.log('File selected:', files[0].name);
                    this.handleFileSelection(files[0]);
                } else {
                    console.log('No file selected');
                }
            });
        }

        // Removed duplicate file input event listener - already handled above

        // Drag and drop events
        if (this.uploadArea) {
            this.uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.uploadArea.classList.add('dragover');
            });

            this.uploadArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                this.uploadArea.classList.remove('dragover');
            });

            this.uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                this.uploadArea.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileSelection(files[0]);
                }
            });
        }

        // Process file button
        if (this.processFileBtn) {
            this.processFileBtn.addEventListener('click', () => {
                this.handleProcessFile();
            });
        }

        // Preview file button
        if (this.previewFileBtn && !this.previewFileBtn.hasAttribute('data-listener-added')) {
            console.log('Adding preview button event listener');
            this.previewFileBtn.addEventListener('click', (e) => {
                console.log('Preview button clicked');
                e.preventDefault();
                e.stopPropagation(); // Prevent event bubbling
                this.handlePreviewFile();
            });
            this.previewFileBtn.setAttribute('data-listener-added', 'true');
        } else if (!this.previewFileBtn) {
            console.error('Preview button not found!');
        }

        // Clear file button
        if (this.clearFileBtn) {
            this.clearFileBtn.addEventListener('click', () => {
                this.clearFileSelection();
            });
        }

        // Proceed with upload button (from preview modal)
        const proceedWithUploadBtn = document.getElementById('proceedWithUploadBtn');
        if (proceedWithUploadBtn) {
            proceedWithUploadBtn.addEventListener('click', () => {
                // Close the preview modal
                const previewModal = bootstrap.Modal.getInstance(document.getElementById('excelPreviewModal'));
                if (previewModal) {
                    previewModal.hide();
                }

                // Clean up any modal backdrops
                setTimeout(() => {
                    this.cleanupModalArtifacts();
                }, 100);

                // Trigger the actual upload process
                this.handleProcessFile();
            });
        }
    }

    handleFileSelection(file) {
        // Validate file type
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        if (!this.allowedTypes.includes(fileExt)) {
            this.showError(`Invalid file type. Please upload only ${this.allowedTypes.join(' or ')} files.`);
            return;
        }

        // Validate file size
        if (file.size > this.maxFileSize) {
            this.showError(`File size too large. Maximum size is ${this.maxFileSize / (1024 * 1024)}MB.`);
            return;
        }

        this.selectedFile = file;
        this.displayFileDetails(file);

        // Ensure preview button is available and has event listener
        this.ensurePreviewButtonReady();
    }

    ensurePreviewButtonReady() {
        // Re-check for preview button
        if (!this.previewFileBtn) {
            this.previewFileBtn = document.getElementById('previewFileBtn');
        }

        // Only add listener if button exists and doesn't already have one
        if (this.previewFileBtn && !this.previewFileBtn.hasAttribute('data-listener-added')) {
            console.log('Adding preview button event listener (delayed)');

            // Remove any existing listeners first
            this.previewFileBtn.removeEventListener('click', this.handlePreviewFile);

            // Add the new listener
            this.previewFileBtn.addEventListener('click', (e) => {
                console.log('Preview button clicked (delayed listener)');
                e.preventDefault();
                e.stopPropagation(); // Prevent event bubbling
                this.handlePreviewFile();
            });
            this.previewFileBtn.setAttribute('data-listener-added', 'true');
        }
    }

    displayFileDetails(file) {
        const fileDetails = document.getElementById('fileDetails');
        const uploadArea = document.getElementById('uploadArea');
        const fileInfo = document.getElementById('fileInfo');

        if (fileDetails && uploadArea && fileInfo) {
            // Hide upload area and show file details
            uploadArea.style.display = 'none';
            fileDetails.classList.remove('d-none');
            fileDetails.style.display = 'block';

            // Create file information HTML with modern styling
            const fileInfoHTML = `
                <div class="file-info-item">
                    <div class="file-info-label">
                        <i class="bi bi-file-earmark-excel text-success me-2"></i>
                        File Name
                    </div>
                    <div class="file-info-value">${file.name}</div>
                </div>
                <div class="file-info-item">
                    <div class="file-info-label">
                        <i class="bi bi-hdd text-primary me-2"></i>
                        File Size
                    </div>
                    <div class="file-info-value">
                        <span class="file-size-badge">${this.formatFileSize(file.size)}</span>
                    </div>
                </div>
                <div class="file-info-item">
                    <div class="file-info-label">
                        <i class="bi bi-calendar text-warning me-2"></i>
                        Last Modified
                    </div>
                    <div class="file-info-value">${new Date(file.lastModified).toLocaleString()}</div>
                </div>
                <div class="file-info-item">
                    <div class="file-info-label">
                        <i class="bi bi-shield-check text-success me-2"></i>
                        Status
                    </div>
                    <div class="file-info-value">
                        <span style="color: #28a745; font-weight: 600;">✓ Validated & Ready</span>
                    </div>
                </div>
            `;

            // Update file information
            fileInfo.innerHTML = fileInfoHTML;

            // Enable process button
            if (this.processFileBtn) {
                this.processFileBtn.disabled = false;
            }

            console.log('File details displayed successfully');
        } else {
            console.error('Required elements not found:', {
                fileDetails: !!fileDetails,
                uploadArea: !!uploadArea,
                fileInfo: !!fileInfo
            });
        }
    }

    clearFileSelection() {
        console.log('Clearing file selection');

        // Reset file input
        if (this.fileInput) {
            this.fileInput.value = '';
        }

        // Reset selected file
        this.selectedFile = null;

        // Hide file details and preview, show upload area
        const fileDetails = document.getElementById('fileDetails');
        const uploadArea = document.getElementById('uploadArea');
        const filePreview = document.getElementById('filePreview');

        if (fileDetails) {
            fileDetails.classList.add('d-none');
            fileDetails.style.display = 'none';
        }

        if (filePreview) {
            filePreview.classList.add('d-none');
        }

        if (uploadArea) {
            uploadArea.style.display = 'block';
        }

        // Disable process button
        if (this.processFileBtn) {
            this.processFileBtn.disabled = true;
        }

        console.log('File selection cleared');
    }

    async handleProcessFile() {
        console.log('🔍 [FRONTEND DEBUG] handleProcessFile called');

        if (!this.selectedFile) {
            console.log('🔍 [FRONTEND DEBUG] No file selected for processing');
            this.showError('Please select a file to upload');
            return;
        }

        console.log('🔍 [FRONTEND DEBUG] Starting file processing for:', {
            name: this.selectedFile.name,
            size: this.selectedFile.size,
            type: this.selectedFile.type,
            lastModified: this.selectedFile.lastModified
        });

        try {
            // Hide the upload modal first and clean up backdrop
            const uploadModal = bootstrap.Modal.getInstance(document.getElementById('flatFileUploadModal'));
            if (uploadModal) {
                uploadModal.hide();
            }

            // Force remove any remaining modal backdrops
            setTimeout(() => {
                this.cleanupModalArtifacts();
            }, 100);

            // Show professional loading modal for pre-validation
            this.showEnhancedLoadingModal('Pre-validating Excel file...');

            // Disable the process button to prevent double submission
            if (this.processFileBtn) {
                this.processFileBtn.disabled = true;
                this.processFileBtn.innerHTML = '<i class="spinner-border spinner-border-sm me-2"></i>Validating...';
            }

            // STEP 1: Pre-upload validation
            console.log('Starting pre-upload validation...');
            const preValidationResult = await this.performPreUploadValidation(this.selectedFile);

            if (!preValidationResult.isValid) {
                // Hide loading modal and show validation error modal
                this.hideEnhancedLoadingModal();
                this.showPreValidationErrorModal(preValidationResult);
                return; // Stop processing - validation failed
            }

            // Show success message for passed validation
            this.hideEnhancedLoadingModal();
            const shouldContinue = await this.showPreValidationSuccessModal(preValidationResult);

            if (!shouldContinue) {
                // User cancelled upload after validation
                console.log('User cancelled upload after successful validation');
                return;
            }

            // Show loading modal again for actual upload
            this.showEnhancedLoadingModal('Uploading file to server...');

            // Create FormData
            const formData = new FormData();
            formData.append('excelFile', this.selectedFile);
            formData.append('manual', 'true');

            // Upload file with progress tracking
            const result = await this.uploadWithProgress('/api/outbound-files-manual/upload-excel-template', formData);

            if (result.success) {
                // Check if the uploaded file exceeds document limit
                if (result.data && result.data.documents && result.data.documents.length > 100) {
                    this.hideEnhancedLoadingModal();
                    this.showError(`Upload blocked: File contains ${result.data.documents.length} documents, which exceeds the LHDN limit of 100 documents per submission. Please split your file into smaller batches.`);
                    return;
                }

                // Check for duplicate warnings
                if (result.duplicateCheck && result.duplicateCheck.warnings && result.duplicateCheck.warnings.length > 0) {
                    console.log('🔍 [DUPLICATE CHECK] Warnings found:', result.duplicateCheck.warnings);
                    this.hideEnhancedLoadingModal();
                    this.showDuplicateWarningsModal(result.duplicateCheck);
                    return;
                }

                // Update progress to completion
                this.updateRealProgress(100, 'complete');

                // Complete the progress after a short delay
                setTimeout(() => {
                    this.completeProgress();
                    let successMessage = 'File uploaded successfully';
                    if (result.duplicateCheck && result.duplicateCheck.summary) {
                        successMessage += ` (${result.duplicateCheck.summary.totalInvoices} invoices processed)`;
                    }
                    this.showSuccess(successMessage);
                    this.resetUI();
                    // Refresh the table
                    this.refreshTable();
                    // Final cleanup to ensure no modal artifacts remain
                    setTimeout(() => {
                        this.cleanupModalArtifacts();
                    }, 500);
                }, 1000);
            } else {
                // Check if this is a duplicate error
                if (result.duplicateType) {
                    this.hideEnhancedLoadingModal();
                    this.showDuplicateDetectionModal(result);
                    return;
                }
                throw new Error(result.error || 'Upload failed');
            }

        } catch (error) {
            console.error('Upload error:', error);

            // Show error state in modal for a moment before hiding
            this.showErrorState(error.message || 'Upload failed');

            setTimeout(() => {
                this.hideEnhancedLoadingModal();
                this.showError(error.message || 'Upload failed');
            }, 500);
        } finally {
            // Re-enable the process button
            if (this.processFileBtn) {
                this.processFileBtn.disabled = false;
                this.processFileBtn.innerHTML = '<i class="bi bi-play-circle me-1"></i>Process File';
            }
        }
    }

    // Enhanced Loading Modal Methods (Using same design as outbound-excel.js)
    showEnhancedLoadingModal(message = 'Uploading and Processing Your Excel Template') {
        // Remove any existing backdrop
        this.hideEnhancedLoadingModal();

        // Create and append new backdrop with enhanced UI (same as outbound-excel.js)
        const backdrop = `
            <div id="loadingBackdrop" class="excel-loading-backdrop">
                <div class="excel-loading-content">
                    <div class="excel-modal-header">
                        <div class="excel-processing-icon">
                            <div class="excel-document-stack">
                                <div class="excel-document excel-doc1"></div>
                                <div class="excel-document excel-doc2"></div>
                                <div class="excel-document excel-doc3"></div>
                            </div>

                        </div>
                        <div class="excel-processing-title">
                            <h5>${message}</h5>
                            <p>Processing Excel template. Please wait... ⏳</p>
                            <p class="excel-loading-time-estimate">Estimated time: 30 seconds - 2 minutes</p>
                            <p class="excel-loading-important">⚠️ Do not close or refresh this page. ⚠️</p>
                        </div>
                    </div>

                    <div class="excel-processing-container">
                        <div class="excel-invoice-animation">
                            <div class="excel-invoice-paper">
                                <div class="excel-invoice-header">
                                    <div class="excel-invoice-line"></div>
                                </div>
                                <div class="excel-invoice-details">
                                    <div class="excel-invoice-details-left">
                                        <div class="excel-invoice-details-line"></div>
                                        <div class="excel-invoice-details-line"></div>
                                    </div>
                                    <div class="excel-invoice-details-right">
                                        <div class="excel-invoice-details-line"></div>
                                        <div class="excel-invoice-details-line"></div>
                                    </div>
                                </div>
                                <div class="excel-invoice-table">
                                    <div class="excel-invoice-table-row">
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                    </div>
                                    <div class="excel-invoice-table-row">
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                    </div>
                                </div>
                                <div class="excel-invoice-stamp"></div>
                            </div>
                        </div>

                        <div class="excel-processing-steps">
                            <div class="excel-step-item excel-active" id="excelLoadingStep1">
                                <i class="bi bi-cloud-upload"></i>
                                <span>Uploading Excel File</span>
                            </div>
                            <div class="excel-step-arrow">→</div>
                            <div class="excel-step-item" id="excelLoadingStep2">
                                <i class="bi bi-check2-circle"></i>
                                <span>Parsing & Validating Data</span>
                            </div>
                            <div class="excel-step-arrow">→</div>
                            <div class="excel-step-item" id="excelLoadingStep3">
                                <i class="bi bi-file-text"></i>
                                <span>Processing Invoices</span>
                            </div>
                        </div>

                        <div id="excelLoadingStatusMessage" class="excel-processing-status">
                            <div class="excel-processing-circle"></div>
                            <span class="excel-status-text">Initializing Excel upload...</span>
                        </div>
                    </div>

                    <div class="excel-progress-section">
                        <div class="excel-progress-header">
                            <div class="excel-progress-info">
                                <span class="excel-progress-label">Upload Progress</span>
                                <span class="excel-progress-percentage" id="excelLoadingProgressPercentage">0%</span>
                            </div>
                            <div class="excel-document-count">
                                <i class="bi bi-file-earmark-excel"></i>
                                <span id="excelLoadingProcessedCount">Processing...</span>
                            </div>
                        </div>
                        <div class="excel-progress">
                            <div id="excelLoadingProgressBar"
                                class="excel-progress-bar progress-bar-striped progress-bar-animated"
                                role="progressbar"
                                style="width: 0%"
                                aria-valuenow="0"
                                aria-valuemin="0"
                                aria-valuemax="100">
                            </div>
                        </div>
                    </div>

                    <div class="excel-processing-info">
                        <div id="excelLoadingFact" class="excel-info-box">
                            <div class="excel-info-icon">
                                <i class="bi bi-lightbulb"></i>
                            </div>
                            <div class="excel-info-content">
                                <span class="excel-info-label">Processing Tip</span>
                                <p class="excel-info-message">Excel templates streamline invoice creation and reduce data entry errors.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', backdrop);
        $('#loadingBackdrop').fadeIn(300);

        // Start animation sequence
        this.startLoadingAnimation();
    }

    // Utility method to clean up modal artifacts
    cleanupModalArtifacts() {
        // Remove any remaining modal backdrops
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => {
            if (backdrop && !backdrop.closest('#loadingBackdrop')) {
                backdrop.remove();
            }
        });

        // Clean up body classes and styles
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }

    hideEnhancedLoadingModal() {
        // Clear any intervals
        if (this.factInterval) {
            clearInterval(this.factInterval);
        }

        $('#loadingBackdrop').fadeOut(300, () => {
            $('#loadingBackdrop').remove();

            // Ensure complete cleanup of any remaining modal artifacts
            setTimeout(() => {
                this.cleanupModalArtifacts();
            }, 100);
        });
    }

    startLoadingAnimation() {
        // Array of loading messages with progress percentages
        const loadingStates = [
            { message: 'Initializing Excel upload...', progress: 10 },
            { message: 'Uploading file to server...', progress: 25 },
            { message: 'Parsing Excel structure...', progress: 40 },
            { message: 'Validating invoice data...', progress: 55 },
            { message: 'Processing line items...', progress: 70 },
            { message: 'Applying business rules...', progress: 80 },
            { message: 'Generating invoice records...', progress: 90 },
            { message: 'Finalizing upload...', progress: 95 }
        ];

        // Array of fun facts for Excel processing
        const funFacts = [
            'Excel templates streamline invoice creation and reduce data entry errors.',
            'Automated Excel processing can save up to 75% of manual data entry time.',
            'Template-based invoicing ensures consistent data formatting.',
            'Excel validation helps catch errors before submission to LHDN.',
            'Bulk processing reduces individual invoice creation time significantly.',
            'Standardized templates improve data accuracy by 85%.',
            'Excel automation reduces processing costs by up to 60%.',
            'Template validation prevents common formatting mistakes.',
            'Batch processing improves workflow efficiency dramatically.',
            'Excel integration saves hours of manual invoice preparation.'
        ];

        let currentStateIndex = 0;
        let factIndex = 0;

        // Update progress bar and message
        const updateLoadingState = () => {
            if (!$('#loadingBackdrop').length) return;

            if (currentStateIndex < loadingStates.length) {
                const currentState = loadingStates[currentStateIndex];

                // Update message
                $('#excelLoadingStatusMessage').html(`
                    <div class="excel-status-icon">
                        <i class="bi bi-arrow-repeat excel-spin"></i>
                    </div>
                    <span class="excel-status-text">${currentState.message}</span>`);

                // Update progress
                $('#excelLoadingProgressBar').css('width', `${currentState.progress}%`);
                $('#excelLoadingProgressBar').attr('aria-valuenow', currentState.progress);
                $('#excelLoadingProgressPercentage').text(`${currentState.progress}%`);

                // Update document count - show file processing status
                if (this.selectedFile) {
                    $('#excelLoadingProcessedCount').text(`${this.selectedFile.name}`);
                } else {
                    $('#excelLoadingProcessedCount').text('Processing...');
                }

                // Update active step
                $('.excel-step-item').removeClass('excel-active');
                if (currentState.progress < 33) {
                    $('#excelLoadingStep1').addClass('excel-active');
                } else if (currentState.progress < 66) {
                    $('#excelLoadingStep2').addClass('excel-active');
                } else {
                    $('#excelLoadingStep3').addClass('excel-active');
                }

                currentStateIndex++;
            }
        };

        // Update fun facts
        const updateFunFact = () => {
            if (!$('#loadingBackdrop').length) return;

            const fact = funFacts[factIndex % funFacts.length];
            $('#excelLoadingFact').html(`
                <div class="excel-info-icon">
                    <i class="bi bi-lightbulb"></i>
                </div>
                <div class="excel-info-content">
                    <span class="excel-info-label">Processing Tip</span>
                    <p class="excel-info-message">${fact}</p>
                </div>`);

            factIndex++;
        };

        // Start sequences
        let interval = 800;
        const scheduleNextUpdate = () => {
            if (currentStateIndex < loadingStates.length && $('#loadingBackdrop').length) {
                updateLoadingState();
                interval += 200;
                setTimeout(scheduleNextUpdate, interval);
            }
        };

        scheduleNextUpdate();

        // Update fun facts every 5 seconds
        this.factInterval = setInterval(updateFunFact, 5000);
    }



    // Legacy method - now using startLoadingAnimation instead
    startProgressSimulation() {
        // This method is kept for compatibility but now delegates to the new animation
        this.startLoadingAnimation();
    }

    completeProgress() {
        // Update progress bar to 100% with new backdrop design
        $('#excelLoadingProgressBar').css('width', '100%');
        $('#excelLoadingProgressBar').attr('aria-valuenow', 100);
        $('#excelLoadingProgressPercentage').text('100%');
        $('#excelLoadingProgressBar').removeClass('progress-bar-striped progress-bar-animated');
        $('#excelLoadingProgressBar').addClass('bg-success');

        // // Update status message
        // $('#excelLoadingStatusMessage').html(`
        //     <div class="excel-status-icon">
        //         <i class="bi bi-check-circle-fill text-success"></i>
        //     </div>
        //     <span class="excel-status-text">Upload completed successfully!</span>`);

        // // Mark all steps as completed
        // $('.excel-step-item').removeClass('excel-active');
        // $('#excelLoadingStep3').addClass('excel-active');

        // // Update processing title
        // $('.excel-processing-title h5').text('Upload Complete!');
        // $('.excel-processing-title p').first().text('Your Excel file has been successfully processed. ✅');

        // Hide modal after a short delay
        setTimeout(() => {
            this.hideEnhancedLoadingModal();
        }, 1500);
    }

    showErrorState(errorMessage) {
        // Update progress bar to show error with new backdrop design
        $('#excelLoadingProgressBar').removeClass('progress-bar-striped progress-bar-animated');
        $('#excelLoadingProgressBar').addClass('bg-danger');
        $('#excelLoadingProgressBar').css('width', '100%');

        // Update status message
        $('#excelLoadingStatusMessage').html(`
            <div class="excel-status-icon">
                <i class="bi bi-exclamation-triangle-fill text-danger"></i>
            </div>
            <span class="excel-status-text">Upload failed: ${errorMessage}</span>`);

        // Update processing title
        $('.excel-processing-title h5').text('Upload Failed');
        $('.excel-processing-title p').first().text('An error occurred during processing. ❌');

        // Mark all steps as failed
        document.querySelectorAll('.step-item').forEach((item) => {
            item.classList.remove('active', 'completed');
            item.classList.add('failed');
            const spinner = item.querySelector('.step-spinner');
            const number = item.querySelector('.step-number');
            if (spinner) spinner.classList.add('d-none');
            if (number) {
                number.classList.remove('d-none');
                number.innerHTML = '<i class="bi bi-x"></i>';
            }
        });
    }

    // Upload with real progress tracking
    uploadWithProgress(url, formData) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    this.updateRealProgress(percentComplete, 'upload');
                }
            });

            // Handle response
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        // Simulate backend processing phases
                        this.updateRealProgress(100, 'upload');
                        setTimeout(() => this.updateRealProgress(50, 'parse'), 500);
                        setTimeout(() => this.updateRealProgress(80, 'validate'), 1000);

                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    // Try to parse server error message for better diagnostics
                    try {
                        const resJson = JSON.parse(xhr.responseText || '{}');
                        const serverMsg = resJson.error || resJson.message;
                        reject(new Error(serverMsg ? `HTTP ${xhr.status}: ${serverMsg}` : `HTTP ${xhr.status}: ${xhr.statusText}`));
                    } catch (parseErr) {
                        reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                    }
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error occurred'));
            });

            xhr.addEventListener('timeout', () => {
                reject(new Error('Request timeout'));
            });

            // Configure and send request
            xhr.open('POST', url);
            xhr.timeout = 300000; // 5 minutes timeout
            xhr.send(formData);
        });
    }

    // Update progress with real data
    updateRealProgress(percentage, phase) {
        const progressBar = document.getElementById('uploadProgressBar');
        if (!progressBar) return;

        let adjustedProgress = 0;
        let statusTitle = '';
        let statusDescription = '';

        switch (phase) {
            case 'upload':
                // Upload phase: 0-40% of total progress
                adjustedProgress = (percentage * 0.4);
                statusTitle = 'Uploading Excel Template';
                statusDescription = `Uploading file... ${Math.round(percentage)}% complete`;
                break;
            case 'parse':
                // Parse phase: 40-70% of total progress
                adjustedProgress = 40 + (percentage * 0.3);
                statusTitle = 'Parsing Excel Data';
                statusDescription = 'Reading Excel structure and extracting data...';
                break;
            case 'validate':
                // Validation phase: 70-90% of total progress
                adjustedProgress = 70 + (percentage * 0.2);
                statusTitle = 'Validating Invoice Data';
                statusDescription = 'Checking data format and LHDN compliance...';
                break;
            case 'complete':
                // Complete phase: 90-100% of total progress
                adjustedProgress = 90 + (percentage * 0.1);
                statusTitle = 'Processing Complete';
                statusDescription = 'Finalizing and storing processed data...';
                break;
        }

        // Update progress bar
        progressBar.style.width = adjustedProgress + '%';

        // Update status text
        const statusTitleEl = document.getElementById('currentStatusTitle');
        const statusDescriptionEl = document.getElementById('currentStatusDescription');

        // Update the new backdrop design elements
        $('#excelLoadingStatusMessage .excel-status-text').text(statusDescription);

        // Update progress if provided
        if (progress !== undefined) {
            $('#excelLoadingProgressBar').css('width', `${progress}%`);
            $('#excelLoadingProgressBar').attr('aria-valuenow', progress);
            $('#excelLoadingProgressPercentage').text(`${progress}%`);
        }
    }

    // Helper method to format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Duplicate Detection Modal Methods
    showDuplicateDetectionModal(duplicateInfo) {
        const modalHTML = `
            <div id="duplicateDetectionModal" class="custom-modal">
                <div class="modal-overlay" onclick="window.fileUploadManager.closeDuplicateDetectionModal()"></div>
                <div class="modal-content duplicate-modal">
                    <div class="modal-header">
                        <div class="d-flex align-items-center">
                            <div class="header-icon-wrapper me-3">
                                <i class="bi bi-exclamation-triangle text-warning"></i>
                            </div>
                            <div>
                                <h4 class="mb-1 fw-semibold text-warning">Duplicate Content Detected</h4>
                                <p class="mb-0 small">This file contains data that has already been processed</p>
                            </div>
                        </div>
                        <button class="btn-close-custom" onclick="window.fileUploadManager.closeDuplicateDetectionModal()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>

                    <div class="modal-body">
                        <div class="alert alert-warning">
                            <strong>Duplicate Type:</strong> ${this.getDuplicateTypeDescription(duplicateInfo.duplicateType)}
                        </div>
                        <p class="duplicate-message">${duplicateInfo.error}</p>

                        ${duplicateInfo.existingFile ? `
                            <div class="existing-file-info">
                                <h6><i class="bi bi-file-earmark-excel me-2"></i>Existing File Details:</h6>
                                <div class="info-card">
                                    <div class="info-row">
                                        <span class="info-label">Filename:</span>
                                        <span class="info-value">${duplicateInfo.existingFile.filename}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">Uploaded:</span>
                                        <span class="info-value">${new Date(duplicateInfo.existingFile.uploadDate).toLocaleString()}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">Uploaded by:</span>
                                        <span class="info-value">${duplicateInfo.existingFile.uploadedBy}</span>
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        ${duplicateInfo.duplicates && duplicateInfo.duplicates.length > 0 ? `
                            <div class="duplicate-invoices">
                                <h6><i class="bi bi-list-ul me-2"></i>Duplicate Invoices (${duplicateInfo.duplicates.length}):</h6>
                                <div class="duplicate-list">
                                    ${duplicateInfo.duplicates.slice(0, 5).map(dup => `
                                        <div class="duplicate-item">
                                            <span class="invoice-no">${dup.invoiceNo}</span>
                                            <span class="duplicate-type badge bg-${this.getDuplicateSeverityColor(dup.severity)}">${dup.duplicateType}</span>
                                        </div>
                                    `).join('')}
                                    ${duplicateInfo.duplicates.length > 5 ? `
                                        <div class="duplicate-item more-items">
                                            <span class="text-muted">... and ${duplicateInfo.duplicates.length - 5} more</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="window.fileUploadManager.closeDuplicateDetectionModal()">
                            <i class="bi bi-x-circle me-2"></i>Cancel Upload
                        </button>
                        <button class="btn btn-primary" onclick="window.fileUploadManager.viewExistingSubmissions()">
                            <i class="bi bi-eye me-2"></i>View Existing Files
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.addDuplicateModalStyles();

        // Show modal with animation
        setTimeout(() => {
            const modal = document.getElementById('duplicateDetectionModal');
            if (modal) {
                modal.classList.add('show');
            }
        }, 10);
    }

    showDuplicateWarningsModal(duplicateCheck) {
        const warnings = duplicateCheck.warnings || [];
        const summary = duplicateCheck.summary || {};

        const modalHTML = `
            <div id="duplicateWarningsModal" class="custom-modal">
                <div class="modal-overlay" onclick="window.fileUploadManager.closeDuplicateWarningsModal()"></div>
                <div class="modal-content warning-modal">
                    <div class="modal-header">
                        <div class="d-flex align-items-center">
                            <div class="header-icon-wrapper me-3">
                                <i class="bi bi-info-circle text-info"></i>
                            </div>
                            <div>
                                <h4 class="mb-1 fw-semibold text-info">Duplicate Warnings</h4>
                                <p class="mb-0 small">Some potential duplicates were found but upload can proceed</p>
                            </div>
                        </div>
                        <button class="btn-close-custom" onclick="window.fileUploadManager.closeDuplicateWarningsModal()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>

                    <div class="modal-body">
                        <div class="alert alert-info">
                            <strong>Upload Status:</strong> File processed successfully with ${summary.totalInvoices} invoices, but ${warnings.length} potential duplicates were detected.
                        </div>

                        <div class="warnings-list">
                            <h6><i class="bi bi-exclamation-triangle me-2"></i>Warnings:</h6>
                            ${warnings.map(warning => `
                                <div class="warning-item">
                                    <div class="warning-header">
                                        <span class="invoice-no">${warning.invoiceNo}</span>
                                        <span class="warning-type badge bg-warning">${warning.duplicateType}</span>
                                    </div>
                                    <div class="warning-message">${warning.message}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="window.fileUploadManager.closeDuplicateWarningsModal()">
                            <i class="bi bi-check-circle me-2"></i>Acknowledge
                        </button>
                        <button class="btn btn-primary" onclick="window.fileUploadManager.viewExistingSubmissions()">
                            <i class="bi bi-eye me-2"></i>Review Existing Files
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.addDuplicateModalStyles();

        // Show modal with animation
        setTimeout(() => {
            const modal = document.getElementById('duplicateWarningsModal');
            if (modal) {
                modal.classList.add('show');
            }
        }, 10);
    }

    closeDuplicateDetectionModal() {
        const modal = document.getElementById('duplicateDetectionModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    }

    closeDuplicateWarningsModal() {
        const modal = document.getElementById('duplicateWarningsModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                // Continue with normal success flow
                this.showSuccess('File uploaded successfully with warnings');
                this.resetUI();
                this.refreshTable();
            }, 300);
        }
    }

    viewExistingSubmissions() {
        // Navigate to submission history or open in new tab
        window.open('/outbound-excel', '_blank');
    }

    getDuplicateTypeDescription(type) {
        const descriptions = {
            'CONTENT_DUPLICATE': 'Identical file content',
            'INVOICE_DUPLICATE': 'Invoice already exists',
            'ALREADY_SUBMITTED': 'Already submitted to LHDN',
            'LHDN_RECORD': 'Found in LHDN records',
            'RECENT_UPLOAD': 'Recently uploaded',
            'SIMILAR_INVOICE': 'Similar invoice found'
        };
        return descriptions[type] || type;
    }

    getDuplicateSeverityColor(severity) {
        const colors = {
            'CRITICAL': 'danger',
            'HIGH': 'warning',
            'MEDIUM': 'info',
            'LOW': 'secondary'
        };
        return colors[severity] || 'secondary';
    }

    addDuplicateModalStyles() {
        // Check if styles already exist
        if (document.getElementById('duplicateModalStyles')) {
            return;
        }

        const styles = `
            <style id="duplicateModalStyles">
                .custom-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 9999;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.3s ease, visibility 0.3s ease;
                }

                .custom-modal.show {
                    opacity: 1;
                    visibility: visible;
                }

                .modal-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(2px);
                }

                .duplicate-modal .modal-content,
                .warning-modal .modal-content {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                    max-width: 600px;
                    width: 90%;
                    max-height: 80vh;
                    overflow-y: auto;
                }

                .duplicate-modal .modal-header,
                .warning-modal .modal-header {
                    background: #405189;
                    color: white;
                    padding: 20px 24px;
                    border-radius: 12px 12px 0 0;
                    position: relative;
                }

                .header-icon-wrapper {
                    width: 48px;
                    height: 48px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                }

                .btn-close-custom {
                    position: absolute;
                    top: 50%;
                    right: 20px;
                    transform: translateY(-50%);
                    background: rgba(255, 255, 255, 0.2);
                    border: none;
                    color: white;
                    width: 36px;
                    height: 36px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .btn-close-custom:hover {
                    background: rgba(255, 255, 255, 0.3);
                }

                .duplicate-modal .modal-body,
                .warning-modal .modal-body {
                    padding: 24px;
                }

                .info-card {
                    background: #f8f9fa;
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    padding: 16px;
                    margin-top: 12px;
                }

                .info-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                }

                .info-row:last-child {
                    margin-bottom: 0;
                }

                .info-label {
                    font-weight: 600;
                    color: #6c757d;
                }

                .info-value {
                    color: #212529;
                }

                .duplicate-list {
                    max-height: 200px;
                    overflow-y: auto;
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    padding: 12px;
                    margin-top: 12px;
                }

                .duplicate-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 0;
                    border-bottom: 1px solid #f1f3f4;
                }

                .duplicate-item:last-child {
                    border-bottom: none;
                }

                .invoice-no {
                    font-weight: 600;
                    color: #405189;
                }

                .warnings-list {
                    margin-top: 16px;
                }

                .warning-item {
                    background: #fff3cd;
                    border: 1px solid #ffeaa7;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 12px;
                }

                .warning-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .warning-message {
                    font-size: 14px;
                    color: #856404;
                }

                .duplicate-modal .modal-footer,
                .warning-modal .modal-footer {
                    padding: 20px 24px;
                    border-top: 1px solid #e9ecef;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    async handlePreviewFile() {
        console.log('handlePreviewFile called');
        console.log('🔍 [FRONTEND DEBUG] Selected file:', {
            name: this.selectedFile?.name,
            size: this.selectedFile?.size,
            type: this.selectedFile?.type,
            lastModified: this.selectedFile?.lastModified
        });

        if (!this.selectedFile) {
            console.log('🔍 [FRONTEND DEBUG] No file selected');
            this.showError('Please select a file to preview');
            return;
        }

        try {
            // Disable the preview button to prevent double submission
            if (this.previewFileBtn) {
                this.previewFileBtn.disabled = true;
                this.previewFileBtn.innerHTML = '<i class="spinner-border spinner-border-sm me-2"></i>Loading Preview...';
            }

            // Create FormData
            const formData = new FormData();
            formData.append('file', this.selectedFile);

            console.log('🔍 [FRONTEND DEBUG] Sending preview request to API');

            // Call preview API
            const response = await fetch('/api/outbound-files-manual/preview-excel', {
                method: 'POST',
                body: formData
            });

            console.log('🔍 [FRONTEND DEBUG] Preview API response:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });

            const result = await response.json();

            console.log('🔍 [FRONTEND DEBUG] Preview API result:', {
                success: result.success,
                hasData: !!result.data,
                dataType: typeof result.data,
                dataKeys: result.data ? Object.keys(result.data) : [],
                error: result.error
            });

            if (result.success) {
                console.log('🔍 [FRONTEND DEBUG] Preview data received:', result.data);
                this.displayPreview(result.data);
            } else {
                throw new Error(result.error || 'Preview failed');
            }

        } catch (error) {
            console.error('Preview error:', error);
            this.showError(error.message || 'Preview failed');
        } finally {
            // Re-enable the preview button
            // if (this.previewFileBtn) {
            //     this.previewFileBtn.disabled = false;
            //     this.previewFileBtn.innerHTML = '<i class="bi bi-eye me-2"></i><span>Preview Data</span>';
            // }
        }
    }

    displayPreview(data) {
        console.log('🔍 [FRONTEND DEBUG] displayPreview called with data:', {
            hasData: !!data,
            dataType: typeof data,
            dataKeys: data ? Object.keys(data) : [],
            hasDocuments: !!(data && data.documents),
            documentsCount: data?.documents?.length || 0,
            hasPreview: !!(data && data.preview),
            previewType: data?.preview ? typeof data.preview : null
        });

        // Store the full data for later use
        this.fullPreviewData = data;

        console.log('🔍 [FRONTEND DEBUG] Stored fullPreviewData:', this.fullPreviewData);

        // Create and show custom preview dialog
        this.showCustomPreviewDialog(data);

        console.log('🔍 [FRONTEND DEBUG] Preview displayed successfully in custom dialog');
    }

    showCustomPreviewDialog(data) {
        // Remove any existing preview dialog
        const existingDialog = document.getElementById('customPreviewDialog');
        if (existingDialog) {
            existingDialog.remove();
        }

        // Check document limit
        const totalDocuments = (data.documents || []).length;
        const documentLimitExceeded = totalDocuments > 100;

        // Create modern dialog HTML with improved design
        const dialogHTML = `
            <div id="customPreviewDialog" class="custom-preview-dialog">
                <div class="custom-preview-overlay" onclick="window.fileUploadManager.closeCustomPreviewDialog()"></div>
                <div class="custom-preview-content">
                    <div class="custom-preview-header">
                        <div class="d-flex align-items-center">
                            <div class="header-icon-wrapper me-3">
                                <i class="bi bi-eye-fill"></i>
                            </div>
                            <div>
                                <h4 class="mb-1 fw-semibold">Excel Data Preview</h4>
                                <p class="mb-0 small">Preview your Excel file data before processing</p>
                            </div>
                        </div>
                        <button class="btn-close-custom" onclick="window.fileUploadManager.closeCustomPreviewDialog()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>

                    <div class="preview-mode-notice">
                        <div class="d-flex align-items-center">
                            <i class="bi bi-info-circle text-info me-2"></i>
                            <span><strong>Preview Mode:</strong> This is a preview showing Excel structure. Full processing will happen during upload.</span>
                        </div>
                    </div>

                    <div class="custom-preview-body" id="customPreviewBody">
                        <!-- Content will be populated here -->
                    </div>
                    <div class="custom-preview-footer">
                        ${documentLimitExceeded ? `
                        <div class="alert alert-danger mb-3">
                            <div class="d-flex align-items-center">
                                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                <div>
                                    <strong>Upload Blocked:</strong> This file contains ${totalDocuments} documents, which exceeds the LHDN limit of 100 documents per submission.
                                    <br><small>Please split your file into smaller batches of 100 documents or fewer.</small>
                                </div>
                            </div>
                        </div>
                        ` : ''}
                        <div class="d-flex justify-content-end gap-3">
                            <button class="btn btn-outline-secondary" onclick="window.fileUploadManager.closeCustomPreviewDialog()">
                                <i class="bi bi-x-circle me-2"></i>Cancel
                            </button>
                            <button class="btn ${documentLimitExceeded ? 'btn-danger' : 'btn-primary'} btn-upload"
                                    ${documentLimitExceeded ? 'disabled title="Cannot upload: Exceeds 100 document limit"' : ''}
                                    onclick="window.fileUploadManager.proceedWithUpload()">
                                <i class="bi bi-${documentLimitExceeded ? 'exclamation-triangle' : 'upload'} me-2"></i>
                                ${documentLimitExceeded ? 'Upload Blocked' : 'Proceed with Upload'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add dialog to body
        document.body.insertAdjacentHTML('beforeend', dialogHTML);

        // Add custom styles
        this.addCustomPreviewStyles();

        // Populate content
        this.renderCustomPreviewContent(data);

        // Show dialog with animation
        setTimeout(() => {
            const dialog = document.getElementById('customPreviewDialog');
            if (dialog) {
                dialog.classList.add('show');
            }
        }, 10);
    }

    addCustomPreviewStyles() {
        // Check if styles already exist
        if (document.getElementById('customPreviewStyles')) {
            return;
        }

        const styles = `
            <style id="customPreviewStyles">
                .custom-preview-dialog {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 9999;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.3s ease, visibility 0.3s ease;
                }

                .custom-preview-dialog.show {
                    opacity: 1;
                    visibility: visible;
                }

                .custom-preview-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(2px);
                }

                .custom-preview-content {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: white;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .custom-preview-header {
                    background: #405189;
                    color: white;
                    padding: 24px 32px;
                    position: relative;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }

                .header-icon-wrapper {
                    width: 48px;
                    height: 48px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                }

                .btn-close-custom {
                    position: absolute;
                    top: 50%;
                    right: 24px;
                    transform: translateY(-50%);
                    background: rgba(255, 255, 255, 0.2);
                    border: none;
                    color: white;
                    width: 40px;
                    height: 40px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    transition: all 0.2s ease;
                }

                .btn-close-custom:hover {
                    background: rgba(255, 255, 255, 0.3);
                    transform: translateY(-50%) scale(1.05);
                }

                .preview-mode-notice {
                    background: #e3f2fd;
                    border: 1px solid #bbdefb;
                    border-radius: 8px;
                    padding: 16px;
                    margin: 24px 32px 0;
                    color: #1565c0;
                }

                .custom-preview-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                    background: #f8fafc;
                }

                /* Hide scrollbars for custom preview body */
                .custom-preview-body::-webkit-scrollbar {
                    display: none;
                }

                .custom-preview-body {
                    -ms-overflow-style: none;  /* IE and Edge */
                    scrollbar-width: none;  /* Firefox */
                }

                .custom-preview-footer {
                    padding: 24px 32px;
                    border-top: 1px solid #e2e8f0;
                    background: white;
                }

                .btn-upload {
                    background: #405189;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                }

                .btn-upload:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 8px 25px rgba(30, 60, 114, 0.3);
                }

                /* Card Styles */
                .summary-card, .table-card {
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                    border: 1px solid #e2e8f0;
                    overflow: hidden;
                    height: calc(100vh - 200px); /* Dynamic height based on viewport */
                    display: flex;
                    flex-direction: column;
                }

                .card-header-custom {
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                    padding: 20px 24px;
                    flex-shrink: 0; /* Prevent header from shrinking */
                }

                .card-body-custom {
                    padding: 24px;
                    flex: 1; /* Take remaining space */
                    overflow-y: auto; /* Add scrollbar when content overflows */
                }

                /* Hide scrollbars for card body custom */
                .card-body-custom::-webkit-scrollbar {
                    display: none;
                }

                .card-body-custom {
                    -ms-overflow-style: none;  /* IE and Edge */
                    scrollbar-width: none;  /* Firefox */
                }

                /* Specific styling for table card body */
                .table-card .card-body-custom {
                    padding: 0; /* Remove padding for table */
                }

                /* Table container with scrolling */
                .table-responsive {
                    flex: 1;
                    overflow-y: auto;
                    max-height: none; /* Remove max-height restriction */
                }

                /* Hide scrollbars for table responsive */
                .table-responsive::-webkit-scrollbar {
                    display: none;
                }

                .table-responsive {
                    -ms-overflow-style: none;  /* IE and Edge */
                    scrollbar-width: none;  /* Firefox */
                }

                /* Global scrollbar hiding class */
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }

                .hide-scrollbar {
                    -ms-overflow-style: none;  /* IE and Edge */
                    scrollbar-width: none;  /* Firefox */
                }

                .icon-wrapper-success {
                    width: 40px;
                    height: 40px;
                    background: #e7f5ee;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 18px;
                }

                .icon-wrapper-primary {
                    width: 40px;
                    height: 40px;
                    background: #EEF0F7;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 18px;
                }

                .table-header-custom {
                    background: #f1f5f9;
                    border-bottom: 2px solid #e2e8f0;
                }

                .table-header-custom th {
                    border: none;
                    padding: 16px 20px;
                    font-weight: 600;
                    color: #475569;
                    font-size: 14px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                /* Summary Content Styles */
                .summary-section {
                    margin-bottom: 24px;
                }

                .summary-section:last-child {
                    margin-bottom: 0;
                }

                .summary-section-title {
                    font-weight: 600;
                    color: #374151;
                    font-size: 14px;
                }

                .summary-icon-success {
                    width: 24px;
                    height: 24px;
                    background: #e7f5ee;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                }

                .summary-icon-info {
                    width: 24px;
                    height: 24px;
                    background: #EEF0F7;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                }

                .summary-items {
                    background: #f8fafc;
                    border-radius: 8px;
                    padding: 16px;
                    border: 1px solid #e2e8f0;
                }

                .summary-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 0;
                    border-bottom: 1px solid #e2e8f0;
                }

                .summary-item:last-child {
                    border-bottom: none;
                    padding-bottom: 0;
                }

                .summary-label {
                    font-size: 13px;
                    color: #6b7280;
                    font-weight: 500;
                }

                .summary-value {
                    font-size: 13px;
                    color: #374151;
                    font-weight: 600;
                    text-align: right;
                }

                .documents-table-section .table {
                    font-size: 0.85rem;
                }

                .documents-table-section .table th {
                    font-size: 0.8rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                @media (max-width: 768px) {
                    .custom-preview-content {
                        width: 98%;
                        max-height: 95vh;
                    }

                    .custom-preview-header {
                        padding: 15px 20px;
                    }

                    .custom-preview-body .structured-preview {
                        padding: 20px;
                    }

                    .custom-preview-footer {
                        padding: 15px 20px;
                    }

                    .summary-panel {
                        margin-bottom: 20px;
                    }
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    renderCustomPreviewContent(data) {
        const contentContainer = document.getElementById('customPreviewBody');
        if (!contentContainer) {
            console.error('Custom preview body not found');
            return;
        }

        // Create modern card-based preview HTML
        let previewHTML = `
            <div class="structured-preview">
                <!-- Two Column Layout: Summary + Data Table -->
                ${data.documents && data.documents.length > 0 ? `
                <div class="documents-section">
                    <div class="row g-4">
                        <!-- Left Column: Summary Information -->
                        <div class="col-lg-4">
                            <div class="summary-card">
                                <div class="card-header-custom">
                                    <div class="d-flex align-items-center">
                                        <div class="icon-wrapper-success me-3">
                                            <i class="bi bi-check-circle-fill"></i>
                                        </div>
                                        <h6 class="mb-0 fw-semibold">Processing Summary</h6>
                                    </div>
                                </div>
                                <div class="card-body-custom">
                                    <div id="processingSummary">
                                        <!-- Summary content will be populated here -->
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Right Column: Documents Table -->
                        <div class="col-lg-8">
                            <div class="table-card">
                                <div class="card-header-custom">
                                    <div class="d-flex align-items-center">
                                        <div class="icon-wrapper-primary me-3">
                                            <i class="bi bi-table"></i>
                                        </div>
                                        <h6 class="mb-0 fw-semibold">Document Details</h6>
                                    </div>
                                </div>
                                <div class="card-body-custom p-0">
                                    <div class="table-responsive">
                                        <table id="customPreviewDataTable" class="table table-hover mb-0">
                                            <thead class="table-header-custom">
                                                <tr>
                                                    <th width="60">#</th>
                                                    <th>Invoice No</th>
                                                    <th>Type</th>
                                                    <th>Currency</th>
                                                    <th>Total Amount</th>
                                                    <th>Tax Amount</th>
                                                    <th>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <!-- Document rows will be populated here -->
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        // Replace the container content
        contentContainer.innerHTML = previewHTML;

        // Initialize summary + table layout if documents exist
        if (data.documents && data.documents.length > 0) {
            setTimeout(() => {
                this.renderSummaryAndTable(data);
            }, 100);
        }
    }

    closeCustomPreviewDialog() {
        const dialog = document.getElementById('customPreviewDialog');
        if (dialog) {
            dialog.classList.remove('show');
            setTimeout(() => {
                dialog.remove();
            }, 300);
        }
    }

    proceedWithUpload() {
        // Check document limit before proceeding
        if (this.fullPreviewData && this.fullPreviewData.documents) {
            const totalDocuments = this.fullPreviewData.documents.length;
            if (totalDocuments > 100) {
                this.showError(`Cannot upload file: ${totalDocuments} documents exceeds LHDN limit of 100 documents per submission. Please split your file into smaller batches.`);
                return;
            }
        }

        // Close the preview dialog
        this.closeCustomPreviewDialog();

        // Trigger the actual upload process
        this.handleProcessFile();
    }

    renderSummaryAndTable(data) {
        // Populate the summary panel
        this.populateProcessingSummary(data);

        // Populate the documents table
        this.populateDocumentsTable(data.documents);
    }

    populateProcessingSummary(data) {
        const summaryContainer = document.getElementById('processingSummary');
        if (!summaryContainer) {
            console.error('Processing summary container not found');
            return;
        }

        // Calculate statistics from documents
        const documents = data.documents || [];
        const totalDocuments = documents.length;

        // Check document limit (100 documents per submission as per LHDN requirements)
        const documentLimitExceeded = totalDocuments > 100;

        // Calculate totals
        let totalAmount = 0;
        let totalTaxAmount = 0;
        const invoiceTypes = {};
        const currencies = {};

        documents.forEach(doc => {
            // Sum amounts
            const docTotal = parseFloat(doc.legalMonetaryTotal?.totalPayableAmount || doc.legalMonetaryTotal?.taxInclusiveAmount || 0);
            const docTax = parseFloat(doc.legalMonetaryTotal?.taxAmount || doc.taxInformation?.taxAmount || 0);

            totalAmount += docTotal;
            totalTaxAmount += docTax;

            // Count invoice types
            const type = doc.invoiceType || 'Unknown';
            invoiceTypes[type] = (invoiceTypes[type] || 0) + 1;

            // Count currencies
            const currency = doc.currency || 'MYR';
            currencies[currency] = (currencies[currency] || 0) + 1;
        });

        // Create modern summary HTML
        const summaryHTML = `
            <div class="summary-content">
                <!-- Processing Results -->
                <div class="summary-section mb-4">
                    <div class="d-flex align-items-center mb-3">
                        <div class="summary-icon-success me-2">
                            <i class="bi bi-check-circle-fill"></i>
                        </div>
                        <span class="summary-section-title">Processing Results</span>
                    </div>
                    <div class="summary-items">
                        <div class="summary-item">
                            <span class="summary-label">Success:</span>
                            <span class="summary-value text-success fw-semibold">✓ true</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">Filename:</span>
                            <span class="summary-value">${data.filename || 'N/A'}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">Processing Time:</span>
                            <span class="summary-value">${data.processingTime || 'N/A'} ms</span>
                        </div>
                    </div>
                </div>

                <!-- Filename Validation -->
                ${data.filenameValidation ? `
                <div class="summary-section mb-4">
                    <div class="d-flex align-items-center mb-3">
                        <div class="summary-icon-info me-2">
                            <i class="bi bi-file-check-fill"></i>
                        </div>
                        <span class="summary-section-title">Filename Validation</span>
                    </div>
                    <div class="summary-items">
                        <div class="summary-item">
                            <span class="summary-label">Valid:</span>
                            <span class="summary-value text-success fw-semibold">✓ ${data.filenameValidation.isValid}</span>
                        </div>
                        ${data.filenameValidation.parsedData ? `
                        <div class="summary-item">
                            <span class="summary-label">Parsed Date:</span>
                            <span class="summary-value">${data.filenameValidation.parsedData.formattedDate || 'N/A'}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">Parsed Time:</span>
                            <span class="summary-value">${data.filenameValidation.parsedData.formattedTime || 'N/A'}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}

                <!-- Document Statistics -->
                <div class="summary-section mb-4">
                    <div class="d-flex align-items-center mb-3">
                        <div class="summary-icon-info me-2">
                            <i class="bi bi-graph-up-arrow"></i>
                        </div>
                        <span class="summary-section-title">Document Statistics</span>
                    </div>
                    <div class="summary-items">
                        <div class="summary-item">
                            <span class="summary-label">Documents Found:</span>
                            <span class="summary-value">
                                <span class="badge ${documentLimitExceeded ? 'bg-danger' : 'bg-info'}">${totalDocuments}</span>
                                ${documentLimitExceeded ? '<small class="text-danger ms-2">⚠️ Exceeds limit</small>' : ''}
                            </span>
                        </div>
                        ${documentLimitExceeded ? `
                        <div class="summary-item">
                            <span class="summary-label">Limit Status:</span>
                            <span class="summary-value text-danger fw-semibold">
                                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                                Exceeds LHDN limit of 100 documents per submission
                            </span>
                        </div>
                        ` : `
                        <div class="summary-item">
                            <span class="summary-label">Limit Status:</span>
                            <span class="summary-value text-success fw-semibold">
                                <i class="bi bi-check-circle-fill me-1"></i>
                                Within LHDN limit (${totalDocuments}/100)
                            </span>
                        </div>
                        `}
                        <div class="summary-item">
                            <span class="summary-label">Total Amount:</span>
                            <span class="summary-value text-success fw-bold">${this.formatCurrency(totalAmount)}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">Total Tax:</span>
                            <span class="summary-value text-warning fw-bold">${this.formatCurrency(totalTaxAmount)}</span>
                        </div>
                    </div>
                </div>

                <!-- Invoice Types -->
                <div class="summary-section mb-4">
                    <div class="d-flex align-items-center mb-3">
                        <div class="summary-icon-success me-2">
                            <i class="bi bi-pie-chart-fill"></i>
                        </div>
                        <span class="summary-section-title">Invoice Types</span>
                    </div>
                    <div class="summary-items">
                        ${Object.entries(invoiceTypes).map(([type, count]) => `
                            <div class="summary-item">
                                <span class="summary-label">Type ${type}:</span>
                                <span class="summary-value"><span class="badge bg-secondary">${count}</span></span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                ${data.excelStructure ? `
                <!-- Excel File Structure -->
                <div class="summary-section">
                    <div class="d-flex align-items-center mb-3">
                        <div class="summary-icon-info me-2">
                            <i class="bi bi-table"></i>
                        </div>
                        <span class="summary-section-title">Excel Structure</span>
                    </div>
                    <div class="summary-items">
                        <div class="summary-item">
                            <span class="summary-label">Total Rows:</span>
                            <span class="summary-value fw-semibold">${data.excelStructure.totalRows}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">Preview Rows:</span>
                            <span class="summary-value fw-semibold">${data.excelStructure.previewRows}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">Columns:</span>
                            <span class="summary-value fw-semibold">${data.excelStructure.headers?.length || 0}</span>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        summaryContainer.innerHTML = summaryHTML;
    }

    populateDocumentsTable(documents) {
        const table = document.getElementById('customPreviewDataTable');
        if (!table) {
            console.error('Documents table not found');
            return;
        }

        const tbody = table.querySelector('tbody');
        if (!tbody) {
            console.error('Table body not found');
            return;
        }

        // Clear existing rows
        tbody.innerHTML = '';

        if (!documents || documents.length === 0) {
            console.warn('No documents to display');
            return;
        }

        // Add document rows
        documents.forEach((doc, index) => {
            const row = document.createElement('tr');

            // Index Number
            const indexCell = document.createElement('td');
            indexCell.innerHTML = `<span class="badge bg-light text-dark fw-bold">${index + 1}</span>`;
            indexCell.className = 'text-center';
            row.appendChild(indexCell);

            // Invoice Number
            const invoiceCell = document.createElement('td');
            invoiceCell.textContent = doc.invoiceNo || doc.documentNumber || `Doc ${index + 1}`;
            row.appendChild(invoiceCell);

            // Invoice Type
            const typeCell = document.createElement('td');
            typeCell.innerHTML = `<span class="badge bg-secondary">${doc.invoiceType || 'N/A'}</span>`;
            row.appendChild(typeCell);

            // Currency
            const currencyCell = document.createElement('td');
            currencyCell.innerHTML = `<span class="badge" style="background-color: #1a365d; color: white;">${doc.currency || 'MYR'}</span>`;
            row.appendChild(currencyCell);

            // Total Amount
            const totalCell = document.createElement('td');
            const totalAmount = doc.legalMonetaryTotal?.totalPayableAmount || doc.legalMonetaryTotal?.taxInclusiveAmount;
            totalCell.innerHTML = `<span class="text-success fw-bold">${this.formatCurrency(totalAmount, doc.currency)}</span>`;
            row.appendChild(totalCell);

            // Tax Amount
            const taxCell = document.createElement('td');
            const taxAmount = doc.legalMonetaryTotal?.taxAmount || doc.taxInformation?.taxAmount;
            taxCell.innerHTML = `<span class="text-warning fw-bold">${this.formatCurrency(taxAmount, doc.currency)}</span>`;
            row.appendChild(taxCell);

            // Status
            const statusCell = document.createElement('td');
            const status = doc.isPreview ? 'Preview' : 'Ready to Submit';
            const badgeClass = doc.isPreview ? 'bg-info' : 'bg-success';
            statusCell.innerHTML = `<span class="badge ${badgeClass}">${status}</span>`;
            row.appendChild(statusCell);

            tbody.appendChild(row);
        });
    }

    formatCurrency(amount, currency = 'MYR') {
        if (!amount || amount === '') return '0.00';

        const num = parseFloat(amount);
        if (isNaN(num)) return amount;

        try {
            return new Intl.NumberFormat('en-MY', {
                style: 'currency',
                currency: currency
            }).format(num);
        } catch (error) {
            return `${currency} ${num.toFixed(2)}`;
        }
    }

    renderCustomPreviewDataTable(documents) {
        try {
            // Check if the table element exists
            const tableElement = document.getElementById('customPreviewDataTable');
            if (!tableElement) {
                console.error('Custom preview data table element not found');
                return;
            }

            // Destroy existing DataTable if it exists
            if ($.fn.DataTable.isDataTable('#customPreviewDataTable')) {
                $('#customPreviewDataTable').DataTable().destroy();
            }

            // Transform documents data for DataTable
            const tableData = documents.map((doc, index) => {
                // Extract key information for table display
                const supplierCompany = doc.supplier?.company || 'N/A';
                const supplierTin = doc.supplier?.identifications?.tin || 'N/A';
                const buyerCompany = doc.buyer?.company || 'N/A';
                const buyerTin = doc.buyer?.identifications?.tin || 'N/A';

                // Handle monetary totals
                const totalAmount = doc.legalMonetaryTotal?.totalPayableAmount ||
                                   doc.legalMonetaryTotal?.taxInclusiveAmount || '0.00';
                const taxAmount = doc.legalMonetaryTotal?.taxAmount ||
                                 doc.taxInformation?.taxAmount || '0.00';
                const taxRate = doc.taxInformation?.taxRate || '0';

                // Count line items
                const lineItemsCount = doc.lineItems ? doc.lineItems.length : 0;

                // Determine status
                const status = doc.isPreview ? 'Preview Mode' : 'Ready to Submit';

                return {
                    documentNumber: doc.documentNumber || (index + 1),
                    invoiceNo: doc.invoiceNo || 'N/A',
                    invoiceType: doc.invoiceType || 'N/A',
                    supplierCompany: supplierCompany,
                    supplierTin: supplierTin,
                    buyerCompany: buyerCompany,
                    buyerTin: buyerTin,
                    currency: doc.currency || 'MYR',
                    totalAmount: totalAmount,
                    taxAmount: taxAmount,
                    taxRate: taxRate,
                    lineItemsCount: lineItemsCount,
                    status: status,
                    rawData: doc // Store full document data for potential detail view
                };
            });

            // Initialize DataTable
            const table = $('#customPreviewDataTable').DataTable({
                data: tableData,
                columns: [
                    {
                        data: 'documentNumber',
                        title: 'Doc #',
                        width: '60px',
                        className: 'text-center'
                    },
                    {
                        data: 'invoiceNo',
                        title: 'Invoice No',
                        width: '120px'
                    },
                    {
                        data: 'invoiceType',
                        title: 'Type',
                        width: '80px',
                        className: 'text-center'
                    },
                    {
                        data: 'supplierCompany',
                        title: 'Supplier',
                        width: '180px',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                const maxLength = 20;
                                if (data.length > maxLength) {
                                    return `<span title="${data}">${data.substring(0, maxLength)}...</span>`;
                                }
                            }
                            return data;
                        }
                    },
                    {
                        data: 'supplierTin',
                        title: 'Supplier TIN',
                        width: '120px'
                    },
                    {
                        data: 'buyerCompany',
                        title: 'Buyer',
                        width: '150px',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                const maxLength = 20;
                                if (data.length > maxLength) {
                                    return `<span title="${data}">${data.substring(0, maxLength)}...</span>`;
                                }
                            }
                            return data;
                        }
                    },
                    {
                        data: 'buyerTin',
                        title: 'Buyer TIN',
                        width: '120px'
                    },
                    {
                        data: 'currency',
                        title: 'Currency',
                        width: '80px',
                        className: 'text-center'
                    },
                    {
                        data: 'totalAmount',
                        title: 'Total Amount',
                        width: '120px',
                        className: 'text-end',
                        render: function(data, type, row) {
                            if (type === 'display' && data !== '0.00' && data !== 'Preview Mode') {
                                // Try to format as currency if it's a number
                                const num = parseFloat(data);
                                if (!isNaN(num)) {
                                    return new Intl.NumberFormat('en-MY', {
                                        style: 'currency',
                                        currency: row.currency || 'MYR'
                                    }).format(num);
                                }
                            }
                            return data;
                        }
                    },
                    {
                        data: 'taxAmount',
                        title: 'Tax Amount',
                        width: '120px',
                        className: 'text-end',
                        render: function(data, type, row) {
                            if (type === 'display' && data !== '0.00' && data !== 'Preview Mode') {
                                const num = parseFloat(data);
                                if (!isNaN(num)) {
                                    return new Intl.NumberFormat('en-MY', {
                                        style: 'currency',
                                        currency: row.currency || 'MYR'
                                    }).format(num);
                                }
                            }
                            return data;
                        }
                    },
                    {
                        data: 'taxRate',
                        title: 'Tax Rate',
                        width: '80px',
                        className: 'text-center',
                        render: function(data, type, row) {
                            if (type === 'display' && data !== '0' && data !== 'Preview Mode') {
                                const num = parseFloat(data);
                                if (!isNaN(num)) {
                                    return `${num}%`;
                                }
                            }
                            return data;
                        }
                    },
                    {
                        data: 'lineItemsCount',
                        title: 'Line Items',
                        width: '80px',
                        className: 'text-center'
                    },
                    {
                        data: 'status',
                        title: 'Status',
                        width: '100px',
                        className: 'text-center',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (data === 'Preview Mode') {
                                    return '<span class="badge bg-info">Preview</span>';
                                } else {
                                    return '<span class="badge bg-success">Ready to Submit</span>';
                                }
                            }
                            return data;
                        }
                    }
                ],
                pageLength: 10,
                lengthMenu: [[5, 10, 25, 50], [5, 10, 25, 50]],
                scrollX: true,
                scrollCollapse: true,
                autoWidth: false,
                responsive: true,
                dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>' +
                     '<"row"<"col-sm-12"tr>>' +
                     '<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
                language: {
                    lengthMenu: "Show _MENU_ documents per page",
                    info: "Showing _START_ to _END_ of _TOTAL_ documents",
                    infoEmpty: "No documents found",
                    infoFiltered: "(filtered from _MAX_ total documents)",
                    emptyTable: "No document data available",
                    zeroRecords: "No matching documents found"
                },
                order: [[0, 'asc']] // Order by document number
            });

            // Store table reference for potential future use
            this.customPreviewTable = table;

            console.log(`Custom Preview DataTable initialized with ${tableData.length} documents`);
        } catch (error) {
            console.error('Error initializing custom preview DataTable:', error);
            // Fallback: show a simple table with basic data
            const tableElement = document.getElementById('customPreviewDataTable');
            if (tableElement) {
                let fallbackHTML = `
                    <thead class="table-dark">
                        <tr>
                            <th>Document #</th>
                            <th>Invoice No</th>
                            <th>Supplier</th>
                            <th>Buyer</th>
                            <th>Total Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                `;

                // Add basic document data
                documents.forEach((doc, index) => {
                    const supplierName = doc.supplier?.company || 'N/A';
                    const buyerName = doc.buyer?.company || 'N/A';
                    const totalAmount = doc.legalMonetaryTotal?.totalPayableAmount || 'N/A';
                    const status = doc.isPreview ? 'Preview' : 'Ready to Submit';

                    fallbackHTML += `
                        <tr>
                            <td>${doc.documentNumber || (index + 1)}</td>
                            <td>${doc.invoiceNo || 'N/A'}</td>
                            <td>${supplierName  || 'Multiple Supplier'}</td>
                            <td>${buyerName}</td>
                            <td>${totalAmount}</td>
                            <td><span class="badge ${status === 'Preview' ? 'bg-info' : 'bg-success'}">${status}</span></td>
                        </tr>
                    `;
                });

                fallbackHTML += '</tbody>';
                tableElement.innerHTML = fallbackHTML;
            }
        }
    }

    resetUI() {
        this.selectedFile = null;
        if (this.fileInput) this.fileInput.value = '';

        const fileDetails = document.getElementById('fileDetails');
        const uploadArea = document.getElementById('uploadArea');
        const filePreview = document.getElementById('filePreview');

        if (fileDetails && uploadArea) {
            fileDetails.style.display = 'none';
            uploadArea.style.display = 'block';
        }

        if (filePreview) {
            filePreview.classList.add('d-none');
        }

        if (this.processFileBtn) {
            this.processFileBtn.disabled = true;
        }
    }

    refreshTable() {
        // Force refresh the DataTable
        sessionStorage.setItem('forceRefreshOutboundTable', 'true');
        if (window.invoiceTableManager && window.invoiceTableManager.table) {
            window.invoiceTableManager.table.ajax.reload();
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showError(message) {
        console.error('File upload error:', message);

        const isDuplicateError = typeof message === 'string' && message.includes('has already been uploaded');
        const title = isDuplicateError ? 'Duplicate File Detected' : 'Upload Error';

        let details = message || 'An unexpected error occurred while uploading your file.';
        if (isDuplicateError) {
            details += '\n\nWhat you can do:\n• Rename your file with a different timestamp\n• Delete the existing file from the table below\n• Check if the file was already processed successfully';
        }

        if (window.toastNotification && typeof window.toastNotification.error === 'function') {
            window.toastNotification.error(title, details, 7000);
        } else if (window.showToast && typeof window.showToast.error === 'function') {
            window.showToast.error(title, details, 7000);
        } else {
            // Fallback
            alert(`${title}: ${details}`);
        }
    }

    showSuccess(message) {
        const title = 'Upload Successful!';
        const details = message || 'File uploaded successfully';

        if (window.toastNotification && typeof window.toastNotification.success === 'function') {
            window.toastNotification.success(title, details, 4000);
        } else if (window.showToast && typeof window.showToast.success === 'function') {
            window.showToast.success(title, details, 4000);
        } else {
            console.log(`${title}: ${details}`);
        }
    }

    // Pre-upload validation function
    async performPreUploadValidation(file) {
        try {
            console.log('Starting pre-upload validation for file:', file.name);

            // Create FormData for validation endpoint
            const formData = new FormData();
            formData.append('excelFile', file);
            formData.append('validateOnly', 'true'); // Flag to indicate validation-only mode

            // Call validation endpoint
            const response = await fetch('/api/outbound-files-manual/validate-excel', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Validation request failed');
            }

            return result;

        } catch (error) {
            console.error('Pre-upload validation error:', error);
            return {
                isValid: false,
                error: error.message || 'Validation failed',
                details: [],
                totalDocuments: 0,
                failedDocuments: 0
            };
        }
    }

    // Show pre-validation error modal using custom data quality modal
    showPreValidationErrorModal(validationResult) {
        console.log('🎯 showPreValidationErrorModal called with:', validationResult);

        // Transform the validation result to match the expected format for our custom modal
        const transformedError = this.transformValidationResultToErrorFormat(validationResult);

        // Use our own custom validation error modal instead of relying on outbound-excel.js
        console.log('✅ Using custom validation error modal');
        this.createPreValidationErrorModal(transformedError);
    }

    // Create pre-validation error modal (similar to the bulk submission validation modal)
    createPreValidationErrorModal(errorData) {
        // Store error data globally for access by global functions
        window.currentValidationErrorData = errorData;

        const { validationErrors = [] } = errorData;

        // Count unique invoices that have errors, not total error count
        const uniqueInvoices = new Set();
        validationErrors.forEach(error => {
            if (error.invoiceNumber) {
                uniqueInvoices.add(error.invoiceNumber);
            }
        });

        const failedDocuments = uniqueInvoices.size;
        const totalErrorCount = validationErrors.length;
        const totalDocuments = failedDocuments; // For pre-validation, we only know about failed ones

        // Add styles for the error modal (reuse the same styles)
        const errorModalStyles = `
            <style id="preValidationErrorModalStyles">
                /* Error Modal Theme */
                :root{ --error-brand:#dc2626; --error-brand-800:#b91c1c; --error-ink:#1f2937 }

                /* Modal Backdrop */
                .pre-validation-error-backdrop{ position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; overflow-y:auto }
                .pre-error-card{ max-width:800px; width:100%; max-height:85vh; background:#fff; border-radius:16px; box-shadow:0 4px 12px rgba(0,0,0,.15); display:flex; flex-direction:column; margin:auto; overflow:hidden }

                /* Header */
                .pre-error-header{ display:flex; align-items:center; gap:12px; padding:16px 20px; background:linear-gradient(180deg,var(--error-brand),var(--error-brand-800)); color:#fff; box-shadow:inset 0 -1px rgba(255,255,255,.05) }
                .pre-error-icon{ width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.2) }
                .pre-error-title{ font-size:18px; font-weight:700; letter-spacing:.3px; color:#fff; margin:0 }
                .pre-error-sub{ font-size:13px; color:#fecaca; margin:2px 0 0 0; opacity:0.9 }

                /* Body */
                .pre-error-body{ padding:24px; flex:1; overflow-y:auto; }
                .pre-error-footer{ display:flex; justify-content:center; gap:12px; padding:16px 24px 24px; flex-shrink:0; background:#fff; border-top:1px solid #f3f4f6; }

                /* Hero Section */
                .pre-error-hero{ display:flex; flex-direction:column; align-items:center; justify-content:center; margin:0 0 20px; text-align:center }
                .pre-error-ring{ display:grid; place-items:center; width:80px; height:80px; border-radius:50%; background:radial-gradient(60% 60% at 50% 40%, rgba(220,38,38,.15), rgba(220,38,38,0) 70%); position:relative; margin:0 auto }
                .pre-error-ring::before{ content:''; position:absolute; inset:0; border-radius:50%; border:3px solid var(--error-brand); box-shadow:0 4px 20px rgba(220,38,38,.2) }
                .pre-error-x{ fill:none; stroke:var(--error-brand); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation: pre-stroke .6s ease forwards .2s }

                /* Badge and Messages */
                .pre-error-badge{ display:inline-flex; align-items:center; gap:8px; font-weight:600; color:#991b1b; background:#fee2e2; border:1px solid #fca5a5; padding:8px 16px; border-radius:999px; margin:0 auto 16px; font-size:14px; max-width:fit-content }
                .pre-error-badge i{ margin-right:4px; font-size:14px }
                .pre-error-msg{ margin:0 0 20px; color:#1f2937; line-height:1.5; font-weight:500; font-size:16px }

                /* Error Details */
                .pre-error-details{ margin:20px 0; text-align:left }
                .pre-error-section{ margin:16px 0 }
                .pre-error-section-title{ font-weight:700; margin-bottom:12px; color:#1f2937; font-size:15px; display:flex; align-items:center; gap:8px }
                .pre-error-section-title i{ margin-right:4px; font-size:14px; color:#4b5563 }
                .pre-error-list{ max-height:300px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:8px; background:#fafafa }

                /* Individual Error Items */
                .pre-error-item{ border-bottom:1px solid #e5e7eb; padding:16px; background:#fff }
                .pre-error-item:last-child{ border-bottom:none }
                .pre-error-invoice{ font-weight:600; color:#1f2937; margin-bottom:8px; display:flex; align-items:center; gap:8px }
                .pre-error-invoice-icon{ color:#3b82f6; font-size:14px; margin-right:4px }
                .pre-error-field{ margin:8px 0; padding:8px 12px; background:#f9fafb; border-radius:6px; border-left:3px solid var(--error-brand) }
                .pre-error-field-name{ font-weight:600; color:#1f2937; font-size:13px }
                .pre-error-field-issue{ color:#4b5563; margin:4px 0; font-size:14px }
                .pre-error-field-value{ font-family:monospace; background:#f3f4f6; padding:2px 6px; border-radius:4px; font-size:12px; color:#1f2937 }

                /* Enhanced Error Item Styles */
                .pre-error-item.critical{ border-left:4px solid #dc2626; background:linear-gradient(135deg, #fef2f2 0%, #fef7f7 100%) }
                .pre-error-item.warning{ border-left:4px solid #d97706; background:linear-gradient(135deg, #fef3c7 0%, #fef9e7 100%) }
                .pre-error-item.info{ border-left:4px solid #0369a1; background:linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%) }
                .pre-error-item:hover{ background:#f1f3f4; transform:translateY(-1px); box-shadow:0 2px 8px rgba(0,0,0,0.1); transition:all 0.2s ease }

                .pre-error-header{ display:flex; align-items:flex-start; gap:12px; margin-bottom:12px }
                .pre-error-severity{ display:flex; align-items:center; gap:4px; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; flex-shrink:0 }
                .pre-error-item.critical .pre-error-severity{ background:#dc2626; color:white }
                .pre-error-item.warning .pre-error-severity{ background:#d97706; color:white }
                .pre-error-item.info .pre-error-severity{ background:#0369a1; color:white }
                .pre-error-title{ font-weight:600; color:#f7f9fb; font-size:15px; line-height:1.4; flex:1 }

                .pre-error-details{ margin-top:12px; padding-top:12px; border-top:1px dashed #dee2e6 }
                .pre-error-problem, .pre-error-solution, .pre-error-current-value{ margin-bottom:8px; font-size:14px; line-height:1.5 }
                .pre-error-problem strong, .pre-error-solution strong, .pre-error-current-value strong{ color:#1d2b39; font-weight:600 }
                .pre-error-problem{ color:#4b5563 }
                .pre-error-solution{ color:#047857 }
                .pre-error-current-value code{ background:#d2b39; padding:2px 6px; border-radius:4px; font-family:'Monaco','Menlo','Ubuntu Mono',monospace; font-size:13px; color:#374151; border:1px solid #d1d5db }

                /* Buttons */
                .pre-error-btn{ cursor:pointer; user-select:none; border:none; border-radius:8px; padding:12px 24px; font-weight:600; transition: all .2s ease; font-size:14px; display:inline-flex; align-items:center; gap:8px; min-width:120px; justify-content:center }
                .pre-error-btn i{ margin-right:6px; font-size:14px }
                .pre-error-btn-primary{ background:#dc2626; color:#fff; box-shadow:0 2px 4px rgba(220,38,38,.2) }
                .pre-error-btn-primary:hover{ background:#b91c1c; box-shadow:0 4px 12px rgba(220,38,38,.3); transform: translateY(-1px) }
                .pre-error-btn-secondary{ background:#6b7280; color:#fff; box-shadow:0 2px 4px rgba(107,114,128,.2) }
                .pre-error-btn-secondary:hover{ background:#4b5563; box-shadow:0 4px 12px rgba(107,114,128,.3); transform: translateY(-1px) }
                .pre-error-btn:active{ transform: translateY(0) }
                .pre-error-btn:focus{ outline:2px solid rgba(220,38,38,.4); outline-offset:2px }

                /* Responsive */
                @media (max-width: 768px){
                    .pre-validation-error-backdrop{ padding:12px; align-items:center; padding-top:20px }
                    .pre-error-card{ max-width:100%; max-height:calc(100vh - 40px); min-height:auto }
                    .pre-error-header{ padding:14px 16px }
                    .pre-error-title{ font-size:16px }
                    .pre-error-body{ padding:16px; }
                    .pre-error-footer{ padding:12px 16px 16px; gap:8px }
                    .pre-error-ring{ width:60px; height:60px }
                    .pre-error-list{ max-height:200px }
                    .pre-error-btn{ padding:10px 16px; font-size:13px; min-width:100px }
                }

                @media (max-width: 640px){
                    .pre-validation-error-backdrop{ padding:8px; padding-top:16px; align-items:center }
                    .pre-error-card{ max-height:calc(100vh - 32px) }
                    .pre-error-header{ padding:12px 14px }
                    .pre-error-title{ font-size:15px }
                    .pre-error-sub{ font-size:12px }
                    .pre-error-body{ padding:14px }
                    .pre-error-footer{ flex-direction:column; padding:10px 14px 14px; gap:10px }
                    .pre-error-btn{ width:100%; padding:12px; font-size:14px; min-height:44px }
                    .pre-error-ring{ width:50px; height:50px }
                    .pre-error-list{ max-height:150px }
                    .pre-error-item{ padding:12px }
                    .pre-error-msg{ font-size:15px }
                }

                @media (max-width: 480px){
                    .pre-validation-error-backdrop{ padding:4px; padding-top:12px; align-items:center }
                    .pre-error-card{ max-height:calc(100vh - 24px); border-radius:12px }
                    .pre-error-header{ padding:10px 12px }
                    .pre-error-title{ font-size:14px }
                    .pre-error-body{ padding:12px }
                    .pre-error-footer{ padding:8px 12px 12px }
                    .pre-error-btn{ min-height:48px; font-size:15px }
                    .pre-error-list{ max-height:120px }
                    .pre-error-item{ padding:10px }
                }

                @media (max-height: 600px){
                    .pre-validation-error-backdrop{ align-items:flex-start; padding-top:10px }
                    .pre-error-card{ max-height:calc(100vh - 20px) }
                    .pre-error-list{ max-height:120px }
                    .pre-error-ring{ width:50px; height:50px }
                }

                /* Animations */
                @keyframes pre-stroke{ to { stroke-dashoffset:0 } }
                @media (prefers-reduced-motion: reduce){ *{ animation: none !important } .pre-error-x{ stroke-dashoffset:0 !important } }
            </style>`;

        // Build error details HTML with enhanced user-friendly format
        let errorDetailsHtml = '';
        validationErrors.forEach((error, index) => {
            // Use the enhanced error format if available, otherwise fall back to legacy format
            const title = error.title || `${error.message}`;
            const problem = error.problem || error.message || 'Unknown issue';
            const solution = error.solution || error.suggestion || 'Please review and correct this field';
            const severity = error.severity || 'Warning';
            const severityClass = severity.toLowerCase();
            const severityIcon = severity === 'Critical' ? 'fas fa-exclamation-circle' :
                                severity === 'Warning' ? 'fas fa-exclamation-triangle' :
                                'fas fa-info-circle';

            errorDetailsHtml += `
                <div class="pre-error-item ${severityClass}">
                    <div class="pre-error-header">
                        <div class="pre-error-severity">
                            <i class="${severityIcon}"></i>
                            <span class="pre-error-severity-text">${severity}</span>
                        </div>
                        <div class="pre-error-title">${title}</div>
                    </div>
                    <div class="pre-error-details">
                        <div class="pre-error-problem">
                            <strong>Issue:</strong> ${problem}
                        </div>
                        <div class="pre-error-solution">
                            <strong>How to fix:</strong> ${solution}
                        </div>
                        ${error.value ? `
                            <div class="pre-error-current-value">
                                <strong>Current value:</strong> <code>${error.value}</code>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        const modalHtml = `
            <div id="preValidationErrorBackdrop" class="pre-validation-error-backdrop">
                <div class="pre-error-card">
                    <div class="pre-error-header">
                        <div class="pre-error-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                        </div>
                        <div>
                            <div class="pre-error-title">Pre-Upload Validation Failed</div>
                            <div class="pre-error-sub">Excel File Validation</div>
                        </div>
                    </div>

                    <div class="pre-error-body">
                        <div class="pre-error-hero">
                            <div class="pre-error-ring">
                                <svg class="pre-error-x" width="32" height="32" viewBox="0 0 24 24">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </div>
                            <div class="pre-error-badge">
                                <i class="fas fa-exclamation-circle"></i>
                                ${failedDocuments} out of ${failedDocuments} invoices failed validation
                            </div>
                            <div class="pre-error-msg">All invoices in this file must pass validation before any can be submitted.</div>
                        </div>

                        <div class="pre-error-details">
                            <div class="pre-error-section">
                                <div class="pre-error-section-title">
                                    <i class="fas fa-list"></i>
                                    Validation Errors by Invoice:
                                </div>
                                <div class="pre-error-list">
                                    ${errorDetailsHtml}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="pre-error-footer">
                        <button class="pre-error-btn pre-error-btn-secondary" id="closePreErrorModalBtn" onclick="closePreValidationErrorModal()">
                            <i class="fas fa-times"></i>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing styles and modal
        const existingStyles = document.getElementById('preValidationErrorModalStyles');
        if (existingStyles) existingStyles.remove();
        const existingModal = document.getElementById('preValidationErrorBackdrop');
        if (existingModal) existingModal.remove();

        // Add styles and modal to page
        document.head.insertAdjacentHTML('beforeend', errorModalStyles);
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Add click outside to close
        const backdrop = document.getElementById('preValidationErrorBackdrop');
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                window.closePreValidationErrorModal();
            }
        });

        // Add escape key to close
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                window.closePreValidationErrorModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    // Transform validation result to match the format expected by showExcelValidationError
    transformValidationResultToErrorFormat(validationResult) {
        const { details = [], totalDocuments = 0, failedDocuments = 0, error, summary = {} } = validationResult;

        console.log('🔄 Transforming validation result:', validationResult);

        // Create validation errors array in the expected format
        const validationErrors = [];

        if (details && typeof details === 'object' && !Array.isArray(details)) {
            // Handle the new backend format with categorized errors
            console.log('🔍 Processing details object with keys:', Object.keys(details));
            console.log('🔍 Full details object:', details);
            Object.keys(details).forEach(invoiceNumber => {
                const invoiceErrors = details[invoiceNumber];
                console.log(`🔍 Processing invoice ${invoiceNumber}:`, invoiceErrors);

                // Process critical errors
                if (invoiceErrors.critical && Array.isArray(invoiceErrors.critical)) {
                    console.log(`🔴 Found ${invoiceErrors.critical.length} critical errors for ${invoiceNumber}`);
                    invoiceErrors.critical.forEach(err => {
                        validationErrors.push(this.formatUserFriendlyError(err, invoiceNumber, 'Critical'));
                    });
                }

                // Process warning errors
                if (invoiceErrors.warning && Array.isArray(invoiceErrors.warning)) {
                    console.log(`⚠️ Found ${invoiceErrors.warning.length} warning errors for ${invoiceNumber}`);
                    invoiceErrors.warning.forEach(err => {
                        validationErrors.push(this.formatUserFriendlyError(err, invoiceNumber, 'Warning'));
                    });
                }

                // Process info errors
                if (invoiceErrors.info && Array.isArray(invoiceErrors.info)) {
                    console.log(`ℹ️ Found ${invoiceErrors.info.length} info errors for ${invoiceNumber}`);
                    invoiceErrors.info.forEach(err => {
                        validationErrors.push(this.formatUserFriendlyError(err, invoiceNumber, 'Info'));
                    });
                }
            });
        } else if (Array.isArray(details)) {
            // Handle the old format for backward compatibility
            details.forEach((detail, index) => {
                if (detail.errors && Array.isArray(detail.errors)) {
                    detail.errors.forEach(err => {
                        validationErrors.push({
                            message: err.userFriendlyMessage || err.message || 'Unknown error',
                            field: err.field || 'Unknown Field',
                            row: detail.index ? detail.index + 1 : index + 1,
                            value: err.value || '',
                            severity: 'Critical',
                            suggestion: 'Please review and correct this field'
                        });
                    });
                }
            });
        }

        // If no structured errors but there's a general error message
        if (validationErrors.length === 0 && error) {
            validationErrors.push({
                message: error,
                field: 'General',
                row: 1,
                value: '',
                severity: 'Critical',
                suggestion: 'Please check your Excel file format and data'
            });
        }

        const transformedError = {
            fileName: 'uploaded_file.xlsx', // We don't have the filename in this context
            message: error || `Validation failed for ${failedDocuments} out of ${totalDocuments} invoices`,
            validationErrors: validationErrors
        };

        console.log('✅ Transformed error for custom modal:', transformedError);
        console.log(`📊 Final validation errors count: ${validationErrors.length}`);
        return transformedError;
    }

    // Helper function to extract row number from invoice number
    extractRowNumber(invoiceNumber) {
        console.log('🔍 Extracting row number from invoice:', invoiceNumber);

        // Try different patterns to extract row number
        const patterns = [
            /row\s*(\d+)/i,           // "row 1", "Row 2", etc.
            /\(row\s*(\d+)\)/i,       // "(row 1)", "(Row 2)", etc.
            /#(\d+)$/,                // "#1", "#2" at the end
            /_(\d+)$/,                // "_1", "_2" at the end
            /\[(\d+)\]$/              // "[1]", "[2]" at the end
        ];

        for (const pattern of patterns) {
            const match = invoiceNumber.match(pattern);
            if (match) {
                const rowNumber = parseInt(match[1]);
                console.log(`✅ Found row number ${rowNumber} using pattern ${pattern}`);
                return rowNumber;
            }
        }

        // If no pattern matches, try to extract any number at the end
        const numberMatch = invoiceNumber.match(/(\d+)$/);
        if (numberMatch) {
            const rowNumber = parseInt(numberMatch[1]);
            console.log(`✅ Using trailing number ${rowNumber} as row number`);
            return rowNumber;
        }

        console.log('⚠️ No row number found, defaulting to 1');
        return 1;
    }

    // Format error into user-friendly message for non-technical users
    formatUserFriendlyError(error, invoiceNumber, severity) {
        const field = error.field || 'Unknown Field';
        const value = error.value || '';
        const issue = error.issue || error.message || 'Unknown issue';
        const suggestion = error.suggestion || 'Please review and correct this field';
        const rowNumber = this.extractRowNumber(invoiceNumber);

        // Clean up the invoice number for display (remove technical prefixes/suffixes)
        let cleanInvoiceNumber = invoiceNumber;

        // Remove common technical patterns to show the actual invoice number
        cleanInvoiceNumber = cleanInvoiceNumber
            .replace(/^#/, '')                    // Remove leading #
            .replace(/\(row\s*\d+\)$/i, '')      // Remove (row X) suffix
            .replace(/_\d+$/, '')                // Remove _X suffix
            .replace(/\[\d+\]$/, '')             // Remove [X] suffix
            .replace(/\s*row\s*\d+$/i, '')       // Remove "row X" suffix
            .trim();

        // Create a user-friendly title that includes all key information
        let title = `Invoice ${cleanInvoiceNumber}, Column '${field}'`;

        // Create detailed problem description
        let problemDescription = '';
        if (value) {
            problemDescription = `The value '${value}' has an issue: ${issue}`;
        } else {
            problemDescription = issue;
        }

        // Create actionable solution
        let solution = this.generateActionableSolution(error, field, value);

        return {
            title: title,
            problem: problemDescription,
            solution: solution,
            severity: severity,
            invoiceNumber: invoiceNumber,
            field: field,
            value: value,
            rowNumber: rowNumber,
            // Legacy fields for backward compatibility
            message: `${title}: ${problemDescription}`,
            suggestion: suggestion
        };
    }

    // Generate specific, actionable solutions based on error type
    generateActionableSolution(error, field, value) {
        const issue = (error.issue || error.message || '').toLowerCase();
        const suggestion = error.suggestion || '';

        // Special character issues
        // if (issue.includes('special character') || issue.includes('problematic character')) {
        //     const problematicChars = this.extractProblematicCharacters(issue, value);
        //     if (problematicChars.length > 0) {
        //         return `Remove or replace the following characters: ${problematicChars.join(', ')}. For example, replace '&' with 'and'.`;
        //     }
        //     return 'Remove or replace special characters that may cause processing issues.';
        // }

        // Whitespace issues
        if (issue.includes('whitespace') || issue.includes('leading') || issue.includes('trailing')) {
            return `Remove extra spaces at the beginning or end of the field. The corrected value should be: "${value.trim()}"`;
        }

        // Date format issues
        if (issue.includes('date') && issue.includes('format')) {
            return 'Use the date format YYYY-MM-DD (e.g., 2024-03-15 for March 15, 2024).';
        }

        // Email format issues
        if (issue.includes('email') || field.toLowerCase().includes('email')) {
            return 'Ensure the email address is in the correct format (e.g., user@company.com).';
        }

        // Required field issues
        if (issue.includes('required') || issue.includes('missing') || issue.includes('empty')) {
            return `This field is required and cannot be left empty. Please provide a valid ${field}.`;
        }

        // Numeric issues
        if (issue.includes('numeric') || issue.includes('number') || issue.includes('amount')) {
            return 'Enter a valid number without special characters or currency symbols.';
        }

        // Length issues
        if (issue.includes('length') || issue.includes('too long') || issue.includes('too short')) {
            return suggestion || 'Adjust the field length to meet the required format.';
        }

        // Default fallback
        return suggestion || 'Please review and correct this field according to the requirements.';
    }

    // Extract problematic characters from error message
    extractProblematicCharacters(issue, value) {
        const chars = [];
        const commonProblematic = ['&', '<', '>', '"', "'", '\\', '/', '|', '*', '?', ':', ';'];

        if (value) {
            commonProblematic.forEach(char => {
                if (value.includes(char)) {
                    chars.push(`'${char}'`);
                }
            });
        }

        // Try to extract from error message
        const charMatch = issue.match(/characters?[:\s]*([&<>"'\\\/|*?:;]+)/i);
        if (charMatch && charMatch[1]) {
            const extractedChars = charMatch[1].split('').map(c => `'${c}'`);
            chars.push(...extractedChars);
        }

        return [...new Set(chars)]; // Remove duplicates
    }

    // Download pre-validation error report
    downloadPreValidationErrorReport(validationResult) {
        const { details, totalDocuments, failedDocuments } = validationResult;

        let csvContent = "Invoice Number,Row Index,Error Code,Field,Error Message,Current Value\n";

        details.forEach(detail => {
            detail.errors.forEach(error => {
                const row = [
                    detail.invoiceNumber,
                    detail.index + 1,
                    error.code,
                    error.field,
                    `"${(error.userFriendlyMessage || error.message).replace(/"/g, '""')}"`,
                    error.value ? `"${String(error.value).replace(/"/g, '""')}"` : ''
                ].join(',');
                csvContent += row + "\n";
            });
        });

        // Create and download the file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `pre_validation_errors_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (window.toastNotification?.success) {
            window.toastNotification.success('Downloaded', 'Pre-validation error report downloaded successfully.', 3000);
        }
    }

    // Update loading message
    updateLoadingMessage(message) {
        const messageEl = document.querySelector('#loadingBackdrop .excel-status-text');
        if (messageEl) {
            messageEl.textContent = message;
        }
    }

    // Show pre-validation success modal using modern modal component
    async showPreValidationSuccessModal(validationResult) {
        const { totalDocuments, message } = validationResult;

        // Create modern validation success modal using the same structure as showSubmissionSuccessModal
        const overlay = document.createElement('div');
        overlay.className = 'submission-flow-backdrop';
        overlay.setAttribute('role','dialog');
        overlay.setAttribute('aria-modal','true');
        overlay.setAttribute('aria-labelledby','sfValidationTitle');
        overlay.setAttribute('aria-describedby','sfValidationSub');

        const card = document.createElement('div');
        card.className = 'sf-submission-card';
        card.setAttribute('style','animation: sfv2-pop .34s cubic-bezier(.2,.9,.2,1) both; border-radius:16px; overflow:hidden; box-shadow:0 28px 64px rgba(2,6,23,.22), 0 2px 8px rgba(2,6,23,.08)');

        const inlineStyles = `
            <style id="sfV2ValidationStyles">
                /* Theme */
                [data-sfv2="validation"]{ --brand:#22c55e; --brand-800:#16a34a; --ink:#0f172a; --muted:#64748b; --ring:#86efac; }

                /* Modal Backdrop - Fixed positioning and z-index */
                .submission-flow-backdrop{ position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:10050; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box }
                .sf-submission-card{ max-width:520px; width:100%; max-height:90vh; background:#fff; border-radius:16px; box-shadow:0 28px 64px rgba(2,6,23,.22), 0 2px 8px rgba(2,6,23,.08); display:flex; flex-direction:column; overflow:hidden }

                /* Layout - Fixed height and overflow handling */
                .sfv2-header{ display:flex; align-items:center; gap:12px; padding:16px 20px; background:linear-gradient(180deg,var(--brand),var(--brand-800)); color:#fff; box-shadow:inset 0 -1px rgba(255,255,255,.05); flex-shrink:0; position:relative }
                .sfv2-close{ position:absolute; top:16px; right:20px; background:none; border:none; color:#fff; font-size:20px; cursor:pointer; padding:4px; border-radius:4px; opacity:0.8; transition:opacity 0.2s }
                .sfv2-close:hover{ opacity:1; background:rgba(255,255,255,0.1) }
                .sfv2-icon{ width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.2) }
                .sfv2-title{ font-size:18px; font-weight:700; letter-spacing:.3px; color:#fff; margin:0; padding-right:40px }
                .sfv2-sub{ font-size:13px; color:#d1fae5; margin:2px 0 0 0; opacity:0.9 }
                .sfv2-body{ padding:24px; text-align:center; flex:1; overflow-y:auto; max-height:calc(90vh - 140px) }
                .sfv2-footer{ display:flex; justify-content:center; gap:12px; padding:0 24px 24px; flex-shrink:0 }

                /* Hero Section */
                .sfv2-hero{ display:flex; flex-direction:column; align-items:center; justify-content:center; margin:0 0 20px }
                .sfv2-ring{ display:grid; place-items:center; width:80px; height:80px; border-radius:50%; background:radial-gradient(60% 60% at 50% 40%, rgba(34,197,94,.15), rgba(34,197,94,0) 70%); position:relative; margin:0 auto }
                .sfv2-ring::before{ content:''; position:absolute; inset:0; border-radius:50%; border:3px solid var(--brand); box-shadow:0 4px 20px rgba(34,197,94,.2) }
                .sfv2-check{ fill:none; stroke:var(--brand); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation: sfv2-stroke .6s ease forwards .2s }

                /* Badge and Messages */
                .sfv2-badge{ display:inline-flex; align-items:center; gap:8px; font-weight:600; color:#166534; background:#dcfce7; border:1px solid #86efac; padding:8px 16px; border-radius:999px; margin:0 auto 16px; font-size:14px; max-width:fit-content }
                .sfv2-msg{ margin:0 0 20px; color:var(--ink); line-height:1.5; font-weight:500; font-size:16px }

                /* Cards */
                .sfv2-card{ border:1px solid #e5e7eb; border-radius:12px; padding:18px; background:#fafafa; margin:16px 0; text-align:left }
                .sfv2-card-title{ font-weight:700; margin-bottom:12px; color:#111827; display:flex; align-items:center; gap:8px; font-size:15px }
                .sfv2-list{ padding-left:0; margin:0; list-style:none }
                .sfv2-list li{ padding:6px 0; display:flex; align-items:center; gap:10px; color:#374151; font-size:14px }
                .sfv2-list li::before{ content:'✅'; font-size:16px; flex-shrink:0 }
                .sfv2-desc{ color:#6b7280; margin:0; line-height:1.5; font-size:14px }

                /* Buttons */
                .sfv2-btn{ cursor:pointer; user-select:none; border:none; border-radius:8px; padding:12px 24px; font-weight:600; transition: all .2s ease; font-size:14px; display:inline-flex; align-items:center; gap:8px; min-width:120px; justify-content:center }
                .sfv2-btn-primary{ background:#22c55e; color:#fff; box-shadow:0 2px 4px rgba(34,197,94,.2) }
                .sfv2-btn-primary:hover{ background:#16a34a; box-shadow:0 4px 12px rgba(34,197,94,.3); transform: translateY(-1px) }
                .sfv2-btn-secondary{ background:#6b7280; color:#fff; box-shadow:0 2px 4px rgba(107,114,128,.2) }
                .sfv2-btn-secondary:hover{ background:#4b5563; box-shadow:0 4px 12px rgba(107,114,128,.3); transform: translateY(-1px) }
                .sfv2-btn:active{ transform: translateY(0) }
                .sfv2-btn:focus{ outline:2px solid rgba(34,197,94,.4); outline-offset:2px }

                /* Animations */
                @keyframes sfv2-pop{ from { transform: translateY(12px) scale(.95); opacity:0 } to { transform: translateY(0) scale(1); opacity:1 } }
                @keyframes sfv2-stroke{ to { stroke-dashoffset:0 } }

                /* Responsive - Improved mobile experience */
                @media (max-width: 768px){
                    .submission-flow-backdrop{ padding:16px; align-items:center }
                    .sf-submission-card{ max-width:100%; max-height:calc(100vh - 32px) }
                    .sfv2-body{ padding:20px; max-height:calc(100vh - 180px) }
                    .sfv2-ring{ width:70px; height:70px }
                    .sfv2-footer{ padding:0 20px 20px }
                    .sfv2-title{ font-size:16px; padding-right:35px }
                    .sfv2-close{ top:14px; right:16px; font-size:18px }
                }
                @media (max-width: 640px){
                    .submission-flow-backdrop{ padding:12px; align-items:center }
                    .sf-submission-card{ max-width:100%; max-height:calc(100vh - 24px) }
                    .sfv2-body{ padding:16px; max-height:calc(100vh - 160px) }
                    .sfv2-ring{ width:60px; height:60px }
                    .sfv2-footer{ flex-direction:column; padding:0 16px 16px }
                    .sfv2-btn{ width:100% }
                    .sfv2-title{ font-size:15px }
                }
                @media (max-width: 480px){
                    .submission-flow-backdrop{ padding:8px; align-items:center }
                    .sf-submission-card{ max-width:100%; max-height:calc(100vh - 16px) }
                    .sfv2-header{ padding:12px 16px }
                    .sfv2-body{ padding:12px; max-height:calc(100vh - 140px) }
                    .sfv2-footer{ padding:0 12px 12px }
                    .sfv2-title{ font-size:14px; padding-right:30px }
                    .sfv2-close{ top:12px; right:12px; font-size:16px }
                }
                @media (max-height: 600px){
                    .submission-flow-backdrop{ align-items:center; padding-top:10px }
                    .sf-submission-card{ max-height:calc(100vh - 20px) }
                    .sfv2-body{ max-height:calc(100vh - 120px) }
                }
                @media (max-height: 500px){
                    .sf-submission-card{ max-height:calc(100vh - 10px) }
                    .sfv2-body{ max-height:calc(100vh - 100px) }
                    .sfv2-header{ padding:12px 20px }
                    .sfv2-footer{ padding:0 20px 12px }
                }

                /* Reduced motion */
                @media (prefers-reduced-motion: reduce){ *{ animation: none !important } .sfv2-check{ stroke-dashoffset:0 !important } }
            </style>`;

        card.innerHTML = `
            ${inlineStyles}
            <div class="sfv2" data-sfv2="validation">
                <div class="sfv2-header">
                    <div class="sfv2-icon"><i class="bi bi-shield-check" style="font-size:18px;color:#e5edff"></i></div>
                    <div>
                        <div class="sfv2-title" id="sfValidationTitle">Validation Successful</div>
                        <div class="sfv2-sub" id="sfValidationSub">Pre-Upload Validation Passed</div>
                    </div>
                    <button class="sfv2-close" id="closeValidationModal" aria-label="Close modal" title="Close">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="sfv2-body">
                    <div class="sfv2-hero">
                        <div class="sfv2-ring" role="img" aria-label="Validation Success">
                            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" style="width:42px;height:42px;display:block">
                                <path class="sfv2-check" d="M14 24l7 7 13-16" />
                            </svg>
                        </div>
                    </div>
                    <div class="sfv2-badge" role="status"><i class="bi bi-check2-circle" style="color:#22c55e"></i> All ${totalDocuments} invoices passed validation. File is ready for upload.</div>

                    <div class="sfv2-card">
                        <div class="sfv2-card-title"><i class="bi bi-clipboard-check"></i> Validation Summary</div>
                        <ul class="sfv2-list">
                            <li>File format validation: <strong>Passed</strong></li>
                            <li>Mandatory fields check: <strong>Passed</strong></li>
                            <li>Data format validation: <strong>Passed</strong></li>
                            <li>Document count limit: <strong>Passed</strong> (${totalDocuments}/100)</li>
                            <li>TIN format validation: <strong>Passed</strong></li>
                        </ul>
                    </div>

                    <div class="sfv2-card">
                        <div class="sfv2-card-title"><i class="bi bi-info-circle"></i> Next Steps</div>
                        <div class="sfv2-desc">Click "Continue Upload" to proceed with uploading your validated file to the system.</div>
                    </div>
                </div>
                <div class="sfv2-footer">
                    <button id="cancelValidation" class="sfv2-btn sfv2-btn-secondary"><i class="bi bi-x-lg"></i> Cancel</button>
                    <button id="continueUpload" class="sfv2-btn sfv2-btn-primary"><i class="bi bi-upload"></i> Continue Upload</button>
                </div>
            </div>`;

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        // Focus management for accessibility
        const firstFocusableElement = card.querySelector('#continueUpload');
        if (firstFocusableElement) {
            firstFocusableElement.focus();
        }

        return new Promise((resolve) => {
            const closeModal = (result = false) => {
                // Remove styles
                const styles = document.getElementById('sfV2ValidationStyles');
                if (styles) {
                    styles.remove();
                }
                overlay.remove();
                resolve(result);
            };

            // Continue Upload button
            card.querySelector('#continueUpload').addEventListener('click', () => {
                closeModal(true); // Continue with upload
            });

            // Cancel button
            card.querySelector('#cancelValidation').addEventListener('click', () => {
                closeModal(false); // Cancel upload
            });

            // Header close button
            card.querySelector('#closeValidationModal').addEventListener('click', () => {
                closeModal(false); // Cancel upload
            });

            // ESC key support
            const handleKeyDown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    document.removeEventListener('keydown', handleKeyDown);
                    closeModal(false);
                }
            };
            document.addEventListener('keydown', handleKeyDown);

            // Allow clicking outside to cancel
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.removeEventListener('keydown', handleKeyDown);
                    closeModal(false);
                }
            });
        });
    }
}

class InvoiceTableManager {
    static instance = null;

    static getInstance() {
        if (!InvoiceTableManager.instance) {
            InvoiceTableManager.instance = new InvoiceTableManager();
        }
        return InvoiceTableManager.instance;
    }

    constructor() {
        if (InvoiceTableManager.instance) {
            return InvoiceTableManager.instance;
        }
        InvoiceTableManager.instance = this;
        this.table = null;
        this.selectedRows = new Set();

        this.initializeTable();
    }

    initializeTable() {
        try {
            // Destroy existing table if it exists
            if ($.fn.DataTable.isDataTable('#invoiceTable')) {
                $('#invoiceTable').DataTable().destroy();
                $('#invoiceTable').empty();
            }

            // Initialize DataTable
            this.table = $('#invoiceTable').DataTable({
                columns: [
                    {
                        data: null,
                        width: '35px',
                        orderable: false,
                        searchable: false,
                        className: 'text-center',
                        render: function (data, type, row) {
                            const status = (row.status || 'uploaded').toLowerCase();
                            const disabledStatus = ['submitted', 'cancelled', 'rejected', 'invalid'].includes(status);
                            const disabledAttr = disabledStatus ? 'disabled' : '';
                            const title = disabledStatus ? `Cannot select ${status} items` : '';

                            return `<input type="checkbox" class="outbound-checkbox" ${disabledAttr} data-status="${status}" title="${title}">`;
                        }
                    },
                    {
                        data: null,
                        width: '40px',
                        orderable: false,
                        searchable: false,
                        className: 'text-center',
                        render: function (data, type, row, meta) {
                            const pageInfo = meta.settings._iDisplayStart;
                            const index = pageInfo + meta.row + 1;
                            return `${index}`;
                        }
                    },
                    {
                        data: 'fileName',
                        title: 'FILE NAME',
                        width: '15%',
                        render: (data, type, row) => this.renderFileName(data, type, row)
                    },
                    {
                        data: 'invoiceNumber',
                        title: 'INVOICE NO.',
                        width: '12%',
                        render: (data, type, row) => this.renderInvoiceNumber(data, type, row)
                    },
                    {
                        data: 'supplier',
                        title: 'SUPPLIER',
                        width: '18%',
                        render: (data, type, row) => this.renderSupplier(data, type, row)
                    },
                    {
                        data: 'receiver',
                        title: 'RECEIVER',
                        width: '16%',
                        render: (data, type, row) => this.renderReceiver(data, type, row)
                    },
                    {
                        data: 'date',
                        orderable: true,
                        title: 'Uploaded',
                        width: '10%',
                        className: 'text-center',
                        render: (data) => this.renderUploadedDate(data)
                    },
                    {
                        data: 'invDateInfo',
                        title: 'Invoice date',
                        width: '10%',
                        className: 'text-center',
                        render: (data, type, row) => this.renderInvDateInfo(data, type, row)
                    },
                    {
                        data: 'submittedDate',
                        title: 'Submitted',
                        width: '10%',
                        className: 'text-center',
                        orderable: true,
                        render: (data) => this.renderUploadedDate(data)
                    },
                    {
                        data: 'statusPriority',
                        visible: false,
                        searchable: false
                    },
                    {
                        data: 'status',
                        title: 'STATUS',
                        width: '8%',
                        className: 'text-center',
                        render: (data, type, row) => this.renderStatus(data, type, row)
                    },
                    {
                        data: 'totalAmount',
                        title: 'TOTAL AMOUNT',
                        width: '11%',
                        className: 'text-end',
                        render: (data) => this.renderTotalAmount(data)
                    },
                    {
                        data: null,
                        title: 'ACTION',
                        width: '180px',
                        orderable: false,
                        className: 'text-center',
                        render: (data, type, row) => this.renderActions(row)
                    }
                ],
                scrollX: true,
                scrollCollapse: true,
                autoWidth: false,
                pageLength: 10,
                dom: '<"outbound-controls"<"outbound-length-control"l>><"outbound-table-responsive"t><"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
                processing: true,
                serverSide: false,
                ajax: {
                    url: '/api/outbound-files-manual/list-fixed-paths',
                    method: 'GET',
                    dataSrc: (json) => {
                        if (!json.success) {
                            console.error('Error:', json.error);
                            return [];
                        }

                        if (!json.files || json.files.length === 0) {
                            return [];
                        }

                        // Process the files data for WP_UPLOADED_EXCEL_FILES
                        const processedData = json.files.map(file => {
                            const rowData = {
                                ...file,
                                DT_RowId: file.DT_RowId || `file_${file.id}`,

                                // Map the data to match table columns
                                fileName: file.fileName || file.originalFilename,
                                invoiceNumber: file.invoiceNumber,
                                supplier: file.supplier,
                                receiver: file.receiver,
                                date: file.date || file.uploadDate,
                                invDateInfo: file.invDateInfo,
                                status: file.status || 'uploaded',
                                source: file.source || 'Excel Upload',
                                totalAmount: file.totalAmount,

                                // Additional data for actions and display
                                id: file.id,
                                fileSize: file.fileSize,
                                uploadedBy: file.uploadedBy,
                                uploadDate: file.uploadDate,
                                processedDate: file.processedDate,
                                submittedDate: file.submittedDate,
                                submissionUid: file.submissionUid,
                                metadata: file.metadata,
                                invoiceDetails: file.invoiceDetails || [],
                                lhdnResponse: file.lhdnResponse || file.lhdn_response
                            };

                            // Status priority mapping for custom sort
                            const s = (rowData.status || '').toLowerCase();
                            const statusPriorityMap = { 'ready to submit': 2, 'processed': 1 };
                            // Normalize 'processed' to show as Ready to Submit but keep original value in rowData.status
                            if (s === 'processed') {
                                rowData.statusDisplay = 'Ready to Submit';
                            }
                            rowData.statusPriority = statusPriorityMap[s] || 0;

                            // Extract detailed supplier and receiver data from invoiceDetails
                            let supplierData = [];
                            let receiverData = [];

                            if (file.invoiceDetails && Array.isArray(file.invoiceDetails) && file.invoiceDetails.length > 0) {
                                supplierData = window.outboundManualExcel.extractSupplierData(file.invoiceDetails);
                                receiverData = window.outboundManualExcel.extractReceiverData(file.invoiceDetails);

                                const partyLabel = (party) => {
                                    if (!party) return null;
                                    if (typeof party === 'string' && party.trim()) return party.trim();
                                    return (
                                        party.company ||
                                        party.name ||
                                        party.registrationName ||
                                        null
                                    );
                                };

                                try {
                                    const invoiceNumbers = file.invoiceDetails
                                        .map((doc) => doc.invoiceNumber || doc.invoiceNo)
                                        .filter(Boolean);
                                    if (invoiceNumbers.length === 1) {
                                        rowData.invoiceNumber = invoiceNumbers[0];
                                    } else if (invoiceNumbers.length > 1) {
                                        rowData.invoiceNumber = `${invoiceNumbers.length} Invoice(s)\n${invoiceNumbers.join('\n')}`;
                                    }

                                    const supplierNames = [
                                        ...new Set(
                                            file.invoiceDetails
                                                .map((doc) => partyLabel(doc.supplier))
                                                .filter(Boolean)
                                        ),
                                    ];
                                    if (supplierNames.length === 1) {
                                        rowData.supplier = supplierNames[0];
                                    } else if (supplierNames.length > 1) {
                                        rowData.supplier = `${supplierNames.length} Supplier(s)\n${supplierNames.join('\n')}`;
                                    }

                                    const receiverNames = [
                                        ...new Set(
                                            file.invoiceDetails
                                                .map((doc) => partyLabel(doc.buyer))
                                                .filter(Boolean)
                                        ),
                                    ];
                                    if (receiverNames.length === 1) {
                                        rowData.receiver = receiverNames[0];
                                    } else if (receiverNames.length > 1) {
                                        rowData.receiver = `${receiverNames.length} Receiver(s)\n${receiverNames.join('\n')}`;
                                    } else if (!rowData.receiver) {
                                        rowData.receiver = 'N/A';
                                    }

                                    const total = file.invoiceDetails.reduce(
                                        (sum, doc) => sum + (Number(doc.totalAmount) || 0),
                                        0
                                    );
                                    if (total) rowData.totalAmount = total;
                                } catch (e) {
                                    console.warn('Failed to compute display from invoiceDetails', e);
                                }
                            }

                            // Store the detailed data for modal access
                            const uniqueId = rowData.DT_RowId;
                            window.outboundManualExcel.storeRowData(uniqueId, rowData, supplierData, receiverData);

                            return rowData;
                        });

                        console.log('Processed Data:', processedData);
                        dataCache.updateCache(processedData);
                        return processedData;
                    }
                },
                order: [
                    [1, 'asc'], // Primary: statusPriority (Ready to Submit > Processed > others)
                    [6, 'desc'] // Secondary: upload date, newest first
                ],
                language: {
                    search: '',
                    searchPlaceholder: 'Search...',
                    lengthMenu: 'Show _MENU_ entries',
                    info: 'Showing _START_ to _END_ of _TOTAL_ entries',
                    infoEmpty: 'Showing 0 to 0 of 0 entries',
                    infoFiltered: '(filtered from _MAX_ total entries)',
                    paginate: {
                        first: '<i class="bi bi-chevron-double-left"></i>',
                        previous: '<i class="bi bi-chevron-left"></i>',
                        next: '<i class="bi bi-chevron-right"></i>',
                        last: '<i class="bi bi-chevron-double-right"></i>'
                    },
                    emptyTable: 'No data available',
                    zeroRecords: `<div class="text-center">
                    <i class="bi bi-exclamation-triangle" style="font-size: 2em; color: var(--bs-warning);"></i>
                    <p>No records found. Please try <a href="#" onclick="window.location.reload();">reloading the page</a> to refresh the data.</p>
                    <p>Try <a href="#" onclick="window.location.reload();">reloading the page</a>. If the issue persists, please contact support.</p>
                </div>`
                },
                drawCallback: function() {
                    // Initialize tooltips after table is drawn
                    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
                        // Dispose of existing tooltips first
                        const existingTooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
                        existingTooltips.forEach(el => {
                            const tooltip = bootstrap.Tooltip.getInstance(el);
                            if (tooltip) {
                                tooltip.dispose();
                            }
                        });

                        // Initialize new tooltips
                        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
                        tooltipTriggerList.map(function (tooltipTriggerEl) {
                            return new bootstrap.Tooltip(tooltipTriggerEl, {
                                container: 'body',
                                trigger: 'hover focus',
                                delay: { show: 300, hide: 100 }
                            });
                        });
                    }

                        // Ensure table sits below controls with visual separation
                        try {
                            const controls = document.querySelector('.outbound-controls');
                            if (controls) {
                                controls.style.marginBottom = '12px';
                                controls.style.paddingBottom = '6px';
                                controls.style.borderBottom = '1px solid #e5e7eb';
                            }
                            const wrap = document.querySelector('.outbound-table-responsive');
                            if (wrap) {
                                wrap.style.marginTop = '12px';
                            }
                        } catch (e) { /* noop */ }


                    // Initialize checkbox event handlers for bulk actions
                    const checkboxes = document.querySelectorAll('.outbound-checkbox:not(#selectAll)');
                    checkboxes.forEach(checkbox => {
                        // Remove existing listeners to prevent duplicates
                        checkbox.removeEventListener('change', window.handleCheckboxChange);
                        checkbox.addEventListener('change', window.handleCheckboxChange);
                    });

                    // Initialize "View All" button event handlers
                    const viewAllSuppliersButtons = document.querySelectorAll('.view-all-suppliers-btn');
                    viewAllSuppliersButtons.forEach(button => {
                        button.removeEventListener('click', this.handleViewAllSuppliers);
                        button.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rowId = button.getAttribute('data-row-id');
                            if (rowId) {
                                window.outboundManualExcel.showSupplierModal(rowId);
                            }
                        });
                    });

                    const viewAllReceiversButtons = document.querySelectorAll('.view-all-receivers-btn');
                    viewAllReceiversButtons.forEach(button => {
                        button.removeEventListener('click', this.handleViewAllReceivers);
                        button.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rowId = button.getAttribute('data-row-id');
                            if (rowId) {
                                window.outboundManualExcel.showReceiverModal(rowId);
                            }
                        });
                    });
                }
            });

            this.initializeQuickFilters();

        } catch (error) {
            console.error('Error initializing DataTable:', error);
        }
    }

    initializeQuickFilters() {
        document.querySelectorAll('.quick-filters .btn[data-filter]').forEach((button) => {
            button.addEventListener('click', (e) => {
                document.querySelectorAll('.quick-filters .btn').forEach((btn) =>
                    btn.classList.remove('active')
                );
                e.currentTarget.classList.add('active');
                const filterValue = e.currentTarget.dataset.filter;
                this.applyQuickFilter(filterValue);
            });
        });
    }

    applyQuickFilter(filterValue) {
        if (!this.table) return;

        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) globalSearch.value = '';

        const statusColumnIndex = 10;
        if (filterValue === 'all') {
            this.table.column(statusColumnIndex).search('').draw();
        } else {
            this.table.column(statusColumnIndex).search(filterValue, false, false).draw();
        }
    }

    // Render methods (following outbound-excel.js styling)
    renderInvoiceNumber(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';

        // Handle multi-line invoice numbers
        const lines = data.split('\n');
        if (lines.length > 1) {
            const countLine = lines[0]; // e.g., "5 Invoice(s)"
            const invoiceNumbers = lines.slice(1); // Get actual invoice numbers

            // Limit to first 10 for tooltip preview
            const previewLimit = 10;
            const previewInvoices = invoiceNumbers.slice(0, previewLimit);
            const hasMore = invoiceNumbers.length > previewLimit;

            // Create preview list for tooltip
            const previewList = previewInvoices.map((invoice, index) =>
                `<div style="
                    padding: 6px 10px;
                    margin: 1px 0;
                    background: ${index % 2 === 0 ? '#f8fafc' : '#ffffff'};
                    border-radius: 4px;
                    border-left: 3px solid #1a365d;
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    font-size: 12px;
                    color: #1e293b;
                    font-weight: 500;
                ">${invoice.trim()}</div>`
            ).join('');

            // Create unique ID for this row's invoice data
            const uniqueId = `invoices_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const tooltipContent = `
                <div style="
                    max-width: 320px;
                    text-align: left;
                    background: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    padding: 14px;
                ">
                    <div style="
                        font-weight: 600;
                        margin-bottom: 10px;
                        color: #1e293b;
                        border-bottom: 2px solid #e2e8f0;
                        padding-bottom: 6px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    ">
                        <i class="bi bi-receipt" style="color: #1a365d;"></i>
                        Invoice Numbers (${invoiceNumbers.length}):
                    </div>
                    <div style="max-height: 180px; overflow-y: auto; margin-bottom: ${hasMore ? '10px' : '0'}; scrollbar-width: none; -ms-overflow-style: none;" class="hide-scrollbar">
                        ${previewList}
                    </div>
                    ${hasMore ? `
                        <div style="
                            text-align: center;
                            padding-top: 8px;
                            border-top: 1px solid #e2e8f0;
                        ">
                            <button onclick="window.outboundManualExcel.showInvoiceModal('${uniqueId}')"
                                style="
                                    background: #1a365d;
                                    color: white;
                                    border: none;
                                    padding: 6px 12px;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    cursor: pointer;
                                    font-weight: 500;
                                "
                                onmouseover="this.style.background='#2d3748'"
                                onmouseout="this.style.background='#1a365d'">
                                View All ${invoiceNumbers.length} Invoices
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;

            // Store invoice data + LHDN response for modal access
            if (!window.invoiceModalData) window.invoiceModalData = {};
            window.invoiceModalData[uniqueId] = invoiceNumbers;

            if (!window.invoiceLhdnData) window.invoiceLhdnData = {};
            window.invoiceLhdnData[uniqueId] = row.lhdnResponse || row.lhdn_response || null;

            return `
                <div class="cell-group">
                    <div class="cell-main">
                        <i class="bi bi-receipt me-1"></i>
                        <span class="invoice-count"
                            style="cursor: pointer;"
                            data-bs-toggle="tooltip"
                            data-bs-placement="top"
                            data-bs-html="true"
                            title="${tooltipContent.replace(/"/g, '&quot;')}">
                            ${countLine}
                        </span>
                    </div>
                    <div class="cell-sub">
                        <i class="bi bi-list-ul me-1"></i>
                        <span class="reg-text">Multiple Invoices</span>
                        ${hasMore ? `<button class="btn btn-sm btn-outline-primary ms-2"
                            onclick="window.outboundManualExcel.showInvoiceModal('${uniqueId}')"
                            style="font-size: 10px; padding: 2px 6px;">
                            View All
                        </button>` : ''}
                    </div>
                </div>`;
        }

        // Single invoice number
        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-receipt me-1"></i>
                    <span>${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-hash me-1"></i>
                    <span class="reg-text">Invoice Number</span>
                </div>
            </div>`;
    }

    renderCompanyInfo(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        return `<span>${data}</span>`;
    }

    renderSupplierInfo(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        const supplierName = data.name || data.registrationName || 'N/A';
        return `<span>${supplierName}</span>`;
    }

    renderBuyerInfo(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        const buyerName = data.name || data.registrationName || 'N/A';
        return `<span>${buyerName}</span>`;
    }

    renderUploadedDate(data) {
        if (!data) return '<span class="text-muted">N/A</span>';

        const date = new Date(data);
        const formattedDate = date.toLocaleDateString('en-MY', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const formattedTime = date.toLocaleTimeString('en-MY', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-calendar-event me-1"></i>
                    <span class="date-value">${formattedDate}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-clock me-1"></i>
                    <span class="reg-text">${formattedTime}</span>
                </div>
            </div>`;
    }

    renderDateInfo(issueDate, issueTime, submittedDate, cancelledDate, row) {
        return '<span class="text-muted">-</span>';
    }

    renderStatus(data, type, row) {
        const raw = (data || 'Pending').toString();
        const statusClass = raw.toLowerCase();

        // Map status display names
        const statusDisplayNames = {
            pending: 'Pending',
            uploaded: 'Pending',
            processed: 'Ready to Submit',
            'ready to submit': 'Ready to Submit',
            submitted: 'Submitted',
            cancelled: 'Cancelled',
            rejected: 'Rejected',
            failed: 'Failed',
            invalid: 'Invalid',
            valid: 'Valid'
        };

        const icons = {
            pending: 'hourglass-split',
            uploaded: 'hourglass-split',
            processed: 'check-circle',
            'ready to submit': 'check-circle',
            submitted: 'check-circle-fill',
            cancelled: 'x-circle-fill',
            rejected: 'x-circle-fill',
            failed: 'exclamation-triangle-fill',
            invalid: 'exclamation-triangle-fill',
            valid: 'check-circle-fill'
        };
        const statusColors = {
            pending: '#ff8307',
            uploaded: '#ff8307',
            processed: '#28a745',
            'ready to submit': '#28a745',
            submitted: '#198754',
            cancelled: '#ffc107',
            rejected: '#dc3545',
            failed: '#dc3545',
            invalid: '#dc3545',
            valid: '#198754'
        };

        let icon = icons[statusClass] || 'question-circle';
        let color = statusColors[statusClass] || '#6c757d';
        let displayName = statusDisplayNames[statusClass] || raw;

        // Enhanced status display with success/failure counts
        if (row && row.lhdnResponse) {
            try {
                const lhdnData = typeof row.lhdnResponse === 'string'
                    ? JSON.parse(row.lhdnResponse)
                    : row.lhdnResponse;

                // Check for validation results with success/failure counts
                if (lhdnData && lhdnData.summary) {
                    const { totalDocuments, validDocuments, failedDocuments } = lhdnData.summary;

                    if (totalDocuments > 0) {
                        if (failedDocuments === 0) {
                            // All successful
                            displayName = `${validDocuments} of ${totalDocuments} Submitted`;
                            icon = 'check-circle-fill';
                            color = '#198754';
                        } else if (validDocuments === 0) {
                            // All failed
                            displayName = `${failedDocuments} of ${totalDocuments} Failed`;
                            icon = 'exclamation-triangle-fill';
                            color = '#dc3545';
                        } else {
                            // Partial success
                            displayName = `${validDocuments} of ${totalDocuments} Submitted`;
                            icon = 'exclamation-circle';
                            color = '#ff8307';
                        }
                    }
                } else if (lhdnData && lhdnData.status === 'success') {
                    // Single document success
                    displayName = 'Submitted';
                    icon = 'check-circle-fill';
                    color = '#198754';
                } else if (lhdnData && lhdnData.status === 'failed' && lhdnData.error) {
                    // Single document failure
                    displayName = 'Failed';
                    icon = 'exclamation-triangle-fill';
                    color = '#dc3545';
                }
            } catch (e) {
                console.warn('Error parsing LHDN response for status display:', e);
            }
        }

        return `<span class="outbound-status ${statusClass.replace(/\s+/g,'-')}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: ${color}15; color: ${color}; font-weight: 500; transition: all 0.2s ease;">
            <i class="bi bi-${icon}" style="font-size: 14px;"></i>${displayName}</span>`;
    }

    renderSource(data) {
        if (!data) return '<span class="text-muted">N/A</span>';

        // Clean up the data and create proper badge
        const sourceText = data.replace(/\s+/g, ' ').trim();

        // Define colors for different sources
        let bgColor, textColor, icon;
        switch (sourceText.toLowerCase()) {
            case 'excel upload':
                bgColor = '#dcfce7';
                textColor = '#166534';
                icon = 'file-earmark-excel';
                break;
            case 'manual':
                bgColor = '#dbeafe';
                textColor = '#1e40af';
                icon = 'pencil-square';
                break;
            case 'api':
                bgColor = '#f3e8ff';
                textColor = '#7c3aed';
                icon = 'cloud-arrow-up';
                break;
            default:
                bgColor = '#f1f5f9';
                textColor = '#475569';
                icon = 'gear';
        }

        return `
            <div style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: ${bgColor}; border-radius: 6px; border: 1px solid ${textColor}20;">
                <i class="bi bi-${icon}" style="color: ${textColor}; font-size: 12px;"></i>
                <span style="color: ${textColor}; font-weight: 500; font-size: 12px;">${sourceText}</span>
            </div>`;
    }

    renderTotalAmount(data) {
        if (!data) return '<span class="text-muted">N/A</span>';

        // Format number with commas
        let formattedAmount = data;
        const num = parseFloat(data);
        if (!isNaN(num)) {
            formattedAmount = num.toLocaleString('en-MY', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }

        return `
            <div class="total-amount-wrapper" style="
                display: flex;
                align-items: center;
                justify-content: flex-end;
            ">
                <span class="total-amount" style="
                    font-weight: 500;
                    color: #1e40af;
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    background: rgba(30, 64, 175, 0.1);
                    padding: 3px 6px;
                    border-radius: 4px;
                    display: inline-block;
                    letter-spacing: 0.3px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    font-size: 12px;
                ">
                    ${formattedAmount}
                </span>
            </div>
        `;
    }

    renderActions(row) {
        const actions = [];

        actions.push(`
            <button type="button" class="outbound-row-action-btn outbound-row-action-btn--view"
                onclick="window.outboundManualExcel.showLHDNDetailsModal('${row.id}')" title="View Details">
                <i class="bi bi-eye"></i>
            </button>
        `);

        if (!['submitted', 'cancelled'].includes(row.status?.toLowerCase())) {
            actions.push(`
                <button type="button" class="outbound-row-action-btn outbound-row-action-btn--delete"
                    onclick="uploadedFilesManager.deleteFile('${row.id}')" title="Delete File">
                    <i class="bi bi-trash"></i>
                </button>
            `);
        }

        return `<div class="outbound-row-actions">${actions.join('')}</div>`;
    }

    renderFileName(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';

        const fileSize = this.formatFileSize(row.fileSize);

        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-file-earmark-excel me-1"></i>
                    <span title="${data}">${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-hdd me-1"></i>
                    <span class="reg-text">${fileSize}</span>
                </div>
            </div>`;
    }

    renderSupplier(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';

        // Handle multi-line supplier names
        const lines = data.split('\n');
        if (lines.length > 1) {
            const countLine = lines[0]; // e.g., "5 Supplier(s)"
            const supplierNames = lines.slice(1).filter(name => name.trim() && name.trim() !== 'N/A'); // Get actual supplier names, filter out N/A

            // If no valid supplier names after filtering, show single supplier format
            if (supplierNames.length === 0) {
                return `
                    <div class="cell-group">
                        <div class="cell-main">
                            <i class="bi bi-person-badge me-1"></i>
                            <span>${countLine}</span>
                        </div>
                        <div class="cell-sub">
                            <i class="bi bi-building me-1"></i>
                            <span class="reg-text">Supplier Info</span>
                        </div>
                    </div>`;
            }

            // Limit to first 10 for tooltip preview
            const previewLimit = 10;
            const previewSuppliers = supplierNames.slice(0, previewLimit);
            const hasMore = supplierNames.length > previewLimit;

            // Create preview list for tooltip
            const previewList = previewSuppliers.map((supplier, index) =>
                `<div style="
                    padding: 6px 10px;
                    margin: 1px 0;
                    background: ${index % 2 === 0 ? '#f8fafc' : '#ffffff'};
                    border-radius: 4px;
                    border-left: 3px solid #10b981;
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    font-size: 12px;
                    color: #1e293b;
                    font-weight: 500;
                ">${supplier.trim()}</div>`
            ).join('');

            // Create unique ID for this row's supplier data
            const uniqueId = `suppliers_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Link this tooltip instance to the table row so we can fetch detailed objects later
            try {
                if (!window.supplierRowMap) window.supplierRowMap = {};
                if (row && row.DT_RowId) window.supplierRowMap[uniqueId] = row.DT_RowId;
            } catch (e) { console.warn('supplierRowMap link failed', e); }

            const tooltipContent = `
                <div style="
                    max-width: 320px;
                    text-align: left;
                    background: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    padding: 14px;
                ">
                    <div style="
                        font-weight: 600;
                        margin-bottom: 10px;
                        color: #1e293b;
                        border-bottom: 2px solid #e2e8f0;
                        padding-bottom: 6px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    ">
                        <i class="bi bi-person-badge" style="color: #10b981;"></i>
                        Suppliers (${supplierNames.length}):
                    </div>
                    <div style="max-height: 180px; overflow-y: auto; margin-bottom: ${hasMore ? '10px' : '0'}; scrollbar-width: none; -ms-overflow-style: none;" class="hide-scrollbar">
                        ${previewList}
                    </div>
                    ${hasMore ? `
                        <div style="
                            text-align: center;
                            padding-top: 8px;
                            border-top: 1px solid #e2e8f0;
                        ">
                            <button onclick="window.outboundManualExcel.showSupplierModal('${uniqueId}')"
                                style="
                                    background: #10b981;
                                    color: white;
                                    border: none;
                                    padding: 6px 12px;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    cursor: pointer;
                                    font-weight: 500;
                                "
                                onmouseover="this.style.background='#059669'"
                                onmouseout="this.style.background='#10b981'">
                                View All ${supplierNames.length} Suppliers
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;

            // Store supplier data for modal access
            if (!window.supplierModalData) window.supplierModalData = {};
            window.supplierModalData[uniqueId] = supplierNames;

            return `
                <div class="cell-group">
                    <div class="cell-main">
                        <i class="bi bi-person-badge me-1"></i>
                        <span class="supplier-count"
                            style="cursor: pointer;"
                            data-bs-toggle="tooltip"
                            data-bs-placement="top"
                            data-bs-html="true"
                            title="${tooltipContent.replace(/"/g, '&quot;')}">
                            ${countLine}
                        </span>
                    </div>
                    <div class="cell-sub">
                        <i class="bi bi-list-ul me-1"></i>
                        <span class="reg-text">Multiple Suppliers</span>
                        <button class="btn btn-sm btn-outline-primary ms-2"
                            onclick="window.outboundManualExcel.showSupplierModal('${uniqueId}')"
                            style="font-size: 10px; padding: 2px 6px;">
                            View All
                        </button>
                    </div>
                </div>`;
        }

        // Single supplier
        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-person-badge me-1"></i>
                    <span>${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-building me-1"></i>
                    <span class="reg-text">Supplier Name</span>
                </div>
            </div>`;
    }

    renderReceiver(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';

        // Handle multi-line receiver names
        const lines = data.split('\n');
        if (lines.length > 1) {
            const countLine = lines[0]; // e.g., "5 Receiver(s)"
            const receiverNames = lines.slice(1).filter(name => name.trim() && name.trim() !== 'N/A'); // Get actual receiver names, filter out N/A

            // If no valid receiver names after filtering, show single receiver format
            if (receiverNames.length === 0) {
                return `
                    <div class="cell-group">
                        <div class="cell-main">
                            <i class="bi bi-person-check me-1"></i>
                            <span>${countLine}</span>
                        </div>
                        <div class="cell-sub">
                            <i class="bi bi-building me-1"></i>
                            <span class="reg-text">Receiver Info</span>
                        </div>
                    </div>`;
            }

            // Limit to first 10 for tooltip preview
            const previewLimit = 10;
            const previewReceivers = receiverNames.slice(0, previewLimit);
            const hasMore = receiverNames.length > previewLimit;

            // Create preview list for tooltip
            const previewList = previewReceivers.map((receiver, index) =>
                `<div style="
                    padding: 6px 10px;
                    margin: 1px 0;
                    background: ${index % 2 === 0 ? '#f8fafc' : '#ffffff'};
                    border-radius: 4px;
                    border-left: 3px solid #f59e0b;
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    font-size: 12px;
                    color: #1e293b;
                    font-weight: 500;
                ">${receiver.trim()}</div>`
            ).join('');

            // Create unique ID for this row's receiver data
            const uniqueId = `receivers_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Link this tooltip instance to the table row so we can fetch detailed objects later
            try {
                if (!window.receiverRowMap) window.receiverRowMap = {};
                if (row && row.DT_RowId) window.receiverRowMap[uniqueId] = row.DT_RowId;
            } catch (e) { console.warn('receiverRowMap link failed', e); }

            const tooltipContent = `
                <div style="
                    max-width: 320px;
                    text-align: left;
                    background: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    padding: 14px;
                ">
                    <div style="
                        font-weight: 600;
                        margin-bottom: 10px;
                        color: #1e293b;
                        border-bottom: 2px solid #e2e8f0;
                        padding-bottom: 6px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    ">
                        <i class="bi bi-person-check" style="color: #f59e0b;"></i>
                        Receivers (${receiverNames.length}):
                    </div>
                    <div style="max-height: 180px; overflow-y: auto; margin-bottom: ${hasMore ? '10px' : '0'}; scrollbar-width: none; -ms-overflow-style: none;" class="hide-scrollbar">
                        ${previewList}
                    </div>
                    ${hasMore ? `
                        <div style="
                            text-align: center;
                            padding-top: 8px;
                            border-top: 1px solid #e2e8f0;
                        ">
                            <button onclick="window.outboundManualExcel.showReceiverModal('${uniqueId}')"
                                style="
                                    background: #f59e0b;
                                    color: white;
                                    border: none;
                                    padding: 6px 12px;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    cursor: pointer;
                                    font-weight: 500;
                                "
                                onmouseover="this.style.background='#d97706'"
                                onmouseout="this.style.background='#f59e0b'">
                                View All ${receiverNames.length} Receivers
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;

            // Store receiver data for modal access
            if (!window.receiverModalData) window.receiverModalData = {};
            window.receiverModalData[uniqueId] = receiverNames;

            return `
                <div class="cell-group">
                    <div class="cell-main">
                        <i class="bi bi-person-check me-1"></i>
                        <span class="receiver-count"
                            style="cursor: pointer;"
                            data-bs-toggle="tooltip"
                            data-bs-placement="top"
                            data-bs-html="true"
                            title="${tooltipContent.replace(/"/g, '&quot;')}">
                            ${countLine}
                        </span>
                    </div>
                    <div class="cell-sub">
                        <i class="bi bi-list-ul me-1"></i>
                        <span class="reg-text">Multiple Receivers</span>
                        <button class="btn btn-sm btn-outline-primary ms-2"
                            onclick="window.outboundManualExcel.showReceiverModal('${uniqueId}')"
                            style="font-size: 10px; padding: 2px 6px;">
                            View All
                        </button>
                    </div>
                </div>`;
        }

        // Single receiver
        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-person-check me-1"></i>
                    <span>${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-building me-1"></i>
                    <span class="reg-text">Receiver Name</span>
                </div>
            </div>`;
    }

    renderInvDateInfo(data, type, row) {
        if (!data || data === 'N/A') return '<span class="text-muted">N/A</span>';

        // Handle multi-line date info
        const value = String(data);
        const lines = value.split('\n');
        if (lines.length > 1) {
            const countLine = lines[0]; // e.g., "3 Dates"
            const dateList = lines.slice(1).map(date => date.trim()).join(', ');

            return `
                <div class="cell-group">
                    <div class="cell-main">
                        <i class="bi bi-calendar-event me-1"></i>
                        <span title="${dateList}">${countLine}</span>
                    </div>
                    <div class="cell-sub">
                        <i class="bi bi-list-ul me-1"></i>
                        <span class="reg-text">Multiple Dates</span>
                    </div>
                </div>`;
        }

        // Single date - format like the Date column
        const formattedDate = formatManualInvoiceDateForDisplay(value);
        if (formattedDate) {
            return `
                <div class="cell-group">
                    <div class="cell-main">
                        <i class="bi bi-calendar-event me-1"></i>
                        <span class="date-value">${formattedDate}</span>
                    </div>
                    <div class="cell-sub">
                        <i class="bi bi-calendar-date me-1"></i>
                        <span class="reg-text">Invoice Date</span>
                    </div>
                </div>`;
        }

        // Fallback for non-date strings
        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-calendar-event me-1"></i>
                    <span>${value}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-calendar-date me-1"></i>
                    <span class="reg-text">Invoice Date</span>
                </div>
            </div>`;
    }

    formatFileSize(bytes) {
        if (!bytes) return 'N/A';

        const size = parseInt(bytes);
        if (isNaN(size)) return 'N/A';

        const units = ['B', 'KB', 'MB', 'GB'];
        let unitIndex = 0;
        let fileSize = size;

        while (fileSize >= 1024 && unitIndex < units.length - 1) {
            fileSize /= 1024;
            unitIndex++;
        }

        return `${fileSize.toFixed(1)} ${units[unitIndex]}`;
    }

    // Build a status map from LHDN response: invoiceNumber → { status, error }
    _buildInvoiceStatusMap(lhdnResponse) {
        const statusMap = {};
        if (!lhdnResponse) return statusMap;

        try {
            const parsed = typeof lhdnResponse === 'string' ? JSON.parse(lhdnResponse) : lhdnResponse;
            const accepted = parsed?.data?.acceptedDocuments || parsed?.acceptedDocuments || [];
            const rejected = parsed?.data?.rejectedDocuments || parsed?.rejectedDocuments || [];

            for (const doc of accepted) {
                const num = doc.invoiceCodeNumber || doc.codeNumber;
                if (num) statusMap[num] = { status: 'accepted', uuid: doc.uuid };
            }
            for (const doc of rejected) {
                const num = doc.invoiceCodeNumber || doc.codeNumber;
                const errDetails = doc.error?.details || [];
                const errMsg = errDetails.map(d => d.message).filter(Boolean).join('; ') || doc.error?.message || 'Rejected';
                if (num) statusMap[num] = { status: 'rejected', error: errMsg, code: doc.error?.code };
            }
        } catch (e) {
            console.warn('Could not parse LHDN response for status map:', e);
        }
        return statusMap;
    }

    // Show invoice modal with all invoice numbers and their LHDN status
    showInvoiceModal(uniqueId) {
        const invoiceNumbers = window.invoiceModalData?.[uniqueId];
        if (!invoiceNumbers || !Array.isArray(invoiceNumbers)) {
            console.error('Invoice data not found for ID:', uniqueId);
            return;
        }

        const lhdnResponse = window.invoiceLhdnData?.[uniqueId];
        const statusMap = this._buildInvoiceStatusMap(lhdnResponse);
        const hasStatusData = Object.keys(statusMap).length > 0;

        const acceptedCount = Object.values(statusMap).filter(s => s.status === 'accepted').length;
        const rejectedCount = Object.values(statusMap).filter(s => s.status === 'rejected').length;
        const pendingCount = invoiceNumbers.length - acceptedCount - rejectedCount;

        const modalId = 'invoiceNumbersModal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal fade';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-labelledby', 'invoiceNumbersModalLabel');
            modal.setAttribute('aria-hidden', 'true');
            document.body.appendChild(modal);
        }

        const itemsPerPage = 50;
        const totalPages = Math.ceil(invoiceNumbers.length / itemsPerPage);
        const totalCount = invoiceNumbers.length;
        const validPct = totalCount > 0 ? Math.round((acceptedCount / totalCount) * 100) : 0;
        const rejectedPct = totalCount > 0 ? Math.round((rejectedCount / totalCount) * 100) : 0;

        const getStatusBadge = (invoiceNum) => {
            const info = statusMap[invoiceNum.trim()];
            if (!info) return hasStatusData
                ? '<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-weight:600;letter-spacing:0.3px;white-space:nowrap;">PENDING</span>'
                : '';
            if (info.status === 'accepted') {
                return `<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:600;letter-spacing:0.3px;white-space:nowrap;">
                    <i class="bi bi-check-circle-fill me-1"></i>VALID</span>`;
            }
            return `<span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:600;letter-spacing:0.3px;white-space:nowrap;cursor:help;"
                title="${(info.error || '').replace(/"/g, '&quot;')}">
                <i class="bi bi-x-circle-fill me-1"></i>REJECTED</span>`;
        };

        const getBorderColor = (invoiceNum) => {
            const info = statusMap[invoiceNum.trim()];
            if (!info) return '#cbd5e1';
            return info.status === 'accepted' ? '#22c55e' : '#ef4444';
        };

        const createInvoiceList = (filteredInvoices, currentPage = 1) => {
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pageInvoices = filteredInvoices.slice(startIndex, endIndex);

            if (pageInvoices.length === 0) {
                return '<div style="text-align:center;padding:30px 0;color:#94a3b8;"><i class="bi bi-inbox" style="font-size:28px;display:block;margin-bottom:8px;"></i>No invoices match this filter</div>';
            }

            return pageInvoices.map((invoice, index) => {
                const info = statusMap[invoice.trim()];
                const borderColor = getBorderColor(invoice);
                const isRejected = info?.status === 'rejected';
                const isAccepted = info?.status === 'accepted';
                const bg = isRejected ? '#fef2f2' : (isAccepted ? '#f0fdf4' : '#f8fafc');
                const hoverBg = isRejected ? '#fee2e2' : (isAccepted ? '#dcfce7' : '#e0f2fe');

                let errorRow = '';
                if (isRejected && info.error) {
                    errorRow = `<div style="margin:6px 0 2px 38px;padding:6px 10px;background:#fee2e2;border-radius:4px;font-size:11px;color:#991b1b;font-family:system-ui,sans-serif;line-height:1.4;">
                        <i class="bi bi-exclamation-triangle-fill me-1" style="font-size:10px;"></i>${info.error}
                    </div>`;
                }

                return `
                <div class="invoice-item" style="padding:10px 12px;margin-bottom:4px;background:${bg};border-radius:8px;border-left:4px solid ${borderColor};transition:all 0.15s ease;cursor:pointer;"
                    onmouseover="this.style.background='${hoverBg}';this.style.transform='translateX(3px)'"
                    onmouseout="this.style.background='${bg}';this.style.transform='none'"
                    onclick="window.outboundManualExcel.copyInvoiceNumber('${invoice.trim()}', this, true)">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="background:${borderColor};color:white;padding:2px 0;border-radius:4px;font-size:10px;font-weight:700;min-width:28px;text-align:center;display:inline-block;font-family:system-ui,sans-serif;">${startIndex + index + 1}</span>
                        <span style="flex:1;font-family:'SF Mono',SFMono-Regular,ui-monospace,monospace;font-size:13px;font-weight:500;color:#1e293b;">${invoice.trim()}</span>
                        ${getStatusBadge(invoice)}
                        <i class="bi bi-clipboard" style="color:#94a3b8;font-size:12px;flex-shrink:0;" title="Click to copy"></i>
                    </div>
                    ${errorRow}
                </div>`;
            }).join('');
        };

        const createPagination = (totalPages, currentPage, filteredCount) => {
            if (totalPages <= 1) return '';
            let pagination = '<nav aria-label="Invoice pagination"><ul class="pagination pagination-sm justify-content-center mb-0">';
            pagination += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateInvoiceModal('${uniqueId}', ${currentPage - 1}); return false;">
                    <i class="bi bi-chevron-left"></i></a></li>`;
            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, startPage + 4);
            for (let i = startPage; i <= endPage; i++) {
                pagination += `<li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateInvoiceModal('${uniqueId}', ${i}); return false;">${i}</a></li>`;
            }
            pagination += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateInvoiceModal('${uniqueId}', ${currentPage + 1}); return false;">
                    <i class="bi bi-chevron-right"></i></a></li>`;
            pagination += '</ul></nav>';
            return pagination;
        };

        // Filter tabs + progress bar
        const filterSection = hasStatusData ? `
            <div style="display:flex;gap:0;margin-bottom:6px;background:#f1f5f9;border-radius:8px;padding:3px;border:1px solid #e2e8f0;">
                <button class="inv-filter-btn active" style="flex:1;padding:6px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;background:#fff;color:#1a365d;box-shadow:0 1px 2px rgba(0,0,0,0.08);"
                    onclick="window.outboundManualExcel.filterInvoicesByStatus('${uniqueId}', 'all', this)">
                    All <span style="opacity:0.6;margin-left:2px;">${totalCount}</span></button>
                <button class="inv-filter-btn" style="flex:1;padding:6px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;background:transparent;color:#64748b;"
                    onclick="window.outboundManualExcel.filterInvoicesByStatus('${uniqueId}', 'accepted', this)">
                    <i class="bi bi-check-circle-fill me-1" style="color:#22c55e;"></i>Valid <span style="opacity:0.6;margin-left:2px;">${acceptedCount}</span></button>
                ${rejectedCount > 0 ? `<button class="inv-filter-btn" style="flex:1;padding:6px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;background:transparent;color:#64748b;"
                    onclick="window.outboundManualExcel.filterInvoicesByStatus('${uniqueId}', 'rejected', this)">
                    <i class="bi bi-x-circle-fill me-1" style="color:#ef4444;"></i>Rejected <span style="opacity:0.6;margin-left:2px;">${rejectedCount}</span></button>` : ''}
                ${pendingCount > 0 ? `<button class="inv-filter-btn" style="flex:1;padding:6px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;background:transparent;color:#64748b;"
                    onclick="window.outboundManualExcel.filterInvoicesByStatus('${uniqueId}', 'pending', this)">
                    <i class="bi bi-hourglass-split me-1" style="color:#94a3b8;"></i>Pending <span style="opacity:0.6;margin-left:2px;">${pendingCount}</span></button>` : ''}
            </div>
            <div style="margin-bottom:14px;">
                <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;display:flex;">
                    ${acceptedCount > 0 ? `<div style="width:${validPct}%;background:linear-gradient(90deg,#22c55e,#16a34a);transition:width 0.5s ease;"></div>` : ''}
                    ${rejectedCount > 0 ? `<div style="width:${rejectedPct}%;background:linear-gradient(90deg,#ef4444,#dc2626);transition:width 0.5s ease;"></div>` : ''}
                    ${pendingCount > 0 ? `<div style="flex:1;background:#cbd5e1;"></div>` : ''}
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:3px;">
                    <span style="font-size:10px;color:#64748b;">${validPct}% valid</span>
                    ${rejectedCount > 0 ? `<span style="font-size:10px;color:#64748b;">${rejectedPct}% rejected</span>` : ''}
                </div>
            </div>` : '';

        modal.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content" style="border:none;border-radius:14px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.15);">
                    <div class="modal-header" style="background:linear-gradient(135deg,#1a365d 0%,#2d4a7c 100%);padding:18px 24px;border:none;">
                        <h5 class="modal-title text-white" id="invoiceNumbersModalLabel" style="font-size:16px;font-weight:600;">
                            <i class="bi bi-receipt me-2" style="opacity:0.8;"></i>
                            Invoice Numbers
                            <span style="font-weight:400;opacity:0.8;font-size:14px;margin-left:6px;">(${invoiceNumbers.length} total)</span>
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" style="opacity:0.8;"></button>
                    </div>
                    <div class="modal-body" style="padding:20px 24px;">
                        <div style="margin-bottom:12px;">
                            <div class="input-group" style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                                <span class="input-group-text" style="background:#f8fafc;border:none;padding-left:14px;"><i class="bi bi-search" style="color:#94a3b8;"></i></span>
                                <input type="text" class="form-control" id="invoiceSearch" placeholder="Search invoice numbers..."
                                    style="border:none;box-shadow:none;font-size:13px;"
                                    oninput="window.outboundManualExcel.filterInvoices('${uniqueId}')">
                            </div>
                        </div>
                        ${filterSection}
                        <div id="invoiceListContainer" style="max-height:420px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent;padding-right:4px;">
                            ${createInvoiceList(invoiceNumbers, 1)}
                        </div>
                        <div id="invoicePagination" class="mt-3">
                            ${createPagination(totalPages, 1, invoiceNumbers.length)}
                        </div>
                        <div class="mt-2 text-center">
                            <small id="invoiceCountDisplay" style="color:#94a3b8;font-size:12px;">
                                Showing 1-${Math.min(itemsPerPage, invoiceNumbers.length)} of ${invoiceNumbers.length} invoices
                            </small>
                        </div>
                    </div>
                    <div class="modal-footer" style="border-top:1px solid #f1f5f9;padding:12px 24px;">
                        <button type="button" class="btn btn-lhdn-cancel" data-bs-dismiss="modal" style="border-radius:8px;padding:8px 20px;">Close</button>
                    </div>
                </div>
            </div>
        `;

        // Store state for filtering/pagination/status
        if (!window.invoiceModalState) window.invoiceModalState = {};
        window.invoiceModalState[uniqueId] = {
            allInvoices: invoiceNumbers,
            filteredInvoices: invoiceNumbers,
            currentPage: 1,
            itemsPerPage: itemsPerPage,
            statusMap: statusMap,
            createInvoiceList,
            createPagination
        };

        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    // Filter invoices by LHDN status (all / accepted / rejected / pending)
    filterInvoicesByStatus(uniqueId, status, btn) {
        const state = window.invoiceModalState?.[uniqueId];
        if (!state) return;

        // Update active tab style
        if (btn) {
            btn.closest('div').querySelectorAll('.inv-filter-btn, .btn').forEach(b => {
                b.style.background = 'transparent';
                b.style.color = '#64748b';
                b.style.boxShadow = 'none';
                b.classList.remove('active');
            });
            btn.style.background = '#fff';
            btn.style.color = '#1a365d';
            btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
            btn.classList.add('active');
        }

        let filtered;
        if (status === 'all') {
            filtered = state.allInvoices;
        } else if (status === 'accepted') {
            filtered = state.allInvoices.filter(inv => state.statusMap[inv.trim()]?.status === 'accepted');
        } else if (status === 'rejected') {
            filtered = state.allInvoices.filter(inv => state.statusMap[inv.trim()]?.status === 'rejected');
        } else if (status === 'pending') {
            filtered = state.allInvoices.filter(inv => !state.statusMap[inv.trim()]);
        }

        state.filteredInvoices = filtered;
        state.currentPage = 1;

        const container = document.getElementById('invoiceListContainer');
        const pagination = document.getElementById('invoicePagination');
        const countDisplay = document.getElementById('invoiceCountDisplay');

        if (container) container.innerHTML = state.createInvoiceList(filtered, 1);
        const totalPages = Math.ceil(filtered.length / state.itemsPerPage);
        if (pagination) pagination.innerHTML = state.createPagination(totalPages, 1, filtered.length);
        if (countDisplay) countDisplay.textContent = `Showing 1-${Math.min(state.itemsPerPage, filtered.length)} of ${filtered.length} invoices`;
    }

    // Update invoice modal with pagination
    updateInvoiceModal(uniqueId, page) {
        const state = window.invoiceModalState?.[uniqueId];
        if (!state) return;

        const totalPages = Math.ceil(state.filteredInvoices.length / state.itemsPerPage);
        if (page < 1 || page > totalPages) return;

        state.currentPage = page;

        const startIndex = (page - 1) * state.itemsPerPage;
        const endIndex = Math.min(startIndex + state.itemsPerPage, state.filteredInvoices.length);

        if (state.createInvoiceList) {
            document.getElementById('invoiceListContainer').innerHTML = state.createInvoiceList(state.filteredInvoices, page);
        }

        if (state.createPagination) {
            document.getElementById('invoicePagination').innerHTML = state.createPagination(totalPages, page, state.filteredInvoices.length);
        } else {
            this.updatePagination(uniqueId, totalPages, page);
        }

        this.updateInvoiceCount(startIndex, endIndex, state.filteredInvoices.length);
    }

    // Filter invoices based on search
    filterInvoices(uniqueId) {
        const state = window.invoiceModalState?.[uniqueId];
        if (!state) return;

        const searchTerm = document.getElementById('invoiceSearch').value.toLowerCase();
        state.filteredInvoices = state.allInvoices.filter(invoice =>
            invoice.toLowerCase().includes(searchTerm)
        );
        state.currentPage = 1;

        this.updateInvoiceModal(uniqueId, 1);
    }

    // Update pagination controls
    updatePagination(uniqueId, totalPages, currentPage) {
        if (totalPages <= 1) {
            document.getElementById('invoicePagination').innerHTML = '';
            return;
        }

        let pagination = '<nav aria-label="Invoice pagination"><ul class="pagination pagination-sm justify-content-center mb-0">';

        // Previous button
        pagination += `
            <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateInvoiceModal('${uniqueId}', ${currentPage - 1}); return false;">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            pagination += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateInvoiceModal('${uniqueId}', ${i}); return false;">
                        ${i}
                    </a>
                </li>
            `;
        }

        // Next button
        pagination += `
            <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateInvoiceModal('${uniqueId}', ${currentPage + 1}); return false;">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        pagination += '</ul></nav>';
        document.getElementById('invoicePagination').innerHTML = pagination;
    }

    // Update invoice count display
    updateInvoiceCount(startIndex, endIndex, totalCount) {
        const showingStart = startIndex + 1;
        const showingEnd = Math.min(endIndex, totalCount);
        const countElement = document.getElementById('invoiceCountDisplay');
        if (countElement) {
            countElement.innerHTML = `Showing ${showingStart}-${showingEnd} of ${totalCount} invoices`;
            console.log(`Updated count display: Showing ${showingStart}-${showingEnd} of ${totalCount} invoices`);
        } else {
            console.error('Invoice count display element not found');
        }
    }

    // Export invoice list
    exportInvoices(uniqueId) {
        const state = window.invoiceModalState?.[uniqueId];
        if (!state) return;

        const invoices = state.filteredInvoices;
        const csvContent = "data:text/csv;charset=utf-8," +
            "Invoice Number\n" +
            invoices.map(invoice => `"${invoice.trim()}"`).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `invoice_numbers_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Show detailed LHDN validation results modal
    async showLHDNDetailsModal(fileId) {
        console.log('🔍 showLHDNDetailsModal called with fileId:', fileId);
        try {
            // Find the file data from the current table data or fetch fresh data
            let tableData = dataCache.getCachedData();
            console.log('📊 Cache data available:', !!tableData, 'Files count:', tableData?.length || 0);
            let fileData = tableData?.find(file => String(file.id) === String(fileId));
            console.log('🔍 File found in cache:', !!fileData, 'Looking for ID:', fileId);

            // If not found in cache, try to refresh the table data
            if (!fileData) {
                console.log('File not found in cache, refreshing table data...');
                try {
                    // Force refresh the table to get latest data
                    if (this.table && this.table.ajax) {
                        await new Promise((resolve, reject) => {
                            this.table.ajax.reload((json) => {
                                const data = json?.data || json?.files;
                                if (data) {
                                    dataCache.updateCache(data);
                                    resolve();
                                } else {
                                    resolve();
                                }
                            }, false);
                        });

                        // Try to find the file again after refresh
                        tableData = dataCache.getCachedData();
                        fileData = tableData?.find(file => String(file.id) === String(fileId));
                    }
                } catch (refreshError) {
                    console.warn('Failed to refresh table data:', refreshError);
                }
            }

            // If still not found, try to fetch file details directly from API
            if (!fileData) {
                console.log('File not found in table data, attempting direct API fetch...');
                try {
                    const response = await fetch(`/api/outbound-files-manual/uploaded-files/${fileId}/details`, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include'
                    });

                    if (response.ok) {
                        const result = await response.json();
                        if (result.success && result.data) {
                            const d = result.data;
                            fileData = {
                                ...d,
                                id: d.id,
                                fileName: d.fileName || d.filename || d.original_filename,
                                uploadDate: d.uploadDate || d.upload_date,
                                status: d.status || d.processing_status,
                                lhdnResponse: d.lhdnResponse || d.lhdn_response,
                                submissionUid: d.submissionUid || d.submission_uid,
                                processedDate: d.processedDate || d.processed_date,
                                submittedDate: d.submittedDate || d.submitted_date,
                                invoiceNumber: d.invoiceNumber || d.invoice_count,
                            };
                            console.log('File data retrieved directly from API');
                        }
                    } else if (response.status === 404) {
                        console.error('File not found in database for ID:', fileId);
                        this.showEnhancedErrorModal('File Not Found',
                            'The requested file could not be found in the database.',
                            'This file may have been deleted or you may not have permission to access it.',
                            [
                                'Refresh the page to update the file list',
                                'Check if the file was recently deleted',
                                'Contact support if this issue persists'
                            ]
                        );
                        return;
                    } else {
                        console.error('API error fetching file details:', response.status);
                    }
                } catch (apiError) {
                    console.error('Error fetching file details from API:', apiError);
                }
            }

            if (!fileData) {
                console.error('File data not found for ID:', fileId);
                this.showEnhancedErrorModal('File Data Not Found',
                    'The requested file could not be found after checking all available sources.',
                    'This may indicate a synchronization issue between the display and the database.',
                    [
                        'Refresh the page to reload the file list',
                        'Clear your browser cache and try again',
                        'Contact support if the problem continues'
                    ]
                );
                return;
            }

            // Parse LHDN response if available
            let lhdnData = null;
            if (fileData.lhdnResponse) {
                try {
                    lhdnData = typeof fileData.lhdnResponse === 'string'
                        ? JSON.parse(fileData.lhdnResponse)
                        : fileData.lhdnResponse;
                } catch (e) {
                    console.warn('Error parsing LHDN response:', e);
                }
            }

            this.displayLHDNDetailsModal(fileData, lhdnData);

        } catch (error) {
            console.error('Error showing LHDN details:', error);
            this.showErrorModal('Error', 'Failed to load LHDN details: ' + (error.message || 'Unknown error'));
        }
    }

    // Display the LHDN details modal with validation results
    displayLHDNDetailsModal(fileData, lhdnData) {
        // Remove any existing modal
        const existingModal = document.getElementById('lhdnDetailsModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Determine modal content based on available data
        let modalContent = '';
        let modalTitle = 'File Details';
        let statusInfo = '';

        if (lhdnData) {
            const isFailed = lhdnData.status === 'failed' || lhdnData.success === false;

            if (lhdnData.summary) {
                // Multi-document submission with summary
                const { totalDocuments, validDocuments, failedDocuments } = lhdnData.summary;
                modalTitle = 'LHDN Submission Results';

                if (failedDocuments === 0) {
                    statusInfo = `<div class="alert alert-success om-submission-alert">
                        <i class="bi bi-check-circle-fill om-alert-icon"></i>
                        <div class="om-alert-text"><strong>Success:</strong> All ${validDocuments} documents were successfully submitted to LHDN.</div>
                    </div>`;
                } else if (validDocuments === 0) {
                    statusInfo = buildFailedSubmissionStatusAlert(fileData, lhdnData);
                } else {
                    statusInfo = `<div class="alert alert-warning om-submission-alert">
                        <i class="bi bi-exclamation-circle om-alert-icon"></i>
                        <div class="om-alert-text"><strong>Partial success:</strong> ${validDocuments} of ${totalDocuments} invoices were submitted. ${failedDocuments} need correction below.</div>
                    </div>`;
                }

                modalContent = this.generateValidationErrorsContent(lhdnData, fileData);
            } else if (lhdnData.status === 'success' || lhdnData.success === true) {
                // Single document success
                modalTitle = 'LHDN Submission Results';
                statusInfo = `<div class="alert alert-success om-submission-alert">
                    <i class="bi bi-check-circle-fill om-alert-icon"></i>
                    <div class="om-alert-text"><strong>Success:</strong> Document was successfully submitted to LHDN.</div>
                </div>`;
                modalContent = this.generateSingleDocumentContent(lhdnData);
            } else if (isFailed && (lhdnData.error || lhdnData.details)) {
                modalTitle = 'Submission Not Completed';
                statusInfo = buildFailedSubmissionStatusAlert(fileData, lhdnData);
                modalContent = this.generateSubmissionErrorContent(lhdnData, fileData);
            } else if (isFailed) {
                // Generic failure
                modalTitle = 'LHDN Submission Error';
                statusInfo = `<div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    <strong>Failed:</strong> Document submission failed.
                </div>`;
                modalContent = this.generateSingleDocumentErrorContent(lhdnData);
            } else {
                // Unknown LHDN response format
                modalContent = `<div class="alert alert-info">
                    <i class="bi bi-info-circle me-2"></i>
                    LHDN response data is available but in an unrecognized format.
                </div>
                <pre class="bg-light p-3 rounded">${JSON.stringify(lhdnData, null, 2)}</pre>`;
            }
        } else {
            // No LHDN data available
            modalTitle = 'File Information';
            statusInfo = `<div class="alert alert-info">
                <i class="bi bi-info-circle me-2"></i>
                This file has not been submitted to LHDN yet, or no response data is available.
            </div>`;
            modalContent = this.generateFileInfoContent(fileData);
        }

        // Create modal HTML
        const modalHTML = `
            <div id="lhdnDetailsModal" class="lhdn-details-modal">
                <div class="lhdn-details-overlay" onclick="this.parentElement.remove()"></div>
                <div class="lhdn-details-content">
                    <div class="lhdn-details-header">
                        <div class="d-flex align-items-center">
                            <div class="header-icon-wrapper me-3">
                                <i class="bi bi-file-earmark-text-fill"></i>
                            </div>
                            <div>
                                <h4 class="mb-1 fw-semibold">${modalTitle}</h4>
                                <p class="mb-0 small opacity-75">${fileData.fileName || 'Unknown File'}</p>
                            </div>
                        </div>
                        <button class="btn-close-custom" onclick="this.closest('.lhdn-details-modal').remove()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                    <div class="lhdn-details-body">
                        ${statusInfo}
                        ${modalContent}
                    </div>
                    <div class="lhdn-details-footer">
                        <button type="button" class="om-btn-close" onclick="this.closest('.lhdn-details-modal').remove()">
                            <i class="bi bi-x-lg"></i>Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add styles if not already present
        this.addLHDNDetailsStyles();

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Show modal with animation
        setTimeout(() => {
            const modal = document.getElementById('lhdnDetailsModal');
            if (modal) {
                modal.classList.add('show');
            }
        }, 10);
    }

    // Generate content for submission results with accepted/rejected documents
    generateValidationErrorsContent(lhdnData, fileData = null) {
        let content = '';
        const invoiceLookup = buildInvoiceNumberLookup(fileData);
        const accepted = lhdnData.data?.acceptedDocuments || [];
        const rejected = lhdnData.data?.rejectedDocuments || [];
        const summary = lhdnData.summary;

        // Summary bar
        if (summary) {
            content += `<div class="om-status-chips">
                <div class="om-status-chip om-status-chip--success">
                    <strong style="color: #166534;">${summary.validDocuments}</strong>
                    <small class="text-muted ms-1">Accepted</small>
                </div>
                <div class="om-status-chip om-status-chip--danger">
                    <strong style="color: #991b1b;">${summary.failedDocuments}</strong>
                    <small class="text-muted ms-1">Rejected</small>
                </div>
                <div class="om-status-chip">
                    <strong>${summary.totalDocuments}</strong>
                    <small class="text-muted ms-1">Total</small>
                </div>
            </div>`;
        }

        // Rejected documents section — expand nested LHDN errors per invoice
        if (rejected.length > 0) {
            const rejectedIssues = collectAllSubmissionIssues(
                { data: { rejectedDocuments: rejected } },
                invoiceLookup
            );
            const issueCount = rejectedIssues.length || rejected.length;
            content += `<h6 class="mb-2 mt-3 om-section-title om-section-title--danger"><i class="bi bi-x-circle me-2"></i>What to fix (${issueCount} issue${issueCount > 1 ? 's' : ''} across ${rejected.length} invoice${rejected.length > 1 ? 's' : ''})</h6>`;

            if (rejectedIssues.length > 0) {
                rejectedIssues.forEach((detail, index) => {
                    const friendly = toEndUserFriendlyDetail(detail, invoiceLookup);
                    const invoiceNo = friendly.invoiceNumber
                        ? `Invoice No. ${escapeHtml(friendly.invoiceNumber)}`
                        : (detail.invoiceRef ? `Invoice No. ${escapeHtml(detail.invoiceRef)}` : '');
                    const lineHint = friendly.lineItemNum
                        ? `<div class="om-error-where"><i class="bi bi-list-ol me-1"></i>Line item ${friendly.lineItemNum}</div>`
                        : '';
                    content += `
                    <div class="om-doc-panel om-doc-panel--danger">
                        <div class="d-flex align-items-start gap-2 mb-2">
                            <span class="om-issue-badge">${index + 1}</span>
                            <div class="flex-grow-1">
                                ${invoiceNo ? `<div class="om-error-title">${invoiceNo}</div>` : ''}
                                ${lineHint}
                            </div>
                        </div>
                        ${friendly.primaryField ? `<span class="om-error-field-name">${escapeHtml(friendly.primaryField)}</span>` : ''}
                        <p class="om-error-message mb-2">${escapeHtml(friendly.message)}</p>
                        <ul class="om-error-steps mb-0">
                            ${friendly.guidance.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}
                        </ul>
                    </div>`;
                });
            } else {
                rejected.forEach((doc, index) => {
                    const invoiceNo = doc.invoiceCodeNumber || doc.codeNumber || `Invoice ${index + 1}`;
                    const friendly = toEndUserFriendlyDetail({
                        userMessage: doc.error?.userFriendlyMessage,
                        message: doc.error?.message,
                        originalMessage: doc.error?.message,
                        guidance: doc.error?.guidance,
                        invoiceRef: doc.invoiceCodeNumber || doc.codeNumber,
                    }, invoiceLookup);
                    content += `
                    <div class="om-doc-panel om-doc-panel--danger">
                        <div class="d-flex align-items-start gap-2 mb-2">
                            <span class="om-issue-badge">${index + 1}</span>
                            <div class="flex-grow-1"><div class="om-error-title">${escapeHtml(invoiceNo)}</div></div>
                        </div>
                        <p class="om-error-message mb-2">${escapeHtml(friendly.message)}</p>
                    </div>`;
                });
            }
        }

        // Accepted documents section (collapsible)
        if (accepted.length > 0) {
            content += `<h6 class="mb-2 mt-3 om-section-title" style="color: #166534;"><i class="bi bi-check-circle me-2"></i>Successfully submitted (${accepted.length})</h6>`;
            content += `<div class="om-doc-panel om-doc-panel--success" style="max-height: 200px; overflow-y: auto;">`;
            accepted.forEach((doc, index) => {
                content += `<div class="d-flex align-items-center mb-1">
                    <i class="bi bi-check-circle-fill text-success me-2" style="font-size: 0.8rem;"></i>
                    <small><strong>${doc.invoiceCodeNumber || doc.codeNumber || `#${index + 1}`}</strong></small>
                    ${doc.uuid ? `<small class="text-muted ms-auto" style="font-size: 0.75rem;">${doc.uuid.substring(0, 12)}...</small>` : ''}
                </div>`;
            });
            content += '</div>';
        }

        // Fallback for old format with validationErrors
        if (!accepted.length && !rejected.length && lhdnData.validationErrors) {
            content += '<div class="validation-errors-section">';
            lhdnData.validationErrors.forEach((errorGroup, index) => {
                content += `<div class="error-group mb-3">
                    <strong>Invoice ${errorGroup.invoiceNumber || `#${index + 1}`}</strong>
                    <span class="badge bg-danger ms-2">${errorGroup.errors?.length || 0} error(s)</span>`;
                (errorGroup.errors || []).forEach(error => {
                    content += `<div class="ms-3 mt-1"><small>${error.userFriendlyMessage || error.message || 'Validation failed'}</small></div>`;
                });
                content += '</div>';
            });
            content += '</div>';
        }

        if (!content) {
            return '<div class="alert alert-info">No detailed submission results available.</div>';
        }

        return content;
    }

    // Generate content for single document success
    generateSingleDocumentContent(lhdnData) {
        let content = '<div class="submission-details">';

        if (lhdnData.submissionId) {
            content += `<div class="detail-item">
                <strong>Submission ID:</strong> ${lhdnData.submissionId}
            </div>`;
        }

        if (lhdnData.timestamp) {
            content += `<div class="detail-item">
                <strong>Submitted:</strong> ${new Date(lhdnData.timestamp).toLocaleString()}
            </div>`;
        }

        if (lhdnData.lhdnResponse) {
            content += `<div class="detail-item">
                <strong>LHDN Response:</strong>
                <pre class="bg-light p-2 rounded mt-1">${JSON.stringify(lhdnData.lhdnResponse, null, 2)}</pre>
            </div>`;
        }

        content += '</div>';
        return content;
    }

    // Generate content for single document errors
    generateSingleDocumentErrorContent(lhdnData) {
        let content = '<div class="error-details">';

        if (lhdnData.error) {
            content += `<div class="alert alert-danger">
                <strong>Error:</strong> ${lhdnData.error.message || lhdnData.error}
            </div>`;

            if (lhdnData.error.details && Array.isArray(lhdnData.error.details)) {
                content += '<h6 class="mt-3 mb-2">Error Details:</h6>';
                lhdnData.error.details.forEach(detail => {
                    content += `<div class="error-item">
                        <div class="error-message">${detail.message}</div>
                        ${detail.code ? `<div class="error-code">Code: ${detail.code}</div>` : ''}
                        ${detail.target ? `<div class="error-target">Target: ${detail.target}</div>` : ''}
                    </div>`;
                });
            }
        }

        content += '</div>';
        return content;
    }

    // Generate content for submission errors (handles both old and new formats)
    generateSubmissionErrorContent(lhdnData, fileData = null) {
        let content = '<div class="submission-error-section">';
        const invoiceLookup = buildInvoiceNumberLookup(fileData);

        const errorObj = typeof lhdnData.error === 'object' ? lhdnData.error : null;
        const errorStr = typeof lhdnData.error === 'string' ? lhdnData.error : null;
        const details = errorObj?.details || lhdnData.details || [];

        if (errorStr && !details.length) {
            const friendly = translateTechnicalLhdnMessage(errorStr, invoiceLookup);
            content += `<p class="om-error-message">${escapeHtml(friendly)}</p>`;
            content += `<ul class="om-error-steps">
                <li>Review your Excel template for missing or invalid values.</li>
                <li>Save the file and submit again from this page.</li>
            </ul>`;
            content += '</div>';
            return content;
        }

        const allIssues = collectAllSubmissionIssues(lhdnData, invoiceLookup);

        if (allIssues.length > 0) {
            content += `<h6 class="mb-3 om-section-title om-section-title--danger">
                <i class="bi bi-list-check me-2"></i>What to fix (${allIssues.length} issue${allIssues.length > 1 ? 's' : ''})
            </h6>`;

            allIssues.forEach((detail, index) => {
                const friendly = toEndUserFriendlyDetail(detail, invoiceLookup);
                const invoiceNo = friendly.invoiceNumber
                    ? `Invoice No. ${escapeHtml(friendly.invoiceNumber)}`
                    : (detail.invoiceRef ? `Invoice No. ${escapeHtml(detail.invoiceRef)}` : '');
                const lineHint = friendly.lineItemNum
                    ? `<div class="om-error-where"><i class="bi bi-list-ol me-1"></i>Line item ${friendly.lineItemNum}</div>`
                    : '';
                content += `
                    <div class="om-doc-panel om-doc-panel--danger">
                        <div class="d-flex align-items-start gap-2 mb-2">
                            <span class="om-issue-badge">${index + 1}</span>
                            <div class="flex-grow-1">
                                ${invoiceNo ? `<div class="om-error-title">${invoiceNo}</div>` : ''}
                                ${lineHint}
                            </div>
                        </div>
                        ${friendly.primaryField ? `<span class="om-error-field-name">${escapeHtml(friendly.primaryField)}</span>` : ''}
                        <p class="om-error-message mb-2">${escapeHtml(friendly.message)}</p>
                        <div class="om-error-help-box">
                            <div class="om-error-help-title"><i class="bi bi-lightbulb me-1"></i>What you can do</div>
                            <ul class="om-error-steps mb-0">
                                ${friendly.guidance.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}
                            </ul>
                        </div>
                        ${friendly.technicalRaw ? `
                            <details class="om-error-tech-details mt-2">
                                <summary>Technical details (for IT / support)</summary>
                                <pre class="om-error-tech-pre">${escapeHtml(friendly.technicalRaw)}</pre>
                            </details>
                        ` : ''}
                    </div>
                `;
            });
        } else if (errorObj) {
            const friendly = translateTechnicalLhdnMessage(errorObj.message, invoiceLookup);
            content += `<p class="om-error-message">${escapeHtml(friendly)}</p>`;
        }

        content += '</div>';
        return content;
    }

    // Generate content for file info when no LHDN data
    generateFileInfoContent(fileData) {
        let content = '<div class="file-info-section">';
        content += '<h6 class="mb-3"><i class="bi bi-file-earmark me-2"></i>File Information</h6>';

        content += `<div class="detail-item">
            <strong>File Name:</strong> ${fileData.fileName || 'Unknown'}
        </div>`;

        if (fileData.uploadDate) {
            content += `<div class="detail-item">
                <strong>Upload Date:</strong> ${new Date(fileData.uploadDate).toLocaleString()}
            </div>`;
        }

        if (fileData.status) {
            content += `<div class="detail-item">
                <strong>Status:</strong> ${fileData.status}
            </div>`;
        }

        if (fileData.invoiceNumber) {
            content += `<div class="detail-item">
                <strong>Invoice Count:</strong> ${Array.isArray(fileData.invoiceNumber) ? fileData.invoiceNumber.length : 1}
            </div>`;
        }

        content += '</div>';
        return content;
    }

    // Add CSS styles for LHDN details modal
    addLHDNDetailsStyles() {
        // Check if styles already exist
        if (document.getElementById('lhdnDetailsStyles')) {
            return;
        }

        const styles = `
            <style id="lhdnDetailsStyles">
                .lhdn-details-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 9999;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.3s ease, visibility 0.3s ease;
                }

                .lhdn-details-modal.show {
                    opacity: 1;
                    visibility: visible;
                }

                .lhdn-details-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(2px);
                }

                .lhdn-details-content {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 90%;
                    max-width: 800px;
                    max-height: 90vh;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .lhdn-details-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .lhdn-details-header .header-icon-wrapper {
                    width: 56px;
                    height: 56px;
                    min-width: 56px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .lhdn-details-header .header-icon-wrapper i {
                    font-size: 1.75rem;
                }

                .lhdn-details-body .om-submission-alert {
                    display: flex !important;
                    align-items: flex-start;
                    gap: 0.75rem;
                    text-align: left;
                }

                .lhdn-details-body .om-submission-alert .om-alert-text {
                    flex: 1;
                    min-width: 0;
                    line-height: 1.55;
                }

                .lhdn-details-body {
                    flex: 1;
                    overflow-y: auto;
                }

                .lhdn-details-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }

                .validation-errors-section .error-group {
                    border: 1px solid #fecaca;
                    border-radius: 8px;
                    background: #fef2f2;
                }

                .validation-errors-section .error-group-header {
                    padding: 12px 16px;
                    background: #fee2e2;
                    border-bottom: 1px solid #fecaca;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .validation-errors-section .error-list {
                    padding: 16px;
                }

                .validation-errors-section .error-item {
                    margin-bottom: 12px;
                    padding: 12px;
                    background: white;
                    border-radius: 6px;
                    border-left: 4px solid #dc2626;
                }

                .validation-errors-section .error-item:last-child {
                    margin-bottom: 0;
                }

                .validation-errors-section .error-field {
                    font-weight: 600;
                    color: #1f2937;
                    margin-bottom: 4px;
                }

                .validation-errors-section .error-message {
                    color: #4b5563;
                    margin-bottom: 8px;
                }

                .validation-errors-section .error-value {
                    font-size: 0.875rem;
                    color: #6b7280;
                    margin-bottom: 4px;
                }

                .validation-errors-section .error-value code {
                    background: #f3f4f6;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: monospace;
                }

                .validation-errors-section .error-code {
                    font-size: 0.75rem;
                    color: #9ca3af;
                }

                .detail-item {
                    margin-bottom: 12px;
                    padding: 8px 0;
                    border-bottom: 1px solid #f3f4f6;
                }

                .detail-item:last-child {
                    border-bottom: none;
                }

                .detail-item strong {
                    color: #374151;
                    display: inline-block;
                    min-width: 120px;
                }

                @media (max-width: 768px) {
                    .lhdn-details-content {
                        width: 95%;
                        max-height: 95vh;
                    }

                    .lhdn-details-header {
                        padding: 16px 20px;
                    }

                    .lhdn-details-body {
                        padding: 20px;
                    }
                }

            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    // Simple error modal for InvoiceTableManager
    showErrorModal(title, message) {
        // Remove any existing error modal
        const existingModal = document.getElementById('invoiceTableErrorModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modalHTML = `
            <div id="invoiceTableErrorModal" class="lhdn-details-modal">
                <div class="lhdn-details-overlay" onclick="this.parentElement.remove()"></div>
                <div class="lhdn-details-content" style="max-width: 500px;">
                    <div class="lhdn-details-header">
                        <div class="d-flex align-items-center">
                            <div class="header-icon-wrapper me-3">
                                <i class="bi bi-exclamation-triangle-fill"></i>
                            </div>
                            <div>
                                <h4 class="mb-1 fw-semibold">${title}</h4>
                                <p class="mb-0 small text-muted">Error Details</p>
                            </div>
                        </div>
                        <button class="btn-close-custom" onclick="this.closest('.lhdn-details-modal').remove()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                    <div class="lhdn-details-body">
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            ${message}
                        </div>
                    </div>
                    <div class="lhdn-details-footer">
                        <button type="button" class="om-btn-close" onclick="this.closest('.lhdn-details-modal').remove()">
                            <i class="bi bi-x-lg"></i>Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add styles if not already present
        this.addLHDNDetailsStyles();

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Show modal with animation
        setTimeout(() => {
            const modal = document.getElementById('invoiceTableErrorModal');
            if (modal) {
                modal.classList.add('show');
            }
        }, 10);
    }

    // Enhanced error modal with detailed information and suggestions
    showEnhancedErrorModal(title, message, details, suggestions = []) {
        // Remove any existing error modal
        const existingModal = document.getElementById('invoiceTableErrorModal');
        if (existingModal) {
            existingModal.remove();
        }

        const suggestionsHTML = suggestions.length > 0 ? `
            <div class="alert alert-info mt-3">
                <h6 class="alert-heading">
                    <i class="bi bi-lightbulb me-2"></i>
                    Suggested Actions
                </h6>
                <ul class="mb-0">
                    ${suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
                </ul>
            </div>
        ` : '';

        const modalHTML = `
            <div id="invoiceTableErrorModal" class="lhdn-details-modal">
                <div class="lhdn-details-overlay" onclick="this.parentElement.remove()"></div>
                <div class="lhdn-details-content" style="max-width: 600px;">
                    <div class="lhdn-details-header">
                        <div class="d-flex align-items-center">
                            <div class="header-icon-wrapper me-3" style="background: #dc3545;">
                                <i class="bi bi-exclamation-triangle-fill text-white"></i>
                            </div>
                            <div>
                                <h4 class="mb-1 fw-semibold text-danger">${title}</h4>
                                <p class="mb-0 small text-muted">Error Information</p>
                            </div>
                        </div>
                        <button class="btn-close-custom" onclick="this.closest('.lhdn-details-modal').remove()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                    <div class="lhdn-details-body">
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-circle me-2"></i>
                            <strong>${message}</strong>
                        </div>
                        ${details ? `
                            <div class="alert alert-warning">
                                <i class="bi bi-info-circle me-2"></i>
                                ${details}
                            </div>
                        ` : ''}
                        ${suggestionsHTML}
                    </div>
                    <div class="lhdn-details-footer">
                        <button class="btn btn-primary me-2" onclick="window.location.reload()">
                            <i class="bi bi-arrow-clockwise me-2"></i>Refresh Page
                        </button>
                        <button type="button" class="om-btn-close" onclick="this.closest('.lhdn-details-modal').remove()">
                            <i class="bi bi-x-lg"></i>Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add styles if not already present
        this.addLHDNDetailsStyles();

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Show modal with animation
        setTimeout(() => {
            const modal = document.getElementById('invoiceTableErrorModal');
            if (modal) {
                modal.classList.add('show');
            }
        }, 10);
    }


    // Internal clipboard helper with fallback (execCommand) for wider compatibility
    async copyTextWithFallback(text) {
        if (!text && text !== 0) throw new Error('No text to copy');
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(String(text));
                return;
            }
        } catch (e) {
            // Will try fallback below
        }
        // Fallback using a hidden textarea and execCommand
        const textarea = document.createElement('textarea');
        textarea.value = String(text);
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        let success = false;
        try {
            success = document.execCommand('copy');
        } catch (e) {
            success = false;
        }
        document.body.removeChild(textarea);
        if (!success) throw new Error('Clipboard API not available and execCommand failed');
    }

    // Copy invoice number with toast notification
    async copyInvoiceNumber(invoiceNumber, element, isEvenRow) {
        try {
            await this.copyTextWithFallback(invoiceNumber);

            // Visual feedback
            element.style.background = '#dcfce7';
            setTimeout(() => {
                element.style.background = isEvenRow ? '#f8fafc' : '#ffffff';
            }, 1000);

            // Show toast notification
            if (window.toastNotification) {
                window.toastNotification.copySuccess('Invoice Number', invoiceNumber);
            } else {
                console.log(`${invoiceNumber} copied to clipboard`);
            }
        } catch (error) {
            console.error('Failed to copy invoice number:', error);

            // Show error toast
            if (window.toastNotification) {
                window.toastNotification.error('Copy Failed', 'Unable to copy invoice number to clipboard');
            } else {
                console.error('Unable to copy invoice number to clipboard');
            }
        }
    }

    // Show supplier modal
    showSupplierModal(uniqueId) {
        console.log('Opening supplier modal for ID:', uniqueId);

        // Prefer detailed supplier objects stored with the row; fallback to names from tooltip
        const rowKey = (window.supplierRowMap && window.supplierRowMap[uniqueId]) ? window.supplierRowMap[uniqueId] : uniqueId;
        const detailed = window.outboundRowData?.[rowKey]?.supplierData;
        let rawSuppliers = Array.isArray(detailed) && detailed.length > 0
            ? detailed
            : (window.supplierModalData?.[uniqueId] || []);

        if (!Array.isArray(rawSuppliers) || rawSuppliers.length === 0) {
            console.error('Supplier data not found for ID:', uniqueId);
            return;
        }

        // Normalize to objects expected by renderer
        const normalizeSupplier = (s) => {
            if (!s) return null;
            if (typeof s === 'object') {
                const company = s.company || s.name || s.registrationName || '';
                let ident = s.identifications || {};
                if (Array.isArray(ident)) {
                    const ids = {};
                    ident.forEach(id => {
                        const scheme = (id.schemeId || '').toUpperCase();
                        if (scheme === 'TIN') ids.tin = id.id;
                        else if (scheme === 'BRN') ids.brn = id.id;
                        else if (scheme === 'SST') ids.sst = id.id;
                        else if (scheme === 'TTX') ids.ttx = id.id;
                    });
                    ident = ids;
                }
                const contact = s.contact || {};
                const addr = s.address && typeof s.address === 'object' ? s.address : {};
                return {
                    company,
                    identifications: ident,
                    email: s.email || contact.email || null,
                    phone: s.phone || contact.phone || null,
                    address: s.address?.line || s.address?.address || addr.line || null,
                    city: s.city || addr.city || null,
                    state: s.state || addr.state || null
                };
            }
            if (typeof s === 'string') {
                return { company: s, identifications: {}, email: null, phone: null, address: null, city: null, state: null };
            }
            return null;
        };

        const suppliers = rawSuppliers.map(normalizeSupplier).filter(Boolean);

        // Create modal HTML
        const modalId = 'supplierModal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal fade';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-labelledby', 'supplierModalLabel');
            modal.setAttribute('aria-hidden', 'true');
            document.body.appendChild(modal);
        }

        // Create supplier list with search and pagination
        const itemsPerPage = 20;
        const totalPages = Math.ceil(suppliers.length / itemsPerPage);

        const createSupplierList = (filteredSuppliers, currentPage = 1) => {
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pageSuppliers = filteredSuppliers.slice(startIndex, endIndex);

            return pageSuppliers.map((supplier, index) => `
                <div class="supplier-item" style="
                    padding: 12px;
                    margin: 4px 0;
                    background: ${(startIndex + index) % 2 === 0 ? '#f8fafc' : '#ffffff'};
                    border-radius: 8px;
                    border-left: 4px solid #10b981;
                    transition: all 0.2s ease;
                    cursor: pointer;
                "
                onmouseover="this.style.background='#ecfdf5'; this.style.transform='translateX(4px)'"
                onmouseout="this.style.background='${(startIndex + index) % 2 === 0 ? '#f8fafc' : '#ffffff'}'; this.style.transform='translateX(0)'"
                onclick="window.outboundManualExcel.copySupplierInfo('${supplier.company || 'N/A'}', this, ${(startIndex + index) % 2 === 0})">
                    <div class="d-flex align-items-start gap-3">
                        <span style="
                            background: #10b981;
                            color: white;
                            padding: 4px 8px;
                            border-radius: 6px;
                            font-size: 11px;
                            font-weight: 600;
                            min-width: 35px;
                            text-align: center;
                        ">${startIndex + index + 1}</span>
                        <div class="flex-grow-1">
                            <div class="fw-bold text-dark mb-1" style="font-size: 14px;">
                                <i class="bi bi-building me-2"></i>${supplier.company || 'N/A'}
                            </div>
                            <div class="row g-2 text-muted" style="font-size: 12px;">
                                <div class="col-md-6">
                                    <div><i class="bi bi-hash me-1"></i><strong>TIN:</strong> ${supplier.identifications?.tin || 'N/A'}</div>
                                    <div><i class="bi bi-card-text me-1"></i><strong>BRN:</strong> ${supplier.identifications?.brn || 'N/A'}</div>
                                </div>
                                <div class="col-md-6">
                                    <div><i class="bi bi-envelope me-1"></i><strong>Email:</strong> ${supplier.email || 'N/A'}</div>
                                    <div><i class="bi bi-telephone me-1"></i><strong>Phone:</strong> ${supplier.phone || 'N/A'}</div>
                                </div>
                            </div>
                            <div class="text-muted mt-1" style="font-size: 11px;">
                                <i class="bi bi-geo-alt me-1"></i>${supplier.address || 'N/A'}, ${supplier.city || 'N/A'}, ${supplier.state || 'N/A'}
                            </div>
                        </div>
                        <i class="bi bi-clipboard" style="color: #6b7280; font-size: 14px;" title="Click to copy company name"></i>
                    </div>
                </div>
            `).join('');
        };

        const createPagination = (totalPages, currentPage, filteredCount) => {
            if (totalPages <= 1) return '';

            let pagination = '<nav aria-label="Supplier pagination"><ul class="pagination pagination-sm justify-content-center mb-0">';

            // Previous button
            pagination += `
                <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateSupplierModal('${uniqueId}', ${currentPage - 1}); return false;">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                </li>
            `;

            // Page numbers (show max 5 pages)
            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, startPage + 4);

            for (let i = startPage; i <= endPage; i++) {
                pagination += `
                    <li class="page-item ${i === currentPage ? 'active' : ''}">
                        <a class="page-link" href="#" onclick="window.outboundManualExcel.updateSupplierModal('${uniqueId}', ${i}); return false;">
                            ${i}
                        </a>
                    </li>
                `;
            }

            // Next button
            pagination += `
                <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateSupplierModal('${uniqueId}', ${currentPage + 1}); return false;">
                        <i class="bi bi-chevron-right"></i>
                    </a>
                </li>
            `;

            pagination += '</ul></nav>';
            return pagination;
        };

        modal.innerHTML = `
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header text-white" style="background-color: #10b981;">
                        <h5 class="modal-title" id="supplierModalLabel">
                            <i class="bi bi-person-badge me-2"></i>
                            Suppliers (${suppliers.length} total)
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <div class="input-group">
                                <span class="input-group-text">
                                    <i class="bi bi-search"></i>
                                </span>
                                <input type="text" class="form-control" id="supplierSearch" placeholder="Search suppliers by company name, TIN, BRN, email..."
                                    oninput="window.outboundManualExcel.filterSuppliers('${uniqueId}')">
                            </div>
                            <small class="text-muted mt-1 d-block">
                                <i class="bi bi-info-circle me-1"></i>
                                Click any supplier to copy company name to clipboard
                            </small>
                        </div>
                         <div id="supplierListContainer" style="max-height: 400px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none;" class="hide-scrollbar">
                           ${createSupplierList(suppliers, 1)}
                        </div>

                        <div id="supplierPagination" class="mt-3">
                            ${createPagination(totalPages, 1, suppliers.length)}
                        </div>
                        <div class="mt-2 text-center">
                            <small id="supplierCountDisplay" class="text-muted">
                                Showing 1-${Math.min(itemsPerPage, suppliers.length)} of ${suppliers.length} suppliers
                            </small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-lhdn-cancel" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;

        // Store current state for filtering and pagination
        if (!window.supplierModalState) window.supplierModalState = {};
        window.supplierModalState[uniqueId] = {
            allSuppliers: suppliers,
            filteredSuppliers: suppliers,
            currentPage: 1,
            itemsPerPage: itemsPerPage
        };

        // Show modal
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    // Update supplier modal with pagination
    updateSupplierModal(uniqueId, page) {
        const state = window.supplierModalState?.[uniqueId];
        if (!state) return;

        const totalPages = Math.ceil(state.filteredSuppliers.length / state.itemsPerPage);
        if (page < 1 || page > totalPages) return;

        state.currentPage = page;

        const startIndex = (page - 1) * state.itemsPerPage;
        const endIndex = startIndex + state.itemsPerPage;
        const pageSuppliers = state.filteredSuppliers.slice(startIndex, endIndex);

        const supplierList = pageSuppliers.map((supplier, index) => `
            <div class="supplier-item" style="
                padding: 12px;
                margin: 4px 0;
                background: ${(startIndex + index) % 2 === 0 ? '#f8fafc' : '#ffffff'};
                border-radius: 8px;
                border-left: 4px solid #10b981;
                transition: all 0.2s ease;
                cursor: pointer;
            "
            onmouseover="this.style.background='#ecfdf5'; this.style.transform='translateX(4px)'"
            onmouseout="this.style.background='${(startIndex + index) % 2 === 0 ? '#f8fafc' : '#ffffff'}'; this.style.transform='translateX(0)'"
            onclick="window.outboundManualExcel.copySupplierInfo('${supplier.company || 'N/A'}', this, ${(startIndex + index) % 2 === 0})">
                <div class="d-flex align-items-start gap-3">
                    <span style="
                        background: #10b981;
                        color: white;
                        padding: 4px 8px;
                        border-radius: 6px;
                        font-size: 11px;
                        font-weight: 600;
                        min-width: 35px;
                        text-align: center;
                    ">${startIndex + index + 1}</span>
                    <div class="flex-grow-1">
                        <div class="fw-bold text-dark mb-1" style="font-size: 14px;">
                            <i class="bi bi-building me-2"></i>${supplier.company || 'N/A'}
                        </div>
                        <div class="row g-2 text-muted" style="font-size: 12px;">
                            <div class="col-md-6">
                                <div><i class="bi bi-hash me-1"></i><strong>TIN:</strong> ${supplier.identifications?.tin || 'N/A'}</div>
                                <div><i class="bi bi-card-text me-1"></i><strong>BRN:</strong> ${supplier.identifications?.brn || 'N/A'}</div>
                            </div>
                            <div class="col-md-6">
                                <div><i class="bi bi-envelope me-1"></i><strong>Email:</strong> ${supplier.email || 'N/A'}</div>
                                <div><i class="bi bi-telephone me-1"></i><strong>Phone:</strong> ${supplier.phone || 'N/A'}</div>
                            </div>
                        </div>
                        <div class="text-muted mt-1" style="font-size: 11px;">
                            <i class="bi bi-geo-alt me-1"></i>${supplier.address || 'N/A'}, ${supplier.city || 'N/A'}, ${supplier.state || 'N/A'}
                        </div>
                    </div>
                    <i class="bi bi-clipboard" style="color: #6b7280; font-size: 14px;" title="Click to copy company name"></i>
                </div>
            </div>
        `).join('');

        // Update the list container
        const listContainer = document.getElementById('supplierListContainer');
        if (listContainer) {
            listContainer.innerHTML = supplierList;
        }

        // Update pagination
        this.updateSupplierPagination(uniqueId, totalPages, page);

        // Update count display
        this.updateSupplierCount(startIndex, endIndex, state.filteredSuppliers.length);
    }

    // Filter suppliers based on search input
    filterSuppliers(uniqueId) {
        const state = window.supplierModalState?.[uniqueId];
        if (!state) return;

        const searchInput = document.getElementById('supplierSearch');
        const searchTerm = searchInput?.value.toLowerCase() || '';

        if (searchTerm === '') {
            state.filteredSuppliers = state.allSuppliers;
        } else {
            state.filteredSuppliers = state.allSuppliers.filter(supplier => {
                const company = (supplier.company || '').toLowerCase();
                const tin = (supplier.identifications?.tin || '').toLowerCase();
                const brn = (supplier.identifications?.brn || '').toLowerCase();
                const email = (supplier.email || '').toLowerCase();
                const phone = (supplier.phone || '').toLowerCase();
                const address = (supplier.address || '').toLowerCase();

                return company.includes(searchTerm) ||
                       tin.includes(searchTerm) ||
                       brn.includes(searchTerm) ||
                       email.includes(searchTerm) ||
                       phone.includes(searchTerm) ||
                       address.includes(searchTerm);
            });
        }

        // Reset to first page and update display
        state.currentPage = 1;
        this.updateSupplierModal(uniqueId, 1);
    }

    // Update supplier pagination display
    updateSupplierPagination(uniqueId, totalPages, currentPage) {
        const paginationContainer = document.getElementById('supplierPagination');
        if (!paginationContainer || totalPages <= 1) {
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        let pagination = '<nav aria-label="Supplier pagination"><ul class="pagination pagination-sm justify-content-center mb-0">';

        // Previous button
        pagination += `
            <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateSupplierModal('${uniqueId}', ${currentPage - 1}); return false;">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers (show max 5 pages)
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            pagination += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateSupplierModal('${uniqueId}', ${i}); return false;">
                        ${i}
                    </a>
                </li>
            `;
        }

        // Next button
        pagination += `
            <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateSupplierModal('${uniqueId}', ${currentPage + 1}); return false;">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        pagination += '</ul></nav>';
        paginationContainer.innerHTML = pagination;
    }

    // Update supplier count display
    updateSupplierCount(startIndex, endIndex, totalCount) {
        const showingStart = startIndex + 1;
        const showingEnd = Math.min(endIndex, totalCount);
        const countElement = document.getElementById('supplierCountDisplay');
        if (countElement) {
            countElement.innerHTML = `Showing ${showingStart}-${showingEnd} of ${totalCount} suppliers`;
        }
    }

    // Copy supplier information to clipboard (uses shared clipboard helper)
    copySupplierInfo(companyName, element, isEvenRow) {
        try {
            this.copyTextWithFallback(companyName).then(() => {
                console.log('Supplier company name copied:', companyName);

                // Visual feedback
                const originalBg = isEvenRow ? '#f8fafc' : '#ffffff';
                element.style.background = '#dcfce7';
                element.style.transform = 'scale(0.98)';

                setTimeout(() => {
                    element.style.background = originalBg;
                    element.style.transform = 'translateX(0)';
                }, 1000);

                // Show toast notification
                if (window.toastNotification) {
                    window.toastNotification.copySuccess('Supplier Company', companyName);
                } else {
                    console.log(`${companyName} copied to clipboard`);
                }
            });
        } catch (error) {
            console.error('Failed to copy supplier info:', error);

            // Show error toast
            if (window.toastNotification) {
                window.toastNotification.error('Copy Failed', 'Unable to copy supplier info to clipboard');
            } else {
                console.error('Unable to copy supplier info to clipboard');
            }
        }
    }

    // Show receiver modal
    showReceiverModal(uniqueId) {
        console.log('Opening receiver modal for ID:', uniqueId);

        // Prefer detailed receiver objects stored with the row; fallback to names from tooltip
        // Map tooltip-specific uniqueId back to the table rowId if needed
        let rowKey = uniqueId;
        if (!(window.outboundRowData && window.outboundRowData[rowKey]) && window.receiverRowMap && window.receiverRowMap[rowKey]) {
            rowKey = window.receiverRowMap[rowKey];
        }
        const detailed = window.outboundRowData?.[rowKey]?.receiverData;
        let rawReceivers = Array.isArray(detailed) && detailed.length > 0
            ? detailed
            : (window.receiverModalData?.[uniqueId] || []);

        if (!Array.isArray(rawReceivers) || rawReceivers.length === 0) {
            console.error('Receiver data not found for ID:', uniqueId);
            return;
        }

        // Normalize to objects expected by renderer
        const normalizeReceiver = (r) => {
            if (!r) return null;
            if (typeof r === 'object') {
                const company = r.company || r.name || r.registrationName || '';
                let ident = r.identifications || {};
                if (Array.isArray(ident)) {
                    const ids = {};
                    ident.forEach(id => {
                        const scheme = (id.schemeId || '').toUpperCase();
                        if (scheme === 'TIN') ids.tin = id.id;
                        else if (scheme === 'BRN') ids.brn = id.id;
                        else if (scheme === 'SST') ids.sst = id.id;
                        else if (scheme === 'TTX') ids.ttx = id.id;
                    });
                    ident = ids;
                }
                const contact = r.contact || {};
                const addr = r.address && typeof r.address === 'object' ? r.address : {};
                return {
                    company,
                    identifications: ident,
                    email: r.email || contact.email || null,
                    phone: r.phone || contact.phone || null,
                    address: r.address?.line || r.address?.address || addr.line || null,
                    city: r.city || addr.city || null,
                    state: r.state || addr.state || null
                };
            }
            if (typeof r === 'string') {
                return { company: r, identifications: {}, email: null, phone: null, address: null, city: null, state: null };
            }
            return null;
        };

        const receivers = rawReceivers.map(normalizeReceiver).filter(Boolean);

        // Create modal HTML
        const modalId = 'receiverModal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal fade';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-labelledby', 'receiverModalLabel');
            modal.setAttribute('aria-hidden', 'true');
            document.body.appendChild(modal);
        }

        // Create receiver list with search and pagination
        const itemsPerPage = 20;
        const totalPages = Math.ceil(receivers.length / itemsPerPage);

        const createReceiverList = (filteredReceivers, currentPage = 1) => {
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pageReceivers = filteredReceivers.slice(startIndex, endIndex);

            return pageReceivers.map((receiver, index) => `
                <div class="receiver-item" style="
                    padding: 12px;
                    margin: 4px 0;
                    background: ${(startIndex + index) % 2 === 0 ? '#fefdf8' : '#ffffff'};
                    border-radius: 8px;
                    border-left: 4px solid #f59e0b;
                    transition: all 0.2s ease;
                    cursor: pointer;
                "
                data-company="${encodeURIComponent(receiver.company || 'N/A')}"
                data-tin="${encodeURIComponent(receiver.identifications?.tin || 'N/A')}"
                data-brn="${encodeURIComponent(receiver.identifications?.brn || 'N/A')}"
                data-email="${encodeURIComponent(receiver.email || 'N/A')}"
                data-phone="${encodeURIComponent(receiver.phone || 'N/A')}"
                data-address="${encodeURIComponent(receiver.address || 'N/A')}"
                data-city="${encodeURIComponent(receiver.city || 'N/A')}"
                data-state="${encodeURIComponent(receiver.state || 'N/A')}"
                onmouseover="this.style.background='#fef3c7'; this.style.transform='translateX(4px)'"
                onmouseout="this.style.background='${(startIndex + index) % 2 === 0 ? '#fefdf8' : '#ffffff'}'; this.style.transform='translateX(0)'"
                onclick="window.outboundManualExcel.copyReceiverInfo(null, this, ${(startIndex + index) % 2 === 0})">
                    <div class="d-flex align-items-start gap-3">
                        <span style="
                            background: #f59e0b;
                            color: white;
                            padding: 4px 8px;
                            border-radius: 6px;
                            font-size: 11px;
                            font-weight: 600;
                            min-width: 35px;
                            text-align: center;
                        ">${startIndex + index + 1}</span>
                        <div class="flex-grow-1">
                            <div class="fw-bold text-dark mb-1" style="font-size: 14px;">
                                <i class="bi bi-building me-2"></i>${receiver.company || 'N/A'}
                            </div>
                            <div class="row g-2 text-muted" style="font-size: 12px;">
                                <div class="col-md-6">
                                    <div><i class="bi bi-hash me-1"></i><strong>TIN:</strong> ${receiver.identifications?.tin || 'N/A'}</div>
                                    <div><i class="bi bi-card-text me-1"></i><strong>BRN:</strong> ${receiver.identifications?.brn || 'N/A'}</div>
                                </div>
                                <div class="col-md-6">
                                    <div><i class="bi bi-envelope me-1"></i><strong>Email:</strong> ${receiver.email || 'N/A'}</div>
                                    <div><i class="bi bi-telephone me-1"></i><strong>Phone:</strong> ${receiver.phone || 'N/A'}</div>
                                </div>
                            </div>
                            <div class="text-muted mt-1" style="font-size: 11px;">
                                <i class="bi bi-geo-alt me-1"></i>${receiver.address || 'N/A'}, ${receiver.city || 'N/A'}, ${receiver.state || 'N/A'}
                            </div>
                        </div>
                        <i class="bi bi-clipboard" style="color: #6b7280; font-size: 14px;" title="Click to copy receiver info"></i>
                    </div>
                </div>
            `).join('');
        };

        const createPagination = (totalPages, currentPage, filteredCount) => {
            if (totalPages <= 1) return '';

            let pagination = '<nav aria-label="Receiver pagination"><ul class="pagination pagination-sm justify-content-center mb-0">';

            // Previous button
            pagination += `
                <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateReceiverModal('${uniqueId}', ${currentPage - 1}); return false;">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                </li>
            `;

            // Page numbers (show max 5 pages)
            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, startPage + 4);

            for (let i = startPage; i <= endPage; i++) {
                pagination += `
                    <li class="page-item ${i === currentPage ? 'active' : ''}">
                        <a class="page-link" href="#" onclick="window.outboundManualExcel.updateReceiverModal('${uniqueId}', ${i}); return false;">
                            ${i}
                        </a>
                    </li>
                `;
            }

            // Next button
            pagination += `
                <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateReceiverModal('${uniqueId}', ${currentPage + 1}); return false;">
                        <i class="bi bi-chevron-right"></i>
                    </a>
                </li>
            `;

            pagination += '</ul></nav>';
            return pagination;
        };

        modal.innerHTML = `
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header text-white" style="background-color: #f59e0b;">
                        <h5 class="modal-title" id="receiverModalLabel">
                            <i class="bi bi-person-check me-2"></i>
                            Receivers (${receivers.length} total)
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <div class="input-group">
                                <span class="input-group-text">
                                    <i class="bi bi-search"></i>
                                </span>
                                <input type="text" class="form-control" id="receiverSearch" placeholder="Search receivers by company name, TIN, BRN, email..."
                                    oninput="window.outboundManualExcel.filterReceivers('${uniqueId}')">
                            </div>
                            <small class="text-muted mt-1 d-block">
                                <i class="bi bi-info-circle me-1"></i>
                                Click any receiver to copy receiver info to clipboard
                            </small>
                        </div>
                        <div id="receiverListContainer" style="max-height: 500px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none;" class="hide-scrollbar">
                            ${createReceiverList(receivers, 1)}
                        </div>
                        <div id="receiverPagination" class="mt-3">
                            ${createPagination(totalPages, 1, receivers.length)}
                        </div>
                        <div class="mt-2 text-center">
                            <small id="receiverCountDisplay" class="text-muted">
                                Showing 1-${Math.min(itemsPerPage, receivers.length)} of ${receivers.length} receivers
                            </small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-lhdn-cancel" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;

        // Store current state for filtering and pagination
        if (!window.receiverModalState) window.receiverModalState = {};
        window.receiverModalState[uniqueId] = {
            allReceivers: receivers,
            filteredReceivers: receivers,
            currentPage: 1,
            itemsPerPage: itemsPerPage
        };

        // Show modal
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    // Update receiver modal with pagination
    updateReceiverModal(uniqueId, page) {
        const state = window.receiverModalState?.[uniqueId];
        if (!state) return;

        const totalPages = Math.ceil(state.filteredReceivers.length / state.itemsPerPage);
        if (page < 1 || page > totalPages) return;

        state.currentPage = page;

        const startIndex = (page - 1) * state.itemsPerPage;
        const endIndex = startIndex + state.itemsPerPage;
        const pageReceivers = state.filteredReceivers.slice(startIndex, endIndex);

        const receiverList = pageReceivers.map((receiver, index) => `
            <div class="receiver-item" style="
                padding: 12px;
                margin: 4px 0;
                background: ${(startIndex + index) % 2 === 0 ? '#fefdf8' : '#ffffff'};
                border-radius: 8px;
                border-left: 4px solid #f59e0b;
                transition: all 0.2s ease;
                cursor: pointer;
            "
            onmouseover="this.style.background='#fef3c7'; this.style.transform='translateX(4px)'"
            onmouseout="this.style.background='${(startIndex + index) % 2 === 0 ? '#fefdf8' : '#ffffff'}'; this.style.transform='translateX(0)'"
            data-company="${encodeURIComponent(receiver.company || 'N/A')}"
            data-tin="${encodeURIComponent(receiver.identifications?.tin || 'N/A')}"
            data-brn="${encodeURIComponent(receiver.identifications?.brn || 'N/A')}"
            data-email="${encodeURIComponent(receiver.email || 'N/A')}"
            data-phone="${encodeURIComponent(receiver.phone || 'N/A')}"
            data-address="${encodeURIComponent(receiver.address || 'N/A')}"
            data-city="${encodeURIComponent(receiver.city || 'N/A')}"
            data-state="${encodeURIComponent(receiver.state || 'N/A')}"
            onclick="window.outboundManualExcel.copyReceiverInfo(null, this, ${(startIndex + index) % 2 === 0})">
                <div class="d-flex align-items-start gap-3">
                    <span style="
                        background: #f59e0b;
                        color: white;
                        padding: 4px 8px;
                        border-radius: 6px;
                        font-size: 11px;
                        font-weight: 600;
                        min-width: 35px;
                        text-align: center;
                    ">${startIndex + index + 1}</span>
                    <div class="flex-grow-1">
                        <div class="fw-bold text-dark mb-1" style="font-size: 14px;">
                            <i class="bi bi-building me-2"></i>${receiver.company || 'N/A'}
                        </div>
                        <div class="row g-2 text-muted" style="font-size: 12px;">
                            <div class="col-md-6">
                                <div><i class="bi bi-hash me-1"></i><strong>TIN:</strong> ${receiver.identifications?.tin || 'N/A'}</div>
                                <div><i class="bi bi-card-text me-1"></i><strong>BRN:</strong> ${receiver.identifications?.brn || 'N/A'}</div>
                            </div>
                            <div class="col-md-6">
                                <div><i class="bi bi-envelope me-1"></i><strong>Email:</strong> ${receiver.email || 'N/A'}</div>
                                <div><i class="bi bi-telephone me-1"></i><strong>Phone:</strong> ${receiver.phone || 'N/A'}</div>
                            </div>
                        </div>
                        <div class="text-muted mt-1" style="font-size: 11px;">
                            <i class="bi bi-geo-alt me-1"></i>${receiver.address || 'N/A'}, ${receiver.city || 'N/A'}, ${receiver.state || 'N/A'}
                        </div>
                    </div>
                    <i class="bi bi-clipboard" style="color: #6b7280; font-size: 14px;" title="Click to copy company name"></i>
                </div>
            </div>
        `).join('');

        // Update the list container
        const listContainer = document.getElementById('receiverListContainer');
        if (listContainer) {
            listContainer.innerHTML = receiverList;
        }

        // Update pagination
        this.updateReceiverPagination(uniqueId, totalPages, page);

        // Update count display
        this.updateReceiverCount(startIndex, endIndex, state.filteredReceivers.length);
    }

    // Filter receivers based on search input
    filterReceivers(uniqueId) {
        const state = window.receiverModalState?.[uniqueId];
        if (!state) return;

        const searchInput = document.getElementById('receiverSearch');
        const searchTerm = searchInput?.value.toLowerCase() || '';

        if (searchTerm === '') {
            state.filteredReceivers = state.allReceivers;
        } else {
            state.filteredReceivers = state.allReceivers.filter(receiver => {
                const company = (receiver.company || '').toLowerCase();
                const tin = (receiver.identifications?.tin || '').toLowerCase();
                const brn = (receiver.identifications?.brn || '').toLowerCase();
                const email = (receiver.email || '').toLowerCase();
                const phone = (receiver.phone || '').toLowerCase();
                const address = (receiver.address || '').toLowerCase();

                return company.includes(searchTerm) ||
                       tin.includes(searchTerm) ||
                       brn.includes(searchTerm) ||
                       email.includes(searchTerm) ||
                       phone.includes(searchTerm) ||
                       address.includes(searchTerm);
            });
        }

        // Reset to first page and update display
        state.currentPage = 1;
        this.updateReceiverModal(uniqueId, 1);
    }

    // Update receiver pagination display
    updateReceiverPagination(uniqueId, totalPages, currentPage) {
        const paginationContainer = document.getElementById('receiverPagination');
        if (!paginationContainer || totalPages <= 1) {
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        let pagination = '<nav aria-label="Receiver pagination"><ul class="pagination pagination-sm justify-content-center mb-0">';

        // Previous button
        pagination += `
            <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateReceiverModal('${uniqueId}', ${currentPage - 1}); return false;">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers (show max 5 pages)
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            pagination += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="window.outboundManualExcel.updateReceiverModal('${uniqueId}', ${i}); return false;">
                        ${i}
                    </a>
                </li>
            `;
        }

        // Next button
        pagination += `
            <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="window.outboundManualExcel.updateReceiverModal('${uniqueId}', ${currentPage + 1}); return false;">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        pagination += '</ul></nav>';
        paginationContainer.innerHTML = pagination;
    }

    // Update receiver count display
    updateReceiverCount(startIndex, endIndex, totalCount) {
        const showingStart = startIndex + 1;
        const showingEnd = Math.min(endIndex, totalCount);
        const countElement = document.getElementById('receiverCountDisplay');
        if (countElement) {
            countElement.innerHTML = `Showing ${showingStart}-${showingEnd} of ${totalCount} receivers`;
        }
    }

    // Copy receiver information to clipboard (async, matches invoice copy pattern)
    async copyReceiverInfo(_unused, element, isEvenRow) {
        try {
            // Build a well-formatted, multi-line receiver text from DOM/dataset
            const ds = element?.dataset || {};
            const decode = (v) => (typeof v === 'string' ? decodeURIComponent(v) : v);
            const company = (decode(ds.company) || element.querySelector('.fw-bold')?.textContent || 'N/A').trim();

            const infoRows = [];
            const rowEl = element.querySelector('.row.g-2');
            if (rowEl) {
                rowEl.querySelectorAll('div').forEach(div => {
                    const t = (div.textContent || '').trim();
                    if (t && /TIN:|BRN:|Email:|Phone:/i.test(t)) infoRows.push(t);
                });
            } else {
                // Fallback to dataset values when structure is different
                const tin = decode(ds.tin);
                const brn = decode(ds.brn);
                const email = decode(ds.email);
                const phone = decode(ds.phone);
                if (tin && tin !== 'N/A') infoRows.push(`TIN: ${tin}`);
                if (brn && brn !== 'N/A') infoRows.push(`BRN: ${brn}`);
                if (email && email !== 'N/A') infoRows.push(`Email: ${email}`);
                if (phone && phone !== 'N/A') infoRows.push(`Phone: ${phone}`);
            }

            const addrEl = element.querySelector('.text-muted.mt-1');
            let addressLine = (addrEl?.textContent || '').trim();
            if (!addressLine && (ds.address || ds.city || ds.state)) {
                const addrParts = [decode(ds.address), decode(ds.city), decode(ds.state)].filter(Boolean).join(', ');
                if (addrParts) addressLine = addrParts;
            }

            const lines = [
                `Receiver: ${company}`,
                ...infoRows,
                addressLine ? `Address: ${addressLine}` : null
            ].filter(Boolean);

            const textToCopy = lines.join('\n');

            await this.copyTextWithFallback(textToCopy);

            // Visual feedback
            const originalBg = isEvenRow ? '#fefdf8' : '#ffffff';
            element.style.background = '#fef3c7';
            element.style.transform = 'scale(0.98)';
            setTimeout(() => {
                element.style.background = originalBg;
                element.style.transform = 'translateX(0)';
            }, 1000);

            // Show toast notification (uses global ToastManager pattern)
            if (window.toastNotification) {
                window.toastNotification.copySuccess('Receiver Info', company);
            } else {
                console.log('Receiver info copied to clipboard:', textToCopy);
            }
        } catch (error) {
            console.error('Failed to copy receiver info:', error);
            if (window.toastNotification) {
                window.toastNotification.error('Copy Failed', 'Unable to copy receiver info to clipboard');
            }
        }
    }

    // Helper method to get row data by ID
    getRowDataById(uniqueId) {
        // Check if we have stored row data
        if (window.outboundRowData && window.outboundRowData[uniqueId]) {
            return window.outboundRowData[uniqueId];
        }

        // If not found in stored data, try to get from DataTable
        if (this.dataTable) {
            const rows = this.dataTable.rows().data();
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.DT_RowId === uniqueId || row.id === uniqueId) {
                    return row;
                }
            }
        }

        return null;
    }

    // Helper method to store row data with supplier/receiver details
    storeRowData(uniqueId, rowData, supplierData = null, receiverData = null) {
        if (!window.outboundRowData) {
            window.outboundRowData = {};
        }

        window.outboundRowData[uniqueId] = {
            ...rowData,
            supplierData: supplierData,
            receiverData: receiverData
        };
    }

    // Helper method to extract supplier data from documents
    extractSupplierData(documents) {
        if (!documents || !Array.isArray(documents)) return [];

        const suppliers = [];
        const seenSuppliers = new Set();

        documents.forEach(doc => {
            if (doc.supplier) {
                const supplierKey = `${doc.supplier.company}_${doc.supplier.identifications?.tin}`;
                if (!seenSuppliers.has(supplierKey)) {
                    seenSuppliers.add(supplierKey);
                    suppliers.push(doc.supplier);
                }
            }
        });

        return suppliers;
    }

    // Helper method to extract receiver data from documents
    extractReceiverData(documents) {
        if (!documents || !Array.isArray(documents)) return [];

        const receivers = [];
        const seenReceivers = new Set();

        documents.forEach(doc => {
            if (doc.buyer) {
                const receiverKey = `${doc.buyer.company}_${doc.buyer.identifications?.tin}`;
                if (!seenReceivers.has(receiverKey)) {
                    seenReceivers.add(receiverKey);
                    receivers.push(doc.buyer);
                }
            }
        });

        return receivers;
    }
}

// Reusable custom confirm modal (no SweetAlert)
function showCustomConfirmModal({ title = 'Confirm', message = '', confirmText = 'OK', cancelText = 'Cancel', icon = 'warning' } = {}) {
    return new Promise((resolve) => {
        // Create overlay (disable click-outside-to-close for submission flow)
        const overlay = document.createElement('div');
        overlay.className = 'custom-confirm-overlay';
        overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index: 11000;`;

        // Prevent click-outside-to-close for submission flow modals
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                e.preventDefault();
                e.stopPropagation();
                // Optional: add visual feedback that clicking outside is disabled
                const modal = overlay.querySelector('.custom-confirm-modal');
                if (modal) {
                    modal.style.animation = 'shake 0.3s ease-in-out';
                    setTimeout(() => modal.style.animation = '', 300);
                }
            }
        });

        // Modal container
        const modal = document.createElement('div');
        modal.className = 'custom-confirm-modal';
        modal.style.cssText = `background:#fff; width: 520px; max-width: 90%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.2); overflow:hidden;`;

        // Header/icon
        const iconWrap = document.createElement('div');
        iconWrap.style.cssText = 'display:flex; align-items:center; justify-content:center; padding: 18px 16px 0;';
        const iconEl = document.createElement('div');
        iconEl.style.cssText = 'width:72px;height:72px;border-radius:50%; border:3px solid #f59e0b; color:#f59e0b; display:flex; align-items:center; justify-content:center; font-size:36px;';
        iconEl.innerHTML = icon === 'warning' ? '!' : '?';
        iconWrap.appendChild(iconEl);

        // Body
        const body = document.createElement('div');
        body.style.cssText = 'padding: 12px 24px 8px; text-align:center;';
        body.innerHTML = `<h5 style="margin:8px 0 6px; font-weight:700;">${title}</h5><p style="margin:0; color:#4b5563;">${message}</p>`;

        // Footer buttons
        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex; gap:12px; justify-content:center; padding: 16px 24px 22px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-lhdn-cancel';
        cancelBtn.textContent = cancelText;
        cancelBtn.style.cssText = 'min-width:110px; border:1px solid #dc3545; color:#dc3545; background:#fff; border-radius:8px; padding:8px 14px; font-weight:600;';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-lhdn-primary';
        confirmBtn.textContent = confirmText;
        confirmBtn.style.cssText = 'min-width:110px; background:#198754; color:#fff; border:none; border-radius:8px; padding:8px 14px; font-weight:600;';

        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);

        // Assemble
        modal.appendChild(iconWrap);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Handlers
        const cleanup = (result) => { document.body.removeChild(overlay); resolve(result); };
        cancelBtn.addEventListener('click', () => cleanup(false));
        confirmBtn.addEventListener('click', () => cleanup(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
        document.addEventListener('keydown', function escHandler(ev) { if (ev.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(false); } });
    });
}

// Custom result modal with expandable details
function showCustomResultModal({ title = 'Result', summary = '', details = '', type = 'info', primaryText = 'OK' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10990;';
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;width:680px;max-width:95%;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);overflow:hidden;';
        const color = type==='error' ? '#dc3545' : type==='success' ? '#198754' : '#1a365d';
        const iconChar = type==='error' ? '×' : type==='success' ? '✓' : 'i';
        modal.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;padding:18px 16px 0;">
                <div style="width:72px;height:72px;border-radius:50%;border:3px solid ${color};color:${color};display:flex;align-items:center;justify-content:center;font-size:36px;">${iconChar}</div>
            </div>
            <div style="padding:12px 24px 0;text-align:center;">
                <h5 style="margin:8px 0 6px;font-weight:700;">${title}</h5>
                <pre style="margin:8px 0 0;color:#4b5563;white-space:pre-wrap;text-align:left;background:#f8fafc;padding:12px;border-radius:8px;max-height:220px;overflow:auto;">${summary}</pre>
            </div>
            ${details ? `
                <div style="padding:0 24px;">
                    <button id="toggleDetailsBtn" class="btn btn-sm" style="margin-top:8px;background:#e5e7eb;color:#111827;border:none;border-radius:8px;padding:6px 10px;font-weight:600;">View details</button>
                    <pre id="detailsBlock" style="display:none;margin:8px 0 0;color:#374151;white-space:pre-wrap;text-align:left;background:#f3f4f6;padding:12px;border-radius:8px;max-height:320px;overflow:auto;font-size:12px;"></pre>
                </div>
            ` : ''}
            <div style="display:flex;gap:12px;justify-content:center;padding:16px 24px 22px;">
                <button id="okBtn" class="btn" style="min-width:110px;background:${color};color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:600;">${primaryText}</button>
            </div>`;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        modal.querySelector('#okBtn').addEventListener('click', () => { document.body.removeChild(overlay); resolve(); });
        if (details) {
            const btn = modal.querySelector('#toggleDetailsBtn');
            const block = modal.querySelector('#detailsBlock');
            if (btn && block) {
                btn.addEventListener('click', () => {
                    const isOpen = block.style.display === 'block';
                    block.style.display = isOpen ? 'none' : 'block';
                    btn.textContent = isOpen ? 'View details' : 'Hide details';
                    block.textContent = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
                });
            }
        }
    });
}


// Simple info modal (no SweetAlert)
function showCustomInfoModal({ title = 'Info', message = '', type = 'success', buttonText = 'Close' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10990;';
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;width:520px;max-width:90%;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);overflow:hidden;';
        const color = type === 'error' ? '#dc3545' : type === 'warning' ? '#f59e0b' : '#198754';
        const iconChar = type === 'error' ? '×' : type === 'warning' ? '!' : '✓';
        modal.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;padding:18px 16px 0;">
                <div style="width:72px;height:72px;border-radius:50%;border:3px solid ${color};color:${color};display:flex;align-items:center;justify-content:center;font-size:36px;">${iconChar}</div>
            </div>
            <div style="padding:12px 24px 8px;text-align:center;">
                <h5 style="margin:8px 0 6px;font-weight:700;">${title}</h5>
                <p style="margin:0;color:#4b5563;">${message}</p>
            </div>
            <div style="display:flex;gap:12px;justify-content:center;padding:16px 24px 22px;">
                <button class="btn" style="min-width:110px;background:${color};color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:600;">${buttonText}</button>
            </div>`;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { document.body.removeChild(overlay); resolve(); } });
        modal.querySelector('button').addEventListener('click', () => { document.body.removeChild(overlay); resolve(); });
    });
}



// Global utility functions
function submitToLHDN(fileName) {
    console.log('Submit to LHDN:', fileName);
    Swal.fire({
        title: 'Submit to LHDN',
        text: `Are you sure you want to submit ${fileName} to LHDN?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#198754',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, Submit',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            // Implement actual submission logic here
            Swal.fire('Submitted!', 'Document has been submitted to LHDN.', 'success');
        }
    });
}

function deleteDocument(fileName) {
    console.log('Delete document:', fileName);
    showCustomConfirmModal({
        title: 'Delete File',
        message: `Are you sure you want to delete ${fileName}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        icon: 'warning',
    }).then((confirmed) => {
        if (!confirmed) return;
        // TODO: hook actual deletion here
        if (window.toastNotification?.success) {
            window.toastNotification.success('Deleted', 'Document has been deleted.', 3000);
        } else {
            console.log('Document deleted');
        }
    });
}

// Uploaded Files Manager for handling actions
class UploadedFilesManager {
    constructor() {
        this.selectedFiles = new Set();
        this.initializeBulkActions();
    }

    initializeBulkActions() {
        // Initialize select all checkbox
        const selectAllCheckbox = document.getElementById('selectAll');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                this.handleSelectAll(e.target.checked);
            });
        }

        // Initialize bulk delete button
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.addEventListener('click', () => {
                this.handleBulkDelete();
            });
        }

        // Initialize bulk submit button
        const bulkSubmitBtn = document.getElementById('bulkSubmitBtn');
        if (bulkSubmitBtn) {
            bulkSubmitBtn.addEventListener('click', () => {
                this.handleBulkSubmit();
            });
        }
    }

    handleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.outbound-checkbox:not(#selectAll):not([disabled])');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            const row = checkbox.closest('tr');
            if (row && row.id) {
                if (checked) {
                    this.selectedFiles.add(row.id.replace('file_', ''));
                } else {
                    this.selectedFiles.delete(row.id.replace('file_', ''));
                }
            }
        });
        this.updateBulkActionButtons();
    }

    handleRowSelection(checkbox, fileId) {
        if (checkbox.checked) {
            this.selectedFiles.add(fileId);
        } else {
            this.selectedFiles.delete(fileId);
        }
        this.updateBulkActionButtons();
        this.updateSelectAllState();
    }

    updateSelectAllState() {
        const selectAllCheckbox = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.outbound-checkbox:not(#selectAll):not([disabled])');
        const checkedBoxes = document.querySelectorAll('.outbound-checkbox:not(#selectAll):not([disabled]):checked');

        if (selectAllCheckbox) {
            selectAllCheckbox.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
            selectAllCheckbox.checked = checkedBoxes.length === checkboxes.length && checkboxes.length > 0;
        }
    }

    updateBulkActionButtons() {
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        const bulkSubmitBtn = document.getElementById('bulkSubmitBtn');

        const hasSelection = this.selectedFiles.size > 0;

        if (bulkDeleteBtn) {
            bulkDeleteBtn.disabled = !hasSelection;
            bulkDeleteBtn.title = hasSelection ?
                `Delete ${this.selectedFiles.size} selected file(s)` :
                'Select files to delete';
        }

        if (bulkSubmitBtn) {
            bulkSubmitBtn.disabled = !hasSelection;
            bulkSubmitBtn.title = hasSelection ?
                `Submit ${this.selectedFiles.size} selected file(s) to LHDN` :
                'Select files to submit';
        }
    }

    viewFile(fileId) {
        console.log('View file:', fileId);
        // TODO: Implement file viewing functionality
        Swal.fire({
            title: 'View File',
            text: `Viewing file with ID: ${fileId}`,
            icon: 'info'
        });
    }

    async submitFile(fileId) {
        try {
            const confirmed = await showCustomConfirmModal({
                title: 'Submit to LHDN',
                message: 'Are you sure you want to submit this file to LHDN?',
                confirmText: 'Submit',
                cancelText: 'Cancel',
                icon: 'info'
            });
            if (!confirmed) return;

            // Kick off the new animated submission flow and delegate to SubmissionClient
            showSubmissionFlowModal('Validating documents...');

            // Hook to pause before submit (used by SubmissionClient)
            window.SubmissionFlowHooks = {
                async confirmBeforeSubmit(){
                    const ok = await showCustomConfirmModal({
                        title: 'Ready to submit',
                        message: 'Processing and duplicate checks are done. Submit to LHDN now?',
                        confirmText: 'Submit Now',
                        cancelText: 'Cancel',
                        icon: 'info'
                    });
                    return !!ok;
                }
            };

            const result = await window.SubmissionClient.submitSingleFile(String(fileId), {
                onStage: ({ stage, message, progress, eta, error }) => {
                    updateSubmissionFlow({ stage, message, progress, eta, error });
                }
            });

            // Success UX
            if (result?.success) {
                closeSubmissionFlowModal();
                const accepted = result?.acceptedDocuments?.length || 0;
                const rejected = result?.rejectedDocuments?.length || 0;
                await showSubmissionSuccessModal({
                    userMessage: 'Your submission has been successfully sent to LHDN for processing.',
                    // fieldDescription: `${accepted} document${accepted===1?'':'s'} accepted for processing${rejected?`, ${rejected} rejected for review`:''}`,
                    fieldDescription: `Check Inbound Page for your latest status result from LHDN Validation. ${rejected?`, ${rejected} rejected for review`:''}`,
                    guidance: [
                        'Check your Submission History in 5-10 minutes for processing results.',
                        'LHDN typically processes submissions within a few minutes during business hours.',
                        'You can track status updates in Inbound Page.',
                        'Your .xlsx file is kept on disk — use the Submitted filter to review it.'
                    ]
                });
                notifyInboundModule({
                    fileId: String(fileId),
                    submissionUid: result?.submissionUid || result?.submission_uid,
                    source: 'outbound-manual'
                });
                if (window.toastNotification?.info) {
                    window.toastNotification.info(
                        'File kept',
                        'Use the Submitted filter to review your uploaded file.',
                        5000
                    );
                }
                if (typeof refreshOutboundTable === 'function') refreshOutboundTable();
                return;
            }

            // Fallback: treat as error
            updateSubmissionFlow({ stage: 'response', message: 'Submission failed.', progress: 100, error: result?.error || { userMessage: 'Submission failed' } });
        } catch (error) {
            console.error('Submit file error:', error);
            const tech = error?.payload?.lhdnResponse?.error || error?.payload || { userMessage: error?.message || 'Unexpected error' };
            updateSubmissionFlow({ stage: 'response', message: 'A network or server error occurred.', progress: 100, error: tech, onRetry: () => { try { closeSubmissionFlowModal(); this.submitFile(fileId); } catch(_) {} } });
        }
    }

    async handleBulkSubmit() {
        if (this.selectedFiles.size === 0) {
            await showCustomInfoModal({ title: 'No Selection', message: 'Please select files to submit.', type: 'warning', buttonText: 'Close' });
            return;
        }

        const confirmed = await showCustomConfirmModal({
            title: 'Submit Selected Files',
            message: `Submit ${this.selectedFiles.size} selected file(s) to LHDN?`,
            confirmText: `Submit ${this.selectedFiles.size} file(s)`,
            cancelText: 'Cancel',
            icon: 'info'
        });
        if (!confirmed) return;

        showSubmissionFlowModal('Validating selected files...');
        const fileIds = Array.from(this.selectedFiles);
        try {
            const data = await window.SubmissionClient.bulkSubmitFiles(fileIds, {
                onStage: ({ stage, message, progress, eta, error }) => updateSubmissionFlow({ stage, message, progress, eta, error })
            });

            updateSubmissionFlow({ stage: 'response', message: 'Bulk submission started. Finalizing...', progress: 90 });
            closeSubmissionFlowModal();

            await showSubmissionSuccessModal({
                userMessage: 'Your submission has been successfully sent to LHDN for processing.',
                fieldDescription: `Check Inbound Page for your latest status result from LHDN Validation.`,
                guidance: [
                    'Check your Submission History in 5-10 minutes for processing results.',
                    'LHDN typically processes submissions within a few minutes during business hours.',
                    'You can track status updates in Outbound > Submission History.',
                    'Your .xlsx files are kept on disk — use the Submitted filter to review them.'
                ]
            });

            notifyInboundModule({
                fileIds,
                source: 'outbound-manual-bulk'
            });
            if (window.toastNotification?.info) {
                window.toastNotification.info(
                    'Files kept',
                    'Use the Submitted filter to review submitted uploads.',
                    5000
                );
            }

            this.selectedFiles.clear();
            this.updateBulkActionButtons();
            if (typeof refreshOutboundTable === 'function') refreshOutboundTable();
        } catch (error) {
            console.error('Bulk submit error:', error);

            // Enhanced error handling for validation failures
            if (error?.payload?.validationFailed) {
                this.showValidationErrorModal(error.payload);
            } else {
                const tech = error?.payload || { userMessage: error?.message || 'Unexpected error' };
                updateSubmissionFlow({ stage: 'submit', message: 'A network or server error occurred during bulk submit.', progress: 100, error: tech, onRetry: () => { try { closeSubmissionFlowModal(); this.handleBulkSubmit(); } catch(_) {} } });
            }
        }
    }


    async deleteFile(fileId) {
        console.log('Delete file:', fileId);

        const confirmed = await showCustomConfirmModal({
            title: 'Delete File',
            message: 'Are you sure you want to delete this file? This action cannot be undone.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            icon: 'warning'
        });

        if (confirmed) {
            try {
                const response = await fetch(`/api/outbound-files-manual/uploaded-files/${fileId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'same-origin',
                });

                const data = await response.json();

                if (data.success) {
                    if (window.toastNotification?.success) {
                        window.toastNotification.success('Deleted', 'File has been deleted successfully.', 3000);
                    } else {
                        Swal.fire('Deleted!', 'File has been deleted successfully.', 'success');
                    }
                    // Refresh the table and update counts
                    if (typeof refreshOutboundTable === 'function') refreshOutboundTable();
                } else {
                    throw new Error(data.error || 'Failed to delete file');
                }
            } catch (error) {
                console.error('Error deleting file:', error);
                if (window.toastNotification?.error) {
                    window.toastNotification.error('Delete Failed', error.message, 7000);
                } else {
                    Swal.fire('Error!', `Failed to delete file: ${error.message}`, 'error');
                }
            }
        }
    }

    async handleBulkDelete() {
        if (this.selectedFiles.size === 0) {
            showCustomInfoModal({ title: 'No Selection', message: 'Please select files to delete.', type: 'warning', buttonText: 'Close' });
            return;
        }

        const confirmed = await showCustomConfirmModal({
            title: 'Delete Selected Files',
            message: `Are you sure you want to delete ${this.selectedFiles.size} selected file(s)? This action cannot be undone.`,
            confirmText: `Delete ${this.selectedFiles.size} file(s)` ,
            cancelText: 'Cancel',
            icon: 'warning'
        });

        if (confirmed) {
            await this.performBulkDelete();
        }
    }

    async performBulkDelete() {
        const fileIds = Array.from(this.selectedFiles);

        // Show progress
        try {
            const response = await fetch('/api/outbound-files-manual/uploaded-files/bulk', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify({ fileIds })
            });

            const data = await response.json();

            // Clear selection
            this.selectedFiles.clear();
            this.updateBulkActionButtons();

            // Refresh table and show results
            if (typeof refreshOutboundTable === 'function') refreshOutboundTable();

            if (data.success) {
                const { summary, failedFiles } = data;

                if (summary.failed === 0) {
                    if (window.toastNotification?.success) {
                        window.toastNotification.success('Deleted', `Successfully deleted ${summary.deleted} file(s).`, 4000);
                    } else {
                        Swal.fire('Success!', `Successfully deleted ${summary.deleted} file(s).`, 'success');
                    }
                } else if (summary.deleted === 0) {
                    const errorMessages = failedFiles.map(f => `${f.filename}: ${f.error}`).join('\n');
                    if (window.toastNotification?.error) {
                        window.toastNotification.error('Bulk Delete Failed', errorMessages, 7000);
                    } else {
                        Swal.fire('Error!', `Failed to delete all files:\n${errorMessages}`, 'error');
                    }
                } else {
                    const errorMessages = failedFiles.map(f => `${f.filename}: ${f.error}`).join('\n');
                    if (window.toastNotification?.error) {
                        window.toastNotification.error('Partial Delete', `Deleted ${summary.deleted}. Failed ${summary.failed}:\n${errorMessages}`, 7000);
                    } else {
                        Swal.fire('Partial Success',
                            `Successfully deleted ${summary.deleted} file(s).\n${summary.failed} file(s) failed:\n${errorMessages}`,
                            'warning');
                    }
                }
            } else {
                throw new Error(data.error || 'Bulk delete failed');
            }
        } catch (error) {
            console.error('Error in bulk delete:', error);

            // Clear selection and refresh on error too
            this.selectedFiles.clear();

    // Ensure Upload modal is centered and header is dark blue
    try {
        const uploadModalEl = document.getElementById('flatFileUploadModal');
        if (uploadModalEl) {
            const dlg = uploadModalEl.querySelector('.modal-dialog');
            if (dlg && !dlg.classList.contains('modal-dialog-centered')) {
                dlg.classList.add('modal-dialog-centered');
            }

            uploadModalEl.addEventListener('show.bs.modal', () => {
                const header = uploadModalEl.querySelector('.modal-header');
                if (header) {
                    header.style.background = '#405189';
                    header.classList.add('text-white');
                }
            });
        }
    } catch (e) { console.warn('Failed to enforce modal styles', e); }

            this.updateBulkActionButtons();
            if (typeof refreshOutboundTable === 'function') refreshOutboundTable();

            if (window.toastNotification?.error) {
                window.toastNotification.error('Bulk Delete Error', error.message, 7000);
            } else {
                Swal.fire('Error!', `Failed to delete files: ${error.message}`, 'error');
            }
        }
    }

    refreshTableAndCounts() {
        if (typeof refreshOutboundTable === 'function') refreshOutboundTable();
    }

    // Enhanced validation error modal for bulk submissions
    showValidationErrorModal(errorData) {
        closeSubmissionFlowModal(); // Close any existing submission modal

        // Store error data globally for access by global functions
        window.currentValidationErrorData = errorData;

        const { details, totalDocuments, failedDocuments } = errorData;

        // Create the modern error modal
        this.createValidationErrorModal(errorData);
    }

    createValidationErrorModal(errorData) {
        const { details, totalDocuments, failedDocuments } = errorData;

        // Add styles for the error modal
        const errorModalStyles = `
            <style id="sfV2ErrorModalStyles">
                /* Error Modal Theme */
                [data-sfv2="error"]{ --error-brand:#dc2626; --error-brand-800:#b91c1c; --error-ink:#0f172a; --error-muted:#64748b; --error-ring:#fca5a5; }

                /* Modal Backdrop */
                .submission-flow-error-backdrop{ position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; overflow-y:auto }
                .sf-error-card{ max-width:800px; width:100%; max-height:90vh; background:#fff; border-radius:16px; box-shadow:0 4px 12px rgba(0,0,0,.15); display:flex; flex-direction:column; margin:auto }

                /* Header */
                .sfv2-error-header{ display:flex; align-items:center; gap:12px; padding:16px 20px; background:linear-gradient(180deg,var(--error-brand),var(--error-brand-800)); color:#fff; box-shadow:inset 0 -1px rgba(255,255,255,.05) }
                .sfv2-error-icon{ width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.2) }
                .sfv2-error-title{ font-size:18px; font-weight:700; letter-spacing:.3px; color:#fff; margin:0 }
                .sfv2-error-sub{ font-size:13px; color:#fecaca; margin:2px 0 0 0; opacity:0.9 }

                /* Body */
                .sfv2-error-body{ padding:24px; flex:1; overflow-y:auto; }
                .sfv2-error-footer{ display:flex; justify-content:center; gap:12px; padding:16px 24px 24px; flex-shrink:0; background:#fff; border-top:1px solid #f3f4f6; }

                /* Hero Section */
                .sfv2-error-hero{ display:flex; flex-direction:column; align-items:center; justify-content:center; margin:0 0 20px; text-align:center }
                .sfv2-error-ring{ display:grid; place-items:center; width:80px; height:80px; border-radius:50%; background:radial-gradient(60% 60% at 50% 40%, rgba(220,38,38,.15), rgba(220,38,38,0) 70%); position:relative; margin:0 auto }
                .sfv2-error-ring::before{ content:''; position:absolute; inset:0; border-radius:50%; border:3px solid var(--error-brand); box-shadow:0 4px 20px rgba(220,38,38,.2) }
                .sfv2-error-x{ fill:none; stroke:var(--error-brand); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation: sfv2-stroke .6s ease forwards .2s }

                /* Badge and Messages */
                .sfv2-error-badge{ display:inline-flex; align-items:center; gap:8px; font-weight:600; color:#991b1b; background:#fee2e2; border:1px solid #fca5a5; padding:8px 16px; border-radius:999px; margin:0 auto 16px; font-size:14px; max-width:fit-content }
                .sfv2-error-badge i{ margin-right:4px; font-size:14px }
                .sfv2-error-msg{ margin:0 0 20px; color:var(--error-ink); line-height:1.5; font-weight:500; font-size:16px }

                /* Error Details */
                .sfv2-error-details{ margin:20px 0; text-align:left }
                .sfv2-error-section{ margin:16px 0 }
                .sfv2-error-section-title{ font-weight:700; margin-bottom:12px; color:#111827; font-size:15px; display:flex; align-items:center; gap:8px }
                .sfv2-error-section-title i{ margin-right:4px; font-size:14px; color:#6b7280 }
                .sfv2-error-list{ max-height:300px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:8px; background:#fafafa }

                /* Individual Error Items */
                .sfv2-error-item{ border-bottom:1px solid #e5e7eb; padding:16px; background:#fff }
                .sfv2-error-item:last-child{ border-bottom:none }
                .sfv2-error-invoice{ font-weight:600; color:#1f2937; margin-bottom:8px; display:flex; align-items:center; gap:8px }
                .sfv2-error-invoice-icon{ color:#3b82f6; font-size:14px; margin-right:4px }
                .sfv2-error-field{ margin:8px 0; padding:8px 12px; background:#f9fafb; border-radius:6px; border-left:3px solid var(--error-brand) }
                .sfv2-error-field-name{ font-weight:600; color:#374151; font-size:13px }
                .sfv2-error-field-issue{ color:#6b7280; margin:4px 0; font-size:14px }
                .sfv2-error-field-value{ font-family:monospace; background:#f3f4f6; padding:2px 6px; border-radius:4px; font-size:12px; color:#1f2937 }

                /* Buttons */
                .sfv2-error-btn{ cursor:pointer; user-select:none; border:none; border-radius:8px; padding:12px 24px; font-weight:600; transition: all .2s ease; font-size:14px; display:inline-flex; align-items:center; gap:8px; min-width:120px; justify-content:center }
                .sfv2-error-btn i{ margin-right:6px; font-size:14px }
                .sfv2-error-btn-primary{ background:#dc2626; color:#fff; box-shadow:0 2px 4px rgba(220,38,38,.2) }
                .sfv2-error-btn-primary:hover{ background:#b91c1c; box-shadow:0 4px 12px rgba(220,38,38,.3); transform: translateY(-1px) }
                .sfv2-error-btn-secondary{ background:#6b7280; color:#fff; box-shadow:0 2px 4px rgba(107,114,128,.2) }
                .sfv2-error-btn-secondary:hover{ background:#4b5563; box-shadow:0 4px 12px rgba(107,114,128,.3); transform: translateY(-1px) }
                .sfv2-error-btn:active{ transform: translateY(0) }
                .sfv2-error-btn:focus{ outline:2px solid rgba(220,38,38,.4); outline-offset:2px }

                /* Responsive */
                @media (max-width: 768px){
                    .submission-flow-error-backdrop{ padding:12px; align-items:flex-start; padding-top:20px }
                    .sf-error-card{ max-width:100%; max-height:calc(100vh - 40px); min-height:auto }
                    .sfv2-error-header{ padding:14px 16px }
                    .sfv2-error-title{ font-size:16px }
                    .sfv2-error-body{ padding:16px; }
                    .sfv2-error-footer{ padding:12px 16px 16px; gap:8px }
                    .sfv2-error-ring{ width:60px; height:60px }
                    .sfv2-error-list{ max-height:200px }
                    .sfv2-error-btn{ padding:10px 16px; font-size:13px; min-width:100px }
                }

                @media (max-width: 640px){
                    .submission-flow-error-backdrop{ padding:8px; padding-top:16px }
                    .sf-error-card{ max-height:calc(100vh - 32px) }
                    .sfv2-error-header{ padding:12px 14px }
                    .sfv2-error-title{ font-size:15px }
                    .sfv2-error-sub{ font-size:12px }
                    .sfv2-error-body{ padding:14px }
                    .sfv2-error-footer{ flex-direction:column; padding:10px 14px 14px; gap:10px }
                    .sfv2-error-btn{ width:100%; padding:12px; font-size:14px; min-height:44px }
                    .sfv2-error-ring{ width:50px; height:50px }
                    .sfv2-error-list{ max-height:150px }
                    .sfv2-error-item{ padding:12px }
                    .sfv2-error-msg{ font-size:15px }
                }

                @media (max-width: 480px){
                    .submission-flow-error-backdrop{ padding:4px; padding-top:12px }
                    .sf-error-card{ max-height:calc(100vh - 24px); border-radius:12px }
                    .sfv2-error-header{ padding:10px 12px }
                    .sfv2-error-title{ font-size:14px }
                    .sfv2-error-body{ padding:12px }
                    .sfv2-error-footer{ padding:8px 12px 12px }
                    .sfv2-error-btn{ min-height:48px; font-size:15px }
                    .sfv2-error-list{ max-height:120px }
                    .sfv2-error-item{ padding:10px }
                }

                @media (max-height: 600px){
                    .submission-flow-error-backdrop{ align-items:flex-start; padding-top:10px }
                    .sf-error-card{ max-height:calc(100vh - 20px) }
                    .sfv2-error-list{ max-height:120px }
                    .sfv2-error-ring{ width:50px; height:50px }
                }

                /* Animations */
                @keyframes sfv2-stroke{ to { stroke-dashoffset:0 } }
                @media (prefers-reduced-motion: reduce){ *{ animation: none !important } .sfv2-error-x{ stroke-dashoffset:0 !important } }
            </style>`;

        // Build error details HTML
        let errorDetailsHtml = '';
        details.forEach((detail, index) => {
            let errorFieldsHtml = '';
            detail.errors.forEach(error => {
                errorFieldsHtml += `
                    <div class="sfv2-error-field">
                        <div class="sfv2-error-field-name">Field: ${error.field}</div>
                        <div class="sfv2-error-field-issue">Issue: ${error.userFriendlyMessage || error.message}</div>
                        ${error.value ? `<div class="sfv2-error-field-value">Current Value: ${error.value}</div>` : ''}
                    </div>
                `;
            });

            errorDetailsHtml += `
                <div class="sfv2-error-item">
                    <div class="sfv2-error-invoice">
                        <i class="fas fa-file-invoice sfv2-error-invoice-icon"></i>
                        Invoice #${detail.invoiceNumber}
                    </div>
                    ${errorFieldsHtml}
                </div>
            `;
        });

        const modalHtml = `
            ${errorModalStyles}
            <div class="submission-flow-error-backdrop" data-sfv2="error" id="validationErrorBackdrop">
                <div class="sf-error-card">
                    <div class="sfv2-error-header">
                        <div class="sfv2-error-icon">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div>
                            <div class="sfv2-error-title">Bulk Submission Validation Failed</div>
                            <div class="sfv2-error-sub">All-or-Nothing Policy</div>
                        </div>
                    </div>

                    <div class="sfv2-error-body">
                        <div class="sfv2-error-hero">
                            <div class="sfv2-error-ring">
                                <svg width="32" height="32" viewBox="0 0 24 24" class="sfv2-error-x">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </div>
                            <div class="sfv2-error-badge">
                                <i class="fas fa-exclamation-circle"></i>
                                ${failedDocuments} out of ${totalDocuments} invoices failed validation
                            </div>
                            <div class="sfv2-error-msg">All invoices in this file must pass validation before any can be submitted.</div>
                        </div>

                        <div class="sfv2-error-details">
                            <div class="sfv2-error-section">
                                <div class="sfv2-error-section-title">
                                    <i class="fas fa-list-alt"></i>
                                    Validation Errors by Invoice:
                                </div>
                                <div class="sfv2-error-list">
                                    ${errorDetailsHtml}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="sfv2-error-footer">
                        <button class="sfv2-error-btn sfv2-error-btn-primary" id="downloadErrorReportBtn" onclick="downloadValidationErrorReport()">
                            <i class="fas fa-download"></i>
                            Download Error Report
                        </button>
                        <button class="sfv2-error-btn sfv2-error-btn-secondary" id="closeErrorModalBtn" onclick="closeValidationErrorModal()">
                            <i class="fas fa-times"></i>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove any existing modal
        const existingModal = document.getElementById('validationErrorBackdrop');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Event listeners are now handled via onclick attributes in the HTML

        // Add click outside to close
        const backdrop = document.getElementById('validationErrorBackdrop');
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                window.closeValidationErrorModal();
            }
        });

        // Add escape key to close
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                window.closeValidationErrorModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    closeValidationErrorModal() {
        const modal = document.getElementById('validationErrorBackdrop');
        if (modal) {
            modal.remove();
        }

        // Remove styles
        const styles = document.getElementById('sfV2ErrorModalStyles');
        if (styles) {
            styles.remove();
        }
    }

    // Download validation error report as CSV
    downloadValidationErrorReport(errorData) {
        const { details, totalDocuments, failedDocuments } = errorData;

        let csvContent = "Invoice Number,Row Index,Error Code,Field,Error Message,Current Value\n";

        details.forEach(detail => {
            detail.errors.forEach(error => {
                const row = [
                    detail.invoiceNumber,
                    detail.index + 1,
                    error.code,
                    error.field,
                    `"${(error.userFriendlyMessage || error.message).replace(/"/g, '""')}"`,
                    error.value ? `"${String(error.value).replace(/"/g, '""')}"` : ''
                ].join(',');
                csvContent += row + "\n";
            });
        });

        // Create and download the file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `validation_errors_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (window.toastNotification?.success) {
            window.toastNotification.success('Downloaded', 'Validation error report downloaded successfully.', 3000);
        }
    }
}


// Simple reusable loading backdrop for short operations (reuses excel styles)
function showLoadingBackdrop(message = 'Processing...') {
    const existing = document.getElementById('loadingBackdrop');
    if (existing) existing.remove();
    const wrapper = document.createElement('div');
    wrapper.id = 'loadingBackdrop';
    wrapper.className = 'excel-loading-backdrop';
    wrapper.innerHTML = `
        <div class="excel-loading-content">
            <div class="excel-modal-header">
                <div class="excel-processing-icon">
                    <div class="excel-processing-pulse"></div>
                    <i class="bi bi-trash"></i>
                </div>
                <h5 class="excel-processing-title">${message}</h5>
                <p class="excel-processing-subtitle">Please wait...</p>
            </div>
            <div class="excel-modal-body">
                <div class="excel-loading-indicator">
                    <div class="excel-spinner"></div>
                    <div class="excel-progress-text">Working</div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(wrapper);
}

// ===== Submission Flow UI (multi-stage) =====
(function addSubmissionFlowStyles() {
    if (document.getElementById('submission-flow-styles')) return;
    const style = document.createElement('style');
    style.id = 'submission-flow-styles';
    style.textContent = `
      /* Backdrop and Card */
      .submission-flow-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:10995}

      /* Shake animation for disabled click-outside */
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }
      .sf-submission-card{background:#fff;border-radius:16px;color:#0f172a;width:760px;max-width:96%;box-shadow:0 22px 90px rgba(0,0,0,.14);overflow:hidden}

      /* Header */
      .sf-submission-header{display:flex;gap:14px;align-items:center;padding:20px 24px;background:#405189;color:#fff}
      .sf-submission-header-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.14)}
      .sf-submission-title{font-weight:700;margin:0;font-size:18px;color:#fff;letter-spacing:.2px}
      .sf-submission-sub{margin:2px 0 0;color:#E0E7FF;font-size:12px;opacity:.95;animation:sfv2-pulse 1.4s ease-in-out infinite}

      /* Body */
      .sf-submission-body{padding:18px 24px 20px;background:#ffffff}

      /* Horizontal numbered stepper */
      .sf-steps{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:22px;margin:8px 10px 16px}
      .sf-steps-track{position:absolute;left:42px;right:42px;top:22px;height:4px;background:#e5e7eb;border-radius:999px}
      .sf-steps-track>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#405189,#5c6dad);border-radius:inherit;transition:width .35s ease}
      .sf-step{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;z-index:1;flex:1}
      .sf-step-num{width:36px;height:36px;border-radius:50%;border:2px solid #c7cde7;background:#fff;color:#405189;display:grid;place-items:center;font-weight:800;box-shadow:0 2px 6px rgba(64,81,137,.15)}
      .sf-step-label{font-weight:700;color:#111827;font-size:12px}
      .sf-step-msg{color:#475569;font-size:11px;min-height:28px}
      .sf-step.active .sf-step-num{background:#e5ebfb;border-color:#405189}
      .sf-step.completed .sf-step-num{background:#405189;color:#fff;border-color:#405189}

      @keyframes sfv2-pulse{0%{opacity:.85}50%{opacity:1}100%{opacity:.85}}
      @keyframes sfv2-typing{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
      .sf-typing{animation:sfv2-typing 1.2s ease-in-out infinite}

      /* Progress */
      .sf-submission-progress{margin-top:14px;height:12px;background:#f1f5f9;border-radius:999px;overflow:hidden;border:1px solid #e5e7eb;position:relative}
      .sf-submission-progress:before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(64,81,137,.10)0,rgba(64,81,137,.10)12px,transparent 12px,transparent 24px);pointer-events:none}
      .sf-submission-bar{height:100%;width:0;background:linear-gradient(90deg,#405189,#5c6dad);box-shadow:inset 0 0 6px rgba(0,0,0,.12);transition:width .35s ease}
      .sf-submission-percent{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-weight:700;font-size:12px;color:#405189}

      /* Error panel (separate) */
      .sf-submission-error-container{margin-top:12px;border:1px solid #fecaca;background:#fff1f2;border-radius:12px;padding:12px}
      .sf-submission-error-title{font-weight:800;color:#991b1b;margin:0 0 4px;font-size:14px}
      .sf-submission-error-sub{color:#9f1239;margin:0 0 8px;font-size:12px}
      .sf-submission-error-guidance{margin:0;padding-left:18px;color:#1f2937;font-size:12px}
      .sf-submission-error-meta{margin-top:8px;color:#6b7280;font-size:12px}
      .sf-submission-error-pill{display:inline-flex;gap:6px;align-items:center;padding:4px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-weight:600;font-size:12px}

      /* Footer */
      .sf-submission-footer{display:flex;justify-content:flex-end;gap:10px;padding:12px 24px 20px}
      .sf-submission-retry{background:#2563eb;border:none;color:#fff;border-radius:8px;padding:8px 14px;font-weight:700;box-shadow:0 2px 6px rgba(37,99,235,.25);transition:filter .2s ease}
      .sf-submission-close{background:#ef4444;border:none;color:#fff;border-radius:8px;padding:8px 14px;font-weight:700;box-shadow:0 2px 6px rgba(239,68,68,.25);transition:filter .2s ease}
      .sf-submission-cancel{background:#6b7280;border:none;color:#fff;border-radius:8px;padding:8px 12px;font-weight:700;box-shadow:0 2px 6px rgba(107,114,128,.25);transition:filter .2s ease}
      .sf-submission-footer button:hover{filter:brightness(0.95)}
      .sf-submission-footer button:focus-visible{outline:2px solid rgba(64,81,137,.55);outline-offset:2px}

      /* Media queries */
      @media (max-width: 620px){
        .sf-submission-card{width:96vw;border-radius:14px}
        .sf-submission-steps:before{left:30px}
        .sf-submission-step{padding-left:70px}
        .sf-submission-ico{left:12px}
      }

      /* Prefers-reduced-motion */
      @media (prefers-reduced-motion: reduce){
        .sf-submission-bar{transition:none}
        .sf-submission-step{transition:none}
        .sf-submission-step:hover{transform:none}
      }

      /* Success check animation (namespaced) */
      .sf-success-check{width:82px;height:82px;border-radius:50%;border:4px solid #405189;display:flex;align-items:center;justify-content:center;margin:12px auto;position:relative}
      .sf-success-check:after{content:'';position:absolute;width:40px;height:40px;border-radius:50%;border:4px solid rgba(64,81,137,.25);animation:sfPulse 1.2s ease-out infinite}
      .sf-checkmark{width:36px;height:18px;border-left:4px solid #405189;border-bottom:4px solid #405189;transform:rotate(-45deg);transform-origin:left bottom;animation:sfDraw .6s ease forwards}
      @keyframes sfDraw{from{width:0;height:0}50%{width:18px;height:0}to{width:36px;height:18px}}
      @keyframes sfPulse{0%{transform:scale(1);opacity:.8}80%{transform:scale(1.6);opacity:0}100%{opacity:0}}
      @keyframes sfStepPulse{0%{transform:scale(1)}50%{transform:scale(1.2)}100%{transform:scale(1)}}

      /* Icon spin */
      .sf-icon-spin{animation:sfIconSpin 1s linear infinite}
      @keyframes sfIconSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

      /* Error styling (legacy) */
      .error-pill,.error-grid,.error-card,.error-title,.suggest{all:unset}

      /* New namespaced error panel */
      .sf-submission-error-container{margin-top:16px;border:1px solid #fecaca;background:#fff1f2;border-radius:12px;padding:12px}
      .sf-submission-error-title{font-weight:800;color:#991b1b;margin:0 0 6px;font-size:14px}
      .sf-submission-error-sub{color:#9f1239;margin:0 0 8px;font-size:12px}
      .sf-submission-error-guidance{margin:0;padding-left:18px;color:#1f2937;font-size:12px}
      .sf-submission-error-guidance li{margin:4px 0}
      .sf-submission-error-meta{margin-top:8px;font-size:11px;color:#7f1d1d}
      .sf-submission-error-pill{display:inline-flex;gap:6px;align-items:center;padding:4px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-weight:600;font-size:12px}

      /* Footer buttons (namespaced) */
      .sf-footer .sf-retry,.sf-footer .sf-close{display:none}
      .sf-submission-footer{display:flex;justify-content:flex-end;gap:10px;padding:12px 24px 20px}
      .sf-submission-retry{background:#2563eb;border:none;color:#fff;border-radius:8px;padding:8px 12px;font-weight:700;box-shadow:0 2px 6px rgba(37,99,235,.25)}
      .sf-submission-close{background:#ef4444;border:none;color:#fff;border-radius:8px;padding:8px 12px;font-weight:700;box-shadow:0 2px 6px rgba(239,68,68,.25)}
    `;
    document.head.appendChild(style);
})();

const SUBMISSION_STEPS = [
  { key: 'validate', label: 'Validating documents' },
  { key: 'process', label: 'Processing documents' },
  { key: 'duplicates', label: 'Checking LHDN duplicates' },
  { key: 'submit', label: 'Submitting to LHDN' },
  { key: 'done', label: 'Done' }
];

function showSubmissionFlowModal(initialMsg = 'Preparing submission...') {
  // cleanup
  closeSubmissionFlowModal();
  const overlay = document.createElement('div');
  overlay.id = 'submissionFlowBackdrop';
  overlay.className = 'submission-flow-backdrop';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','sfTitle');
  overlay.setAttribute('aria-describedby','sfSub');
  overlay.innerHTML = `
    <div class="sf-submission-card">
      <div class="sf-submission-header">
        <div class="sf-submission-header-icon" aria-hidden="true"><i class="bi bi-cloud-upload" style="font-size:20px;color:#bfdbfe"></i></div>
        <div>
          <h5 class="sf-submission-title" id="sfTitle">Submitting to LHDN</h5>
          <div class="sf-submission-sub" id="sfSub" aria-live="polite">${initialMsg}</div>
        </div>
      </div>
      <div class="sf-submission-body">
        <div class="sf-steps" id="sfSteps" role="list" aria-label="Submission steps">
          <div class="sf-steps-track" aria-hidden="true"><span id="sfStepsTrack"></span></div>
          ${SUBMISSION_STEPS.map((s,i)=>`
            <div class="sf-step ${i===0?'active':''}" data-key="${s.key}" role="listitem" aria-current="${i===0?'step':'false'}" aria-label="${s.label}">
              <div class="sf-step-num">${i+1}</div>
              <div class="sf-step-label">${s.label}</div>
              <div class="sf-step-msg" id="sfMsg_${s.key}"></div>
            </div>`).join('')}
        </div>
        <div class="sf-submission-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Submission progress">
          <div class="sf-submission-bar" id="sfBar"></div>
          <div class="sf-submission-percent" id="sfPercent">0%</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span id="sfEta" style="font-size:12px;color:#6b7280"></span>
          </div>
          <div style="font-size:12px;color:#4f46e5;font-weight:600" id="sfTip">Pro tip: Keep this window open during submission.</div>
        </div>

      </div>
      <div class="sf-submission-footer" aria-label="Submission actions">
        <button id="sfRetry" class="sf-submission-retry" style="display:none">Retry</button>
        <button id="sfClose" class="sf-submission-close" style="display:none">Close</button>
        <button id="sfCancel" class="sf-submission-cancel" style="display:none">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function updateSubmissionFlow({ stage='validate', message='', progress=0, eta=null, error=null, realTimeInfo=null, realTimeStatus=null, invoiceCount=null, totalInvoices=null } = {}) {
  const sub = document.getElementById('sfSub');
  if (sub) {
    let displayMessage = escapeHtml(String(message||''));

    // Add invoice counter if provided
    if (invoiceCount !== null && totalInvoices !== null) {
      displayMessage = `Processing invoice ${invoiceCount} of ${totalInvoices}...`;
    } else if (invoiceCount !== null) {
      displayMessage = `Processing invoice ${invoiceCount}...`;
    }

    sub.innerHTML = `<span class="sf-typing">${displayMessage}</span>`;
  }

  // Update horizontal stepper (active/completed)
  const steps = Array.from(document.querySelectorAll('#sfSteps .sf-step'));
  let found = false;
  steps.forEach(step => {
    const key = step.getAttribute('data-key');
    if (key === stage) {
      step.classList.add('active');
      step.classList.remove('completed');
      step.setAttribute('aria-current','step');
      found = true;
    } else {
      step.classList.remove('active');
      step.removeAttribute('aria-current');
      if (!found) step.classList.add('completed'); else step.classList.remove('completed');
    }
  });
  const track = document.getElementById('sfStepsTrack');
  if (track && steps.length) {
    const idx = Math.max(0, steps.findIndex(s=>s.classList.contains('active')));
    const pct = ((idx) / (steps.length - 1)) * 100;
    track.style.width = isFinite(pct) ? pct + '%' : '0%';
  }

  // Update per-step message
  const msgEl = document.getElementById(`sfMsg_${stage}`);
  if (msgEl && message) msgEl.textContent = message;

  // Add real-time validation status display
  if (stage === 'monitor' && realTimeStatus) {
    const stepEl = document.querySelector(`.sf-submission-step[data-key="monitor"]`) ||
                   document.querySelector(`.sf-submission-step[data-key="submit"]`);
    if (stepEl) {
      const existingInfo = stepEl.querySelector('.sf-realtime-validation');
      if (existingInfo) existingInfo.remove();

      const infoEl = document.createElement('div');
      infoEl.className = 'sf-realtime-validation';
      infoEl.style.cssText = 'margin-top: 12px; font-size: 12px; background: #f8f9fa; border-radius: 6px; padding: 12px; border-left: 4px solid #007bff;';

      let infoHTML = '<div style="font-weight: 600; color: #495057; margin-bottom: 8px;">📊 Real-Time Status</div>';

      if (realTimeStatus.files && realTimeStatus.files.length > 0) {
        infoHTML += '<div style="margin-bottom: 8px;">';
        infoHTML += `<strong>Files:</strong> ${realTimeStatus.processedFiles || 0}/${realTimeStatus.totalFiles || 0} processed<br>`;
        infoHTML += `<strong>Phase:</strong> ${realTimeStatus.currentPhase || 'Unknown'}<br>`;
        infoHTML += `<strong>Status:</strong> ${realTimeStatus.overallStatus || 'Processing'}`;
        infoHTML += '</div>';

        // Show file-by-file progress
        infoHTML += '<div style="max-height: 120px; overflow-y: auto; border-top: 1px solid #dee2e6; padding-top: 8px;">';
        realTimeStatus.files.forEach((file, index) => {
          const statusIcon = file.status === 'validation_failed' ? '❌' :
                           file.status === 'completed' ? '✅' :
                           file.status === 'processing' ? '⏳' : '⏸️';
          const statusColor = file.status === 'validation_failed' ? '#dc3545' :
                            file.status === 'completed' ? '#28a745' : '#6c757d';

          infoHTML += `<div style="margin-bottom: 4px; font-size: 11px;">`;
          infoHTML += `<span style="color: ${statusColor};">${statusIcon}</span> `;
          infoHTML += `<strong>${file.filename}</strong> `;
          infoHTML += `<span style="color: #6c757d;">(${file.invoiceCount || 0} invoices)</span>`;

          if (file.status === 'validation_failed' && file.errors && file.errors.length > 0) {
            infoHTML += `<br><span style="color: #dc3545; margin-left: 16px; font-size: 10px;">`;
            infoHTML += `${file.errors.length} validation error${file.errors.length > 1 ? 's' : ''}</span>`;
          }
          infoHTML += '</div>';
        });
        infoHTML += '</div>';
      }

      infoEl.innerHTML = infoHTML;
      stepEl.appendChild(infoEl);
    }
  }

  // Add real-time progress info for Step 4 (submit)
  if (stage === 'submit' && realTimeInfo) {
    const stepEl = document.querySelector(`.sf-submission-step[data-key="submit"]`);
    if (stepEl) {
      const existingInfo = stepEl.querySelector('.sf-realtime-info');
      if (existingInfo) existingInfo.remove();

      const infoEl = document.createElement('div');
      infoEl.className = 'sf-realtime-info';
      infoEl.style.cssText = 'margin-top: 8px; font-size: 13px; color: #64748b; line-height: 1.4; padding-left: 40px;';

      let infoHTML = '';
      if (realTimeInfo.currentInvoice && realTimeInfo.totalInvoices) {
        infoHTML += `<div><strong>Current:</strong> ${realTimeInfo.currentInvoice}</div>`;
        infoHTML += `<div><strong>Progress:</strong> ${realTimeInfo.processed || 0} of ${realTimeInfo.totalInvoices} invoices</div>`;
        if (realTimeInfo.remaining > 0) {
          infoHTML += `<div><strong>Remaining:</strong> ${realTimeInfo.remaining} invoices</div>`;
        }
      }
      if (realTimeInfo.submissionUid) {
        infoHTML += `<div><strong>Submission ID:</strong> ${realTimeInfo.submissionUid.substring(0, 8)}...</div>`;
      }
      if (realTimeInfo.status) {
        infoHTML += `<div><strong>LHDN Status:</strong> ${realTimeInfo.status}</div>`;
      }

      infoEl.innerHTML = infoHTML;
      stepEl.appendChild(infoEl);
    }
  }

  // When we move past a step, stamp its message to a "completed" variant
  try {
    const completedMap = {
      validate: 'Validation completed',
      process: 'Documents prepared successfully',
      duplicates: 'Duplicate check completed',
      submit: 'Submitted to LHDN',
    };
    const idxActive = steps.findIndex(s=>s.classList.contains('active'));
    steps.forEach((s, idx)=>{
      const k = s.getAttribute('data-key');
      const labelEl = s.querySelector('.sf-step-msg');
      if (labelEl && idx < idxActive) {
        labelEl.textContent = completedMap[k] || labelEl.textContent || 'Completed';
      }
    });
  } catch(_){}

  // Update progress bar + percentage + ARIA + ETA + rotating tips
  const percent = Math.max(0, Math.min(100, progress));
  const bar = document.getElementById('sfBar');
  const prog = document.querySelector('.sf-submission-progress');
  const pct = document.getElementById('sfPercent');
  if (bar) bar.style.width = percent + '%';
  if (prog) prog.setAttribute('aria-valuenow', String(percent));
  if (pct) pct.textContent = `${percent}%`;
  const pctChip = document.getElementById('sfPctChip'); if (pctChip) pctChip.textContent = `${percent}%`;

  const tipEl = document.getElementById('sfTip');
  const etaEl = document.getElementById('sfEta');
  if (etaEl && typeof eta === 'number') {
    const secs = Math.max(1, Math.round(eta/1000));
    etaEl.textContent = `ETA: ~${secs}s`;
  } else if (etaEl) {
    etaEl.textContent = '';
  }
  if (tipEl){
    const tips = [
      'Pro tip: Keep this window open during submission.',
      'Pro tip: Avoid navigating away while processing.',
      'Pro tip: Review submission results in History tab.',
      'Pro tip: Files are auto-batched to respect LHDN limits.',
      'Pro tip: Processing happens in secure background tasks.',
      'Pro tip: Duplicate checks prevent resubmission errors.',
      'Pro tip: Large files are processed in optimized chunks.',
      'Pro tip: LHDN validates documents in real-time.',
      'Pro tip: Submission status updates automatically.',
      'Pro tip: Failed documents can be resubmitted individually.',
      'Pro tip: Check network connection for smooth processing.',
      'Pro tip: Document validation happens before submission.'
    ];

    // Rotate tips every 5 seconds with random selection
    if (!window.submissionTipRotator) {
      let currentTipIndex = Math.floor(Math.random() * tips.length);
      window.submissionTipRotator = setInterval(() => {
        const tipElement = document.getElementById('sfTip');
        if (tipElement) {
          // Select next random tip (avoid repeating the same tip)
          let nextIndex;
          do {
            nextIndex = Math.floor(Math.random() * tips.length);
          } while (nextIndex === currentTipIndex && tips.length > 1);

          currentTipIndex = nextIndex;
          tipElement.textContent = tips[currentTipIndex];
        } else {
          // Clear interval if tip element is gone
          clearInterval(window.submissionTipRotator);
          window.submissionTipRotator = null;
        }
      }, 5000);
    }

    // Set initial tip
    tipEl.textContent = tips[Math.floor(Math.random() * tips.length)];
  }

  // Separate error handling: close flow modal and open dedicated error modal
  if (error) {
    try {
      const friendly = mapLhdnErrorToFriendly(error);
      closeSubmissionFlowModal();
      showSubmissionErrorModal({
        category: friendly.category,
        friendlyMessage: friendly.friendlyMessage,
        suggestions: friendly.suggestions,
        technical: error
      });
    } catch(_) {
      closeSubmissionFlowModal();
      showSubmissionErrorModal({ category: 'Submission Error', friendlyMessage: 'There was a problem with your submission.', technical: error });
    }
    return; // early exit on error
  }
}


const LHDN_PLAIN_ERROR_MAP = {
    CF321: 'The invoice date is outside the allowed period. Submit within 7 days of the invoice date.',
    CF364: 'An item classification code is not valid. Check each line item in your Excel file.',
    CF401: 'Tax amounts do not match LHDN rules. Recalculate tax on affected invoices.',
    CF404: 'A required field is missing. Fill in all mandatory columns in your template.',
    CF406: 'One or more values are not in the correct format.',
    CF410: 'Supplier phone number format is invalid. Use country code, e.g. +60123456789.',
    CF414: 'Supplier phone number is too short (minimum 8 characters).',
    CF415: 'Buyer phone number format is invalid. Use country code, e.g. +60123456789.',
    DS302: 'This invoice was already submitted to LHDN.',
    VALIDATION_ERROR: 'LHDN could not validate one or more invoices in your file.',
    INVOICE_LINE_ERROR: 'A line item on your invoice has missing or incorrect data.',
};

const LHDN_FIELD_LABELS = {
    Amount: 'Amount (item price)',
    LineExtensionAmount: 'Line amount',
    InvoicedQuantity: 'Quantity',
    unitCode: 'Unit code',
    PriceAmount: 'Unit price',
    TaxAmount: 'Tax amount',
    TaxableAmount: 'Taxable amount',
    PayableAmount: 'Payable amount',
    IdentificationCode: 'Country code',
};

const GENERIC_LHDN_USER_MESSAGES = [
    /there is an issue with your invoice/i,
    /there is an issue with one of your invoice/i,
    /document validation failed/i,
    /your invoice contains validation errors/i,
    /a required field is missing from your invoice/i,
    /lhdn could not validate/i,
    /please review your invoice information/i,
];

function isGenericLhdnUserMessage(msg) {
    if (!msg || isTechnicalLhdnText(msg)) return true;
    return GENERIC_LHDN_USER_MESSAGES.some((re) => re.test(msg));
}

function humanizeLhdnFieldName(name) {
    const key = String(name || '').replace(/\[\d+\]/g, '');
    if (LHDN_FIELD_LABELS[key]) return LHDN_FIELD_LABELS[key];
    return key.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase()).trim() || 'Required field';
}

function buildInvoiceNumberLookup(fileData) {
    const byIndex = new Map();
    const add = (index1, num) => {
        const n = String(num || '').trim();
        if (n && index1 >= 1 && !byIndex.has(index1)) {
            byIndex.set(index1, n);
        }
    };

    const details = fileData?.invoiceDetails;
    if (Array.isArray(details)) {
        details.forEach((inv, i) => {
            add(
                i + 1,
                inv.invoiceNumber ||
                    inv.invoiceNo ||
                    inv.invoice_number ||
                    inv.codeNumber ||
                    inv.invoiceCodeNumber
            );
        });
    }

    let meta = fileData?.metadata;
    if (typeof meta === 'string') {
        try {
            meta = JSON.parse(meta);
        } catch (_) {
            meta = null;
        }
    }
    if (meta && Array.isArray(meta.listInvoiceDetails)) {
        meta.listInvoiceDetails.forEach((inv, i) => {
            add(i + 1, inv.invoiceNumber || inv.invoiceNo || inv.invoice_number);
        });
    }

    const invNumField = fileData?.invoiceNumber;
    if (typeof invNumField === 'string' && invNumField.includes('\n')) {
        invNumField
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !/invoice\(s\)/i.test(line))
            .forEach((num, i) => add(i + 1, num));
    } else if (typeof invNumField === 'string' && invNumField.trim() && !/invoice\(s\)/i.test(invNumField)) {
        add(1, invNumField.trim());
    }

    return byIndex;
}

function getInvoiceNumberForIndex(invoiceLookup, index1Based) {
    if (!invoiceLookup || !index1Based) return null;
    return invoiceLookup.get(index1Based) || null;
}

function formatInvoiceLocation(ctx, invoiceLookup, invoiceRef) {
    if (invoiceRef) {
        const ref = String(invoiceRef).trim();
        if (/^invoice\s*no\.?/i.test(ref)) return ref;
        return `Invoice No. ${ref}`;
    }
    const invNo = getInvoiceNumberForIndex(invoiceLookup, ctx?.invoiceNum);
    if (invNo && ctx?.lineNum) {
        return `Invoice No. ${invNo}, line item ${ctx.lineNum}`;
    }
    if (invNo) return `Invoice No. ${invNo}`;
    if (ctx?.invoiceNum && ctx?.lineNum) {
        return `Invoice row ${ctx.invoiceNum}, line item ${ctx.lineNum}`;
    }
    if (ctx?.invoiceNum) return `Invoice row ${ctx.invoiceNum}`;
    return '';
}

function resolveInvoiceNumberForDetail(detail, invoiceLookup) {
    if (detail?.invoiceRef) return String(detail.invoiceRef).trim();
    const ctx = parseInvoiceContextFromText(
        detail?.propertyPath || detail?.target || detail?.originalMessage || detail?.message || ''
    );
    return getInvoiceNumberForIndex(invoiceLookup, ctx.invoiceNum) || '';
}

function buildFailedSubmissionStatusAlert(fileData, lhdnData) {
    const invoiceLookup = buildInvoiceNumberLookup(fileData);
    const issues = collectAllSubmissionIssues(lhdnData, invoiceLookup);
    const totalDocs =
        lhdnData?.totalDocuments ||
        lhdnData?.summary?.totalDocuments ||
        invoiceLookup.size ||
        0;

    const affectedInvoiceNos = [];
    issues.forEach((issue) => {
        const no = resolveInvoiceNumberForDetail(issue, invoiceLookup);
        if (no && !affectedInvoiceNos.includes(no)) {
            affectedInvoiceNos.push(no);
        }
    });

    let detailLine = '';
    if (affectedInvoiceNos.length === 1) {
        detailLine = `Please correct <strong>Invoice No. ${escapeHtml(affectedInvoiceNos[0])}</strong> in your Excel file (details below), then upload and submit again.`;
    } else if (affectedInvoiceNos.length > 1) {
        detailLine = `Please correct these invoice numbers: <strong>${affectedInvoiceNos.map((n) => escapeHtml(n)).join(', ')}</strong>, then resubmit the file.`;
    } else if (issues.length > 0) {
        detailLine = `Please fix the ${issues.length} issue${issues.length > 1 ? 's' : ''} below in your Excel file, then upload and submit again.`;
    } else {
        detailLine = 'Please review the details below, correct your Excel template, then upload and submit again.';
    }

    const countLine =
        totalDocs > 0
            ? `This file contains ${totalDocs} invoice${totalDocs === 1 ? '' : 's'}.`
            : '';

    return `<div class="alert alert-danger mb-0 om-submission-alert">
        <i class="bi bi-exclamation-triangle-fill om-alert-icon"></i>
        <div class="om-alert-text">
            <p class="mb-1"><strong>MyInvois could not accept this file.</strong></p>
            <p class="mb-0">${countLine ? `${countLine} ` : ''}${detailLine}</p>
        </div>
    </div>`;
}

function buildWhereFromContext(ctx, invoiceLookup, invoiceRef) {
    return formatInvoiceLocation(ctx, invoiceLookup, invoiceRef);
}

function guidanceForLhdnField(fieldPath) {
    const path = String(fieldPath || '');
    if (path.includes('Amount') && path.includes('ItemPriceExtension')) {
        return [
            'In your Excel template, enter the Amount for this line item (item price extension column).',
            'Use numbers only (e.g. 100.00) — do not leave the cell blank.',
            'Save the file and submit again from this page.',
        ];
    }
    if (path.includes('unitCode') || path.includes('InvoicedQuantity')) {
        return [
            'Check quantity and unit code columns for this line item (e.g. C62 for pieces).',
            'Save the file and submit again.',
        ];
    }
    if (path.includes('LineExtensionAmount')) {
        return [
            'Enter the line amount (total before tax) for this item in your Excel file.',
            'Save and resubmit.',
        ];
    }
    if (path.includes('Country') && path.includes('IdentificationCode')) {
        return [
            'Add country code MY (or the correct code) in the supplier/customer address section.',
            'Save and resubmit.',
        ];
    }
    return [
        'Open your Excel template and correct the field mentioned above.',
        'Save the file, then upload and submit again.',
    ];
}

function buildMissingFieldMessage(fieldPath, ctx, invoiceLookup) {
    const field = String(fieldPath || '').split('.').pop().replace(/\[\d+\]/g, '') || 'required information';
    const label = humanizeLhdnFieldName(field);
    const loc = formatInvoiceLocation(ctx, invoiceLookup, null);
    if (loc && ctx.lineNum) {
        return `MyInvois reports that "${label}" is missing on ${loc}.`;
    }
    if (loc) {
        return `MyInvois reports that "${label}" is missing on ${loc}.`;
    }
    return `MyInvois reports that "${label}" is missing in your Excel data.`;
}

function extractNestedErrorsFromRaw(raw, invoiceLookup) {
    const text = String(raw || '');
    if (!text) return [];

    const results = [];
    const seen = new Set();

    const propRe = /PropertyRequired:\s*([^\s,}]+)/gi;
    let match;
    while ((match = propRe.exec(text)) !== null) {
        const fieldPath = match[1].trim();
        const slice = text.substring(Math.max(0, match.index - 400), match.index + 120);
        const ctx = parseInvoiceContextFromText(slice + ' ' + fieldPath);
        const key = `${ctx.invoiceNum}|${ctx.lineNum}|${fieldPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const fieldName = fieldPath.split('.').pop().replace(/\[\d+\]/g, '');
        results.push({
            propertyPath: fieldPath,
            fieldName,
            userMessage: buildMissingFieldMessage(fieldPath, ctx, invoiceLookup),
            fieldDescription: humanizeLhdnFieldName(fieldName),
            guidance: guidanceForLhdnField(fieldPath),
            where: buildWhereFromContext(ctx, invoiceLookup),
            invoiceRef: getInvoiceNumberForIndex(invoiceLookup, ctx.invoiceNum) || undefined,
        });
    }

    if (results.length) return results;

    const strRe = /StringExpected:\s*([^\s}]+)/gi;
    while ((match = strRe.exec(text)) !== null) {
        const fieldPath = match[1].trim();
        const slice = text.substring(Math.max(0, match.index - 400), match.index + 80);
        const ctx = parseInvoiceContextFromText(slice + ' ' + fieldPath);
        const key = `str|${ctx.invoiceNum}|${ctx.lineNum}|${fieldPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = humanizeLhdnFieldName(fieldPath.split('.').pop());
        const loc = formatInvoiceLocation(ctx, invoiceLookup, null);
        results.push({
            propertyPath: fieldPath,
            fieldName: fieldPath.split('.').pop(),
            userMessage: loc && ctx.lineNum
                ? `"${label}" has an invalid format on ${loc}.`
                : `"${label}" has an invalid format in your Excel data.`,
            fieldDescription: label,
            guidance: guidanceForLhdnField(fieldPath),
            where: buildWhereFromContext(ctx, invoiceLookup),
            invoiceRef: getInvoiceNumberForIndex(invoiceLookup, ctx.invoiceNum) || undefined,
        });
    }

    if (results.length) return results;

    const invoiceIndices = [...text.matchAll(/#\/Invoice\[(\d+)\]/gi)].map((m) => parseInt(m[1], 10));
    const uniqueInvoices = [...new Set(invoiceIndices)];
    if (uniqueInvoices.length > 1) {
        uniqueInvoices.forEach((idx) => {
            const ctx = { invoiceNum: idx + 1, lineNum: null };
            const lineMatch = text.match(new RegExp(`#/Invoice\\[${idx}\\][^#]*InvoiceLine\\[(\\d+)\\]`, 'i'));
            if (lineMatch) ctx.lineNum = parseInt(lineMatch[1], 10) + 1;
            const loc = formatInvoiceLocation(ctx, invoiceLookup, null);
            results.push({
                userMessage: loc
                    ? `${loc} has invalid or incomplete data.`
                    : 'Invoice data is invalid or incomplete.',
                fieldDescription: 'Invoice data',
                guidance: guidanceForLhdnField('InvoiceLine'),
                where: buildWhereFromContext(ctx, invoiceLookup),
                invoiceRef: getInvoiceNumberForIndex(invoiceLookup, ctx.invoiceNum) || undefined,
            });
        });
    }

    return results;
}

function collectAllSubmissionIssues(lhdnData, invoiceLookup) {
    const items = [];

    const pushDetail = (detail, extra = {}) => {
        const raw =
            detail.originalMessage ||
            detail.message ||
            detail.error ||
            '';
        const expanded = extractNestedErrorsFromRaw(raw, invoiceLookup);
        if (expanded.length) {
            expanded.forEach((ex) => {
                const invoiceRef =
                    extra.invoiceRef ||
                    ex.invoiceRef ||
                    getInvoiceNumberForIndex(invoiceLookup, parseInvoiceContextFromText(raw).invoiceNum);
                items.push({ ...detail, ...ex, ...extra, ...(invoiceRef ? { invoiceRef } : {}) });
            });
        } else {
            const ctx = parseInvoiceContextFromText(
                detail.propertyPath || detail.target || raw
            );
            const invoiceRef =
                extra.invoiceRef ||
                getInvoiceNumberForIndex(invoiceLookup, ctx.invoiceNum);
            items.push({
                ...detail,
                ...extra,
                ...(invoiceRef ? { invoiceRef } : {}),
            });
        }
    };

    const rejected = lhdnData?.data?.rejectedDocuments;
    if (Array.isArray(rejected) && rejected.length) {
        rejected.forEach((doc, i) => {
            const invoiceRef =
                doc.invoiceCodeNumber ||
                doc.codeNumber ||
                getInvoiceNumberForIndex(invoiceLookup, i + 1) ||
                null;
            const errDetails = doc.error?.details;
            if (Array.isArray(errDetails) && errDetails.length) {
                errDetails.forEach((d) => pushDetail(d, invoiceRef ? { invoiceRef } : {}));
            } else if (doc.error) {
                pushDetail(doc.error, invoiceRef ? { invoiceRef } : {});
            }
        });
        return dedupeSubmissionIssues(items, invoiceLookup);
    }

    const errorObj = typeof lhdnData?.error === 'object' ? lhdnData.error : null;
    const details = errorObj?.details || lhdnData?.details || [];
    if (Array.isArray(details) && details.length) {
        details.forEach((d) => pushDetail(d));
    } else if (errorObj?.message) {
        pushDetail({
            message: errorObj.message,
            originalMessage: errorObj.message,
            userMessage: errorObj.userFriendlyMessage,
            guidance: errorObj.guidance,
        });
    } else if (typeof lhdnData?.error === 'string') {
        pushDetail({ message: lhdnData.error, originalMessage: lhdnData.error });
    }

    return dedupeSubmissionIssues(items, invoiceLookup);
}

function dedupeSubmissionIssues(items, invoiceLookup) {
    const seen = new Set();
    return items.filter((item) => {
        const friendly = toEndUserFriendlyDetail(item, invoiceLookup);
        const key = `${friendly.invoiceNumber || item.invoiceRef || ''}|${friendly.lineItemNum || ''}|${friendly.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isTechnicalLhdnText(text) {
    if (!text) return true;
    const t = String(text);
    return (
        /#\/Invoice|ArrayItemNotValid|propertyPath|object\s*\{|^\s*\{/i.test(t) ||
        (t.length > 140 && /[:#\/\[\]]/.test(t))
    );
}

function parseInvoiceContextFromText(text) {
    const src = String(text || '');
    const inv = src.match(/Invoice\[(\d+)\]/i);
    const line = src.match(/InvoiceLine\[(\d+)\]/i);
    return {
        invoiceNum: inv ? parseInt(inv[1], 10) + 1 : null,
        lineNum: line ? parseInt(line[1], 10) + 1 : null,
    };
}

function translateTechnicalLhdnMessage(raw, invoiceLookup) {
    const text = String(raw || '').trim();
    if (!text) {
        return 'LHDN could not accept part of your submission. Please review your Excel file.';
    }

    const codeMatch = text.match(/\b(CF\d{3}|DS\d{3}|ERR\d+)\b/i);
    if (codeMatch && LHDN_PLAIN_ERROR_MAP[codeMatch[1].toUpperCase()]) {
        return LHDN_PLAIN_ERROR_MAP[codeMatch[1].toUpperCase()];
    }

    if (/PropertyRequired/i.test(text)) {
        const nested = extractNestedErrorsFromRaw(text, invoiceLookup);
        if (nested.length === 1) return nested[0].userMessage;
        if (nested.length > 1) {
            return `MyInvois found ${nested.length} missing or invalid fields. See each item below.`;
        }
    }

    if (/ItemPriceExtension/i.test(text) && /Amount/i.test(text)) {
        const ctx = parseInvoiceContextFromText(text);
        const loc = formatInvoiceLocation(ctx, invoiceLookup, null);
        if (loc) {
            return `Amount (item price) is missing on ${loc}.`;
        }
        return 'Amount (item price) is missing for one of your line items.';
    }

    if (/ArrayItemNotValid|INVOICE_LINE|line item|InvoiceLine/i.test(text)) {
        const ctx = parseInvoiceContextFromText(text);
        const loc = formatInvoiceLocation(ctx, invoiceLookup, null);
        if (loc && ctx.lineNum) {
            return `Line item ${ctx.lineNum} on ${loc} is missing required information or has an invalid value.`;
        }
        if (loc) {
            return `${loc} is missing required information or has an invalid value.`;
        }
        return 'One or more line items in your Excel file are incomplete or invalid.';
    }

    if (/TIN|BuyerTIN|SupplierTIN/i.test(text)) {
        return 'A Tax Identification Number (TIN) may be wrong or missing. Verify buyer and supplier TIN in your file.';
    }

    if (isTechnicalLhdnText(text)) {
        const ctx = parseInvoiceContextFromText(text);
        const loc = formatInvoiceLocation(ctx, invoiceLookup, null);
        if (loc && ctx.lineNum) {
            return `Please check ${loc}, line item ${ctx.lineNum}, in your Excel file.`;
        }
        if (loc) {
            return `Please check ${loc} in your Excel file.`;
        }
        return 'LHDN found a problem in your Excel data. Open the file, fix the affected invoice, and upload again.';
    }

    return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function toEndUserFriendlyDetail(detail, invoiceLookup) {
    const normalized = normalizeSubmissionError(detail || {});
    const raw =
        detail?.originalMessage ||
        detail?.message ||
        normalized.originalMessage ||
        '';

    const nestedFromRaw = extractNestedErrorsFromRaw(raw, invoiceLookup);
    const nestedOne = nestedFromRaw.length === 1 ? nestedFromRaw[0] : null;

    let message =
        detail?.userMessage ||
        nestedOne?.userMessage ||
        detail?.userFriendlyMessage ||
        normalized.userMessage ||
        '';

    const fieldDesc =
        detail?.fieldDescription ||
        nestedOne?.fieldDescription ||
        normalized.fieldDescription ||
        '';

    if (isGenericLhdnUserMessage(message) && fieldDesc && !isGenericLhdnUserMessage(fieldDesc)) {
        message = fieldDesc;
    }

    if (!message || isTechnicalLhdnText(message) || isGenericLhdnUserMessage(message)) {
        message = translateTechnicalLhdnMessage(raw, invoiceLookup);
    }

    if (nestedOne && isGenericLhdnUserMessage(message)) {
        message = nestedOne.userMessage;
    }

    let guidance = [
        ...(detail?.guidance || nestedOne?.guidance || normalized.guidance || []),
    ].filter((g) => g && !isTechnicalLhdnText(g));

    if (!guidance.length) {
        guidance = nestedOne?.guidance?.length
            ? nestedOne.guidance
            : guidanceForLhdnField(detail?.propertyPath || raw);
    }

    const ctx = parseInvoiceContextFromText(
        detail?.propertyPath || detail?.target || raw
    );
    const invoiceNumber = resolveInvoiceNumberForDetail(detail, invoiceLookup);
    const lineItemNum = ctx.lineNum || null;

    const errorCode = detail?.errorCode || detail?.code || normalized.errorCode || '';
    const plainCodeLabel =
        errorCode && LHDN_PLAIN_ERROR_MAP[errorCode]
            ? errorCode
            : '';

    const fieldName =
        detail?.fieldName ||
        nestedOne?.fieldName ||
        (detail?.propertyPath ? String(detail.propertyPath).split('.').pop().replace(/\[\d+\]/g, '') : '');
    const primaryField = fieldName ? humanizeLhdnFieldName(fieldName) : '';

    return {
        message,
        guidance,
        invoiceNumber,
        lineItemNum,
        primaryField,
        errorCode: plainCodeLabel,
        technicalRaw: isTechnicalLhdnText(raw) ? raw : '',
    };
}

// Normalize error object into the requested structure
function normalizeSubmissionError(err){
  try{
    if(!err) return {};
    // Already in desired shape
    if (typeof err === 'object' && (err.errorCode || err.userMessage || err.guidance)) return err;

    // Some endpoints return { message, details:[{ errorCode, originalMessage, userMessage, guidance, fieldDescription }] }
    const firstDetail = Array.isArray(err?.details) ? err.details[0] : null;
    return {
      errorCode: err.errorCode || firstDetail?.errorCode || err.code || firstDetail?.code || '',
      originalMessage: err.originalMessage || firstDetail?.originalMessage || err.message || '',
      userMessage: err.userMessage || firstDetail?.userMessage || (err.message || 'There was a problem with your submission.'),
      guidance: err.guidance || firstDetail?.guidance || [],
      fieldDescription: err.fieldDescription || firstDetail?.fieldDescription || ''
    };
  }catch(_){ return { userMessage: 'There was a problem with your submission.' }; }
}

// Simple HTML escape to prevent DOM injection
function escapeHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function closeSubmissionFlowModal() {
  const el = document.getElementById('submissionFlowBackdrop'); if (el) el.remove();
  // Clean up tip rotator
  if (window.submissionTipRotator) {
    clearInterval(window.submissionTipRotator);
    window.submissionTipRotator = null;
  }
}

// Success modal with options and animated check
async function showSubmissionSuccessModal({ userMessage = 'Your submission has been successfully sent to LHDN for processing.', fieldDescription = '', guidance = [] } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'submission-flow-backdrop';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','sfSuccessTitle');
  overlay.setAttribute('aria-describedby','sfSuccessSub');
  const card = document.createElement('div');
  card.className = 'sf-submission-card';
  card.setAttribute('style','animation: sfv2-pop .34s cubic-bezier(.2,.9,.2,1) both; border-radius:16px; overflow:hidden; box-shadow:0 28px 64px rgba(2,6,23,.22), 0 2px 8px rgba(2,6,23,.08)');
  const inlineStyles = `
    <style id="sfV2SuccessStyles">
      /* Theme */
      [data-sfv2="success"]{ --brand:#405189; --brand-800:#2f3d6f; --ink:#0f172a; --muted:#64748b; --ring:#93c5fd; }
      /* Layout */
      .sfv2-header{ display:flex; align-items:center; gap:12px; padding:14px 18px; background:linear-gradient(180deg,var(--brand),var(--brand-800)); color:#e5edff; box-shadow:inset 0 -1px rgba(255,255,255,.05) }
      .sfv2-icon{ width:36px;height:36px; border-radius:10px; display:grid; place-items:center; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.16) }
      .sfv2-title{ font-size:20px; font-weight:800; letter-spacing:.2px; color:#fff }
      .sfv2-sub{ font-size:12px; color:#cbd5e1 }
      .sfv2-body{ padding:22px 26px 20px }
      .sfv2-footer{ display:flex; justify-content:center; gap:10px; padding:14px 22px 22px }
      /* Hero */
      .sfv2-hero{ display:flex; flex-direction:column; align-items:center; justify-content:center; margin:6px 0 8px }
      .sfv2-ring{ display:grid; place-items:center; width:96px; height:96px; border-radius:50%; background:radial-gradient(60% 60% at 50% 40%, rgba(147,197,253,.22), rgba(147,197,253,0) 60%); position:relative }
      .sfv2-ring::before{ content:''; position:absolute; inset:0; border-radius:50%; border:4px solid var(--brand); box-shadow:0 6px 24px rgba(0,0,0,.08) }
      .sfv2-check{ fill:none; stroke:var(--brand); stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation: sfv2-stroke .55s ease forwards }
      .sfv2-progress{ width:150px; height:6px; background:rgba(64,81,137,.12); border-radius:999px; overflow:hidden; margin-top:8px }
      .sfv2-progress > span{ display:block; height:100%; width:40%; background:linear-gradient(90deg,var(--brand),#6b7bb8); border-radius:inherit; animation: sfv2-progress 1.15s ease-in-out infinite }
      .sfv2-badge{ display:inline-flex; align-items:center; gap:6px; font-weight:600; color:#166534; background:#dcfce7; border:1px solid #86efac; padding:6px 12px; border-radius:999px; width:max-content; margin:0 auto 12px; font-size:13px }
      .sfv2-msg{ margin:12px 0; color:var(--ink); line-height:1.6 }
      .sfv2-desc{ color:#64748b; margin:0 0 12px }
      .sfv2-card{ border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; background:#fff }
      .sfv2-card-title{ font-weight:700; margin-bottom:6px }
      .sfv2-list{ padding-left:18px; margin:0; }
      /* Buttons */
      .sfv2-btn{ cursor:pointer; user-select:none; border:none; border-radius:10px; padding:10px 14px; font-weight:700; transition: box-shadow .2s ease, transform .15s ease, background-color .2s ease }
      .sfv2-btn-primary{ background:#ef4444; color:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08) }
      .sfv2-btn-primary:hover{ background:#dc2626; box-shadow:0 6px 18px rgba(0,0,0,.16); transform: translateY(-1px) }
      .sfv2-btn-primary:active{ transform: translateY(0) }
      .sfv2-btn-primary:focus{ outline:3px solid rgba(239,68,68,.35); outline-offset:2px }
      .sfv2-link{ color:var(--brand); text-decoration:underline }
      .sfv2-link:hover{ color:#1e3a8a }
      /* Animations */
      @keyframes sfv2-pop{ from { transform: translateY(8px) scale(.98); opacity:0 } to { transform: translateY(0) scale(1); opacity:1 } }
      @keyframes sfv2-stroke{ to { stroke-dashoffset:0 } }
      @keyframes sfv2-progress{ 0%{ transform:translateX(-110%) } 50%{ transform:translateX(20%) } 100%{ transform:translateX(130%) } }
      /* Responsive */
      @media (max-width: 640px){ .sfv2-body{ padding:18px 18px 16px } .sfv2-ring{ width:86px; height:86px } .sfv2-progress{ width:130px } }
      /* Reduced motion */
      @media (prefers-reduced-motion: reduce){ *{ animation: none !important } .sfv2-check{ stroke-dashoffset:0 !important } }
    </style>`;
  card.innerHTML = `
    ${inlineStyles}
    <div class="sfv2" data-sfv2="success">
      <div class="sfv2-header">
        <div class="sfv2-icon"><i class="bi bi-check2" style="font-size:18px;color:#e5edff"></i></div>
        <div><div class="sfv2-title" id="sfSuccessTitle">Submission Successful</div>
        <div class="sfv2-sub" id="sfSuccessSub">Please review the next steps below</div></div>
      </div>
      <div class="sfv2-body">
        <div class="sfv2-hero">
          <div class="sfv2-ring" role="img" aria-label="Success">
            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" style="width:42px;height:42px;display:block">
              <path class="sfv2-check" d="M14 24l7 7 13-16" />
            </svg>
          </div>
        </div>
        <div class="sfv2-badge" role="status"><i class="bi bi-check2-circle" style="color:#22c55e"></i> Successful</div>
        <div class="sfv2-msg">${userMessage}</div>
        ${fieldDescription ? `<div class=\"sfv2-desc\">${fieldDescription}</div>` : ''}
        ${guidance && guidance.length ? `
          <div class=\"sfv2-card\">
            <div class=\"sfv2-card-title\">Next steps</div>
            <ul class=\"sfv2-list\">${guidance.map(g => (typeof g === 'object' && g?.href) ? `<li><a class=\\\"sfv2-link\\\" href=\\\"${g.href}\\\" target=\\\"_blank\\\" rel=\\\"noopener\\\">${g.label || g.href}</a></li>` : `<li>${g}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
      <div class="sfv2-footer">
        <button id="closeSuccess" class="sfv2-btn sfv2-btn-primary">Close</button>
      </div>
    </div>`;
  overlay.appendChild(card); document.body.appendChild(overlay);
  return new Promise(res=> card.querySelector('#closeSuccess').addEventListener('click',()=>{ overlay.remove(); res(); }));
}

// Error modal with categorization and suggestions
async function showSubmissionErrorModal({ category='Validation Error', friendlyMessage='', suggestions=[], guidance=[], technical=null } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'submission-flow-backdrop';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','sfErrorTitle');
  overlay.setAttribute('aria-describedby','sfErrorSub');
  const card = document.createElement('div');
  card.className = 'sf-submission-card';
  card.setAttribute('style','animation: sfv2-pop .34s cubic-bezier(.2,.9,.2,1) both; border-radius:16px; overflow:hidden; box-shadow:0 28px 64px rgba(2,6,23,.22), 0 2px 8px rgba(2,6,23,.08)');
  const errInline = `
    <style id="sfV2ErrorStyles">
      /* Theme */
      [data-sfv2="error"]{ --brand:#405189; --brand-800:#2f3d6f; --ink:#0f172a; --muted:#64748b; --danger:#ef4444; --danger-700:#dc2626; --ring:#fecaca }
      /* Layout */
      .sfv2-header{ display:flex; align-items:center; gap:12px; padding:14px 18px; background:linear-gradient(180deg,var(--brand),var(--brand-800)); color:#e5edff; box-shadow:inset 0 -1px rgba(255,255,255,.05) }
      .sfv2-icon{ width:36px;height:36px; border-radius:10px; display:grid; place-items:center; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.16) }
      .sfv2-title{ font-size:20px; font-weight:800; letter-spacing:.2px; color:#fff }
      .sfv2-sub{ font-size:12px; color:#cbd5e1 }
      .sfv2-body{ padding:22px 26px 20px }
      .sfv2-footer{ display:flex; justify-content:center; gap:10px; padding:14px 22px 22px }
      /* Hero */
      .sfv2-hero{ display:flex; flex-direction:column; align-items:center; justify-content:center; margin:6px 0 8px }
      .sfv2-erring{ display:grid; place-items:center; width:96px; height:96px; border-radius:50%; background:radial-gradient(60% 60% at 50% 40%, rgba(254,202,202,.22), rgba(254,202,202,0) 60%); position:relative }
      .sfv2-erring::before{ content:''; position:absolute; inset:0; border-radius:50%; border:4px solid var(--danger); box-shadow:0 6px 24px rgba(0,0,0,.08) }
      .sfv2-x{ fill:none; stroke:var(--danger); stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation: sfv2-stroke .55s ease forwards }
      .sfv2-badge{ display:inline-flex; align-items:center; gap:6px; font-weight:600; color:#991b1b; background:#fee2e2; border:1px solid #fecaca; padding:6px 12px; border-radius:999px; width:max-content; margin:0 auto 12px; font-size:13px }
      .sfv2-chip{ display:inline-flex; align-items:center; gap:6px; font-weight:600; color:#7f1d1d; background:#fff1f2; border:1px solid #fecaca; padding:6px 10px; border-radius:999px; width:max-content }
      .sfv2-msg{ margin:12px 0; color:var(--ink); line-height:1.6 }
      .sfv2-desc{ color:#64748b; margin:0 0 12px }
      .sfv2-card{ border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; background:#fff }
      .sfv2-card-title{ font-weight:700; margin-bottom:6px }
      .sfv2-list{ padding-left:18px; margin:0 }
      .sfv2-tech-summary{ border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; background:#fff }
      .sfv2-tech-summary ul{ padding-left:18px; margin:6px 0 0 }
      /* Buttons */
      .sfv2-btn{ cursor:pointer; user-select:none; border:none; border-radius:10px; padding:10px 14px; font-weight:700; transition: box-shadow .2s ease, transform .15s ease, background-color .2s ease }
      .sfv2-btn-primary{ background:var(--danger); color:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08) }
      .sfv2-btn-primary:hover{ background:var(--danger-700); box-shadow:0 6px 18px rgba(0,0,0,.16); transform: translateY(-1px) }
      .sfv2-btn-primary:active{ transform: translateY(0) }
      .sfv2-btn-primary:focus{ outline:3px solid rgba(239,68,68,.35); outline-offset:2px }
      .sfv2-sec-btn{ background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:10px; padding:8px 12px; transition: background .2s ease, transform .15s ease }
      .sfv2-sec-btn:hover{ background:#111827; transform: translateY(-1px) }
      .sfv2-sec-btn:focus{ outline:3px solid rgba(147,197,253,.35); outline-offset:2px }
      .sfv2-link{ color:#93c5fd; text-decoration:underline }
      .sfv2-link:hover{ color:#60a5fa }
      .sfv2-code{ margin-top:8px; text-align:left; background:#0b1220; color:#cbd5e1; border:1px solid #334155; border-radius:10px; padding:10px; max-height:320px; overflow:auto; font-size:12px }
      .sfv2-tech-actions{ display:flex; gap:8px }
      /* Animations */
      @keyframes sfv2-pop{ from { transform: translateY(8px) scale(.98); opacity:0 } to { transform: translateY(0) scale(1); opacity:1 } }
      @keyframes sfv2-stroke{ to { stroke-dashoffset:0 } }
      /* Responsive */
      @media (max-width: 640px){ .sfv2-body{ padding:18px 18px 16px } .sfv2-erring{ width:86px; height:86px } }
      /* Reduced motion */
      @media (prefers-reduced-motion: reduce){ *{ animation: none !important } .sfv2-x{ stroke-dashoffset:0 !important } }
    </style>`;
  const fixes = (suggestions && suggestions.length) ? suggestions : ((!technical && guidance && guidance.length) ? guidance : []);
  const norm = technical ? normalizeSubmissionError(technical) : null;
  const techSummary = norm ? `
    <div class=\"sfv2-tech-summary\">
      ${norm.userMessage ? `<div><strong>Description:</strong> ${escapeHtml(norm.userMessage)}</div>` : ''}
      ${norm.fieldDescription ? `<div style=\"margin-top:6px\"><strong>Context:</strong> ${escapeHtml(norm.fieldDescription)}</div>` : ''}
      ${Array.isArray(norm.guidance) && norm.guidance.length ? `<div style=\"margin-top:8px\"><strong>Steps:</strong><ul class=\"sfv2-list\">${norm.guidance.map(g=>`<li>${escapeHtml(g)}</li>`).join('')}</ul></div>` : ''}
    </div>` : '';
  card.innerHTML = `
    ${errInline}
    <div class="sfv2" data-sfv2="error">
      <div class="sfv2-header">
        <div class="sfv2-icon"><i class="bi bi-x-octagon" style="font-size:18px;color:#e5edff"></i></div>
        <div><div class="sfv2-title" id="sfErrorTitle">Submission Failed</div>
        <div class="sfv2-sub" id="sfErrorSub">Please review the errors below</div></div>
      </div>
      <div class="sfv2-body">
        <div class="sfv2-hero">
          <div class="sfv2-erring" role="img" aria-label="Error">
            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" style="width:42px;height:42px;display:block">
              <path class="sfv2-x" d="M16 16 L32 32 M32 16 L16 32" />
            </svg>
          </div>
        </div>
        <div class="sfv2-badge"><i class="bi bi-x-circle-fill" style="color:#ef4444"></i> Failed</div>
        <div class="sfv2-chip"><i class="bi bi-exclamation-triangle"></i> ${category}</div>
        ${norm && (norm.invoiceNumber || (technical && technical.invoiceNumber)) ? `
          <div class=\"sfv2-card\" style=\"margin-top:10px\">
            <div class=\"sfv2-card-title\">Document</div>
            <div>${escapeHtml(norm.invoiceNumber || (technical && technical.invoiceNumber) || '')}</div>
          </div>
        ` : ''}
        ${technical ? `
          <div style=\"display:flex; align-items:center; justify-content:space-between; margin-top:10px; margin-bottom:8px\">
            <div class=\"sfv2-card-title\">Technical details</div>
            <div class=\"sfv2-tech-actions\">
              <button id=\"errToggle\" class=\"sfv2-sec-btn\" aria-expanded=\"false\" aria-controls=\"errDetails\">View</button>
              <button id=\"copyErr\" class=\"sfv2-sec-btn\" title=\"Copy details\">Copy</button>
            </div>
          </div>
          ${techSummary}
          <pre id=\"errDetails\" class=\"sfv2-code\" style=\"display:none; margin-top:8px\"></pre>
        ` : ''}
        <div class=\"sfv2-msg\">${friendlyMessage || "We couldn't complete your submission. Review the details above for what went wrong and how to fix it."}</div>
        ${fixes && fixes.length ? `
          <div class=\"sfv2-card\">
            <div class=\"sfv2-card-title\">How to fix</div>
            <ul class=\"sfv2-list\">${fixes.map(s => (typeof s === 'object' && s?.href) ? `<li><a class=\\\"sfv2-link\\\" href=\\\"${s.href}\\\" target=\\\"_blank\\\" rel=\\\"noopener\\\">${s.label || s.href}</a></li>` : `<li>${s}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
      <div class="sfv2-footer"><button id="closeError" class="sfv2-btn sfv2-btn-primary">Close</button></div>
    </div>`;
  overlay.appendChild(card); document.body.appendChild(overlay);

  // Interactions
  if (technical) {
    const t = card.querySelector('#errToggle');
    const p = card.querySelector('#errDetails');
    const cpy = card.querySelector('#copyErr');
    const detailsText = typeof technical === 'string' ? technical : JSON.stringify(technical, null, 2);
    p.textContent = detailsText;
    t.addEventListener('click',()=>{
      const shown = p.style.display === 'block';
      p.style.display = shown ? 'none' : 'block';
      t.setAttribute('aria-expanded', String(!shown));
      t.textContent = shown ? 'View' : 'Hide';
    });
    if (cpy) cpy.addEventListener('click', async ()=>{
      try {
        await navigator.clipboard.writeText(p.textContent || detailsText);
        if (window.toastNotification?.success) {
          window.toastNotification.success('Copied', 'Technical details copied to clipboard', 3000);
        } else {
          console.log('Technical details copied to clipboard');
        }
      } catch (e) {
        if (window.toastNotification?.error) {
          window.toastNotification.error('Copy Failed', 'Unable to copy technical details', 5000);
        } else {
          console.warn('Unable to copy technical details');
        }
      }
    });
  }

  // Accessibility helpers
  const closeBtn = card.querySelector('#closeError');
  if (closeBtn) closeBtn.focus();
  const onKey = (e)=>{ if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  return new Promise(res=> closeBtn.addEventListener('click',()=>{ overlay.remove(); document.removeEventListener('keydown', onKey); res(); }));
}

function mapLhdnErrorToFriendly(error) {
  try {
    const code = error?.code || error?.error?.code || (Array.isArray(error?.details) && error.details[0]?.code) || '';
    const msg = error?.message || error?.error?.message || '';
    const details = error?.details || error?.error?.details || [];
    // Categories and suggestions
    const suggestions = [];
    let category = 'System Error';
    let friendly = msg || 'An unexpected error occurred during submission.';

    const lc = (code||'').toString().toUpperCase();
    if (lc.includes('TIN') || msg.toLowerCase().includes('tin')) {
      category = 'Validation Error: TIN mismatch';
      friendly = 'The supplier TIN in the document does not match the authenticated TIN.';
      suggestions.push('Ensure the AccountingSupplierParty TIN matches your configured/company TIN.');
      suggestions.push('If acting as an intermediary, configure onbehalfof correctly and use the right token.');
    } else if ((details||[]).some(d=>/state code|CountrySubentityCode/i.test(d.message||''))) {
      category = 'Validation Error: State Code';
      friendly = 'State must be the official 2-digit code (e.g., Kuala Lumpur = 14).';
      suggestions.push('Use official state codes: https://sdk.myinvois.hasil.gov.my/codes/state-codes/');
      suggestions.push('Update your Excel column that maps to CountrySubentityCode to use the code.');
    } else if (lc.includes('DUPLICATE') || /duplicate/i.test(msg)) {
      category = 'Duplicate Submission';
      friendly = 'LHDN reports this document was already submitted.';
      suggestions.push('Check if this invoice was previously submitted.');
      suggestions.push('If needed, cancel/void the earlier document per LHDN guidelines.');
    } else if (/429|rate limit|too many/i.test(msg)) {
      category = 'Rate Limited';
      friendly = 'Too many requests in a short time. Please try again shortly.';
      suggestions.push('Wait for Retry-After seconds and retry.');
    } else if (/network|timeout|gateway|fetch/i.test(msg)) {
      category = 'Network Issue';
      friendly = 'We had trouble contacting LHDN. Please try again.';
      suggestions.push('Check your internet connection and try again.');
    } else if (lc === 'PRE_SUBMISSION_VALIDATION_FAILED' || /pre-?submission/i.test(msg)) {
      category = 'Validation Needed';
      friendly = 'Some details need correction before we can submit. No data was sent to LHDN yet.';
      suggestions.push('Review the highlighted issues and correct the Excel data.');
      suggestions.push('Use Search TIN to verify Buyer TIN where applicable.');
      suggestions.push('Re-upload the corrected file and submit again.');
    } else {
      category = 'Submission Error';
      friendly = msg || 'Submission failed. Review the details above for steps to resolve the issue.';
    }
    return { category, friendlyMessage: friendly, suggestions, technical: error };
  } catch(e) {
    return { category: 'Submission Error', friendlyMessage: 'Submission failed. Review the details above for steps to resolve the issue.', suggestions: [], technical: error };
  }
}

// Global refresh helper
function refreshOutboundTable() {
    // Invalidate cache to force fresh data
    dataCache.invalidateCache();
    // Refresh the table
    if (window.invoiceTableManager && window.invoiceTableManager.table) {
        window.invoiceTableManager.table.ajax.reload();
    }
}

// Global loading backdrop helpers (reused across manual outbound actions)
function showLoadingBackdrop(message = 'Processing...') {
    const existing = document.getElementById('loadingBackdrop');
    if (existing) existing.remove();
    const wrapper = document.createElement('div');
    wrapper.id = 'loadingBackdrop';
    wrapper.className = 'excel-loading-backdrop';
    wrapper.innerHTML = `
        <div class="excel-loading-content">
            <div class="excel-modal-header">
                <div class="excel-processing-icon">
                    <div class="excel-processing-pulse"></div>
                    <i class="bi bi-cloud-upload"></i>
                </div>
                <h5 class="excel-processing-title">${message}</h5>
                <p class="excel-processing-subtitle">Please wait...</p>
            </div>
            <div class="excel-modal-body">
                <div class="excel-loading-indicator">
                    <div class="excel-spinner"></div>
                    <div class="excel-progress-text">Working</div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(wrapper);
}

function hideLoadingBackdrop() {
    const existing = document.getElementById('loadingBackdrop');
    if (existing) existing.remove();
}


// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing components');

    // Debug: Check if preview button exists
    const previewBtn = document.getElementById('previewFileBtn');
    console.log('Preview button found on DOM load:', !!previewBtn);
    if (previewBtn) {
        console.log('Preview button element:', previewBtn);
    }

    // Initialize date/time display
    DateTimeManager.updateDateTime();

    // Initialize file upload manager
    try {
        window.fileUploadManager = new FileUploadManager();
        console.log('FileUploadManager initialized successfully');
    } catch (error) {
        console.error('Error initializing FileUploadManager:', error);
    }

    // Initialize table manager
    try {
        window.invoiceTableManager = InvoiceTableManager.getInstance();
        window.outboundManualExcel = window.invoiceTableManager; // Alias for modal functions
        console.log('InvoiceTableManager initialized successfully');
    } catch (error) {
        console.error('Error initializing InvoiceTableManager:', error);
    }

    // Initialize uploaded files manager
    try {
        window.uploadedFilesManager = new UploadedFilesManager();
        window.outboundManualManager = window.uploadedFilesManager; // Add global reference for modal functions
        console.log('UploadedFilesManager initialized successfully');
    } catch (error) {
        console.error('Error initializing UploadedFilesManager:', error);
    }
});

// Global checkbox change handler for bulk actions
window.handleCheckboxChange = function(event) {
    const checkbox = event.target;
    const row = checkbox.closest('tr');
    if (row && row.id && window.uploadedFilesManager) {
        const fileId = row.id.replace('file_', '');
        window.uploadedFilesManager.handleRowSelection(checkbox, fileId);
    }
};

// Global validation error modal functions
window.downloadValidationErrorReport = function() {
    const errorData = window.currentValidationErrorData;
    if (!errorData) {
        console.error('No validation error data available');
        return;
    }

    if (window.uploadedFilesManager && typeof window.uploadedFilesManager.downloadValidationErrorReport === 'function') {
        window.uploadedFilesManager.downloadValidationErrorReport(errorData);
    } else {
        console.error('downloadValidationErrorReport function not available');
    }
};

window.closeValidationErrorModal = function() {
    if (window.uploadedFilesManager && typeof window.uploadedFilesManager.closeValidationErrorModal === 'function') {
        window.uploadedFilesManager.closeValidationErrorModal();
    } else {
        console.error('closeValidationErrorModal function not available');
    }

    // Clear stored error data
    window.currentValidationErrorData = null;
};

// Global pre-validation error modal functions
window.closePreValidationErrorModal = function() {
    const modal = document.getElementById('preValidationErrorBackdrop');
    if (modal) {
        modal.remove();
    }

    // Remove styles
    const styles = document.getElementById('preValidationErrorModalStyles');
    if (styles) {
        styles.remove();
    }

    // Clear stored error data
    window.currentValidationErrorData = null;
};

// Add CSS styles for enhanced loading modal
(function addLoadingModalStyles() {
    if (document.getElementById('excel-loading-styles')) return; // Prevent duplicate styles

    const style = document.createElement('style');
    style.id = 'excel-loading-styles';
    style.textContent = `
        /* Excel Loading Backdrop Styles */
        .excel-loading-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .excel-loading-content {
            background-color: #fff;
            border-radius: 10px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
            overflow: hidden;
        }

        .excel-modal-header {
            background: #405189;
            padding: 1.25rem;
            position: relative;
            overflow: hidden;
        }

        .excel-processing-icon {
            position: relative;
            width: 50px;
            height: 50px;
            margin: 0 auto 1rem;
        }

        .excel-processing-pulse {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            animation: excel-pulse 2s ease-in-out infinite;
        }

        .excel-processing-icon i {
            position: relative;
            font-size: 1.75rem;
            color: white;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
        }

        .excel-processing-title {
            margin-bottom: 1rem;
            text-align: center;
            color: white;
        }

        .excel-processing-title h5 {
            font-size: 1.1rem;
            margin-bottom: 1rem;
        }

        .excel-processing-title p {
            opacity: 0.8;
            margin: 0;
            font-size: 0.9rem;
        }

        /* Document Stack Animation */
        .excel-document-stack {
            position: relative;
            width: 50px;
            height: 65px;
            margin: 0 auto 0.5rem;
        }

        .excel-document {
            position: absolute;
            width: 100%;
            height: 80%;
            background: white;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }

        .excel-doc1 { transform: translateY(-5px) rotate(-5deg); }
        .excel-doc2 { transform: translateY(0px); }
        .excel-doc3 { transform: translateY(5px) rotate(5deg); }

        .excel-document-stack:hover .excel-doc1 { transform: translateY(-10px) rotate(-8deg); }
        .excel-document-stack:hover .excel-doc3 { transform: translateY(10px) rotate(8deg); }

        /* Processing Circle Animation */
        .excel-processing-circle {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 30px;
            height: 30px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            animation: excel-spin 1s linear infinite;
        }

        /* Invoice Paper Animation */
        .excel-processing-container {
            padding: 1rem 1.5rem;
            text-align: center;
        }

        .excel-invoice-animation {
            position: relative;
            width: 300px;
            height: 120px;
            margin: 0 auto 0.5rem;
        }

        .excel-invoice-paper {
            position: relative;
            width: 100%;
            height: 100%;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            padding: 20px;
            animation: excel-float 3s ease-in-out infinite;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .excel-invoice-line {
            height: 8px;
            background: #f0f2f5;
            margin-bottom: 12px;
            border-radius: 2px;
            animation: excel-scan 2s ease-in-out infinite;
        }

        .excel-invoice-line:nth-child(1) { width: 60%; }
        .excel-invoice-line:nth-child(2) { width: 85%; }
        .excel-invoice-line:nth-child(3) { width: 70%; }

        .excel-invoice-stamp {
            position: absolute;
            bottom: 20px;
            right: 20px;
            width: 40px;
            height: 40px;
            border: 2px solid #22389E;
            border-radius: 50%;
            opacity: 0;
            animation: excel-stamp 3s ease-in-out infinite;
        }

        /* Processing Steps */
        .excel-processing-steps {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }

        .excel-step-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.25rem;
            color: #22389E;
            opacity: 0.5;
            transition: all 0.3s ease;
            font-size: 0.9rem;
        }

        .excel-step-item.excel-active {
            opacity: 1;
            transform: scale(1.1);
        }

        .excel-step-arrow {
            color: #22389E;
            opacity: 0.3;
        }

        /* Progress Section */
        .excel-progress-section {
            padding: 1rem 1.5rem;
            background: rgba(34, 56, 158, 0.02);
        }

        .excel-progress-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
        }

        .excel-document-count {
            font-size: 0.9rem;
            color: #22389E;
        }

        .excel-progress {
            height: 8px;
            border-radius: 4px;
            background: rgba(34, 56, 158, 0.1);
            overflow: hidden;
        }

        .excel-progress-bar {
            background: #405189;
            box-shadow: 0 0 10px rgba(34, 56, 158, 0.3);
            height: 100%;
            width: 0%;
        }

        /* Processing Status */
        .excel-processing-status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            margin: 0.75rem 0;
            padding: 0.75rem;
            background: rgba(34, 56, 158, 0.05);
            border-radius: 8px;
        }

        .excel-status-icon {
            color: #22389E;
        }

        .excel-status-text {
            color: #22389E;
            font-weight: 500;
        }

        /* Info Box */
        .excel-processing-info {
            padding: 1rem 1.5rem;
            background: rgba(34, 56, 158, 0.02);
            border-top: 1px solid rgba(34, 56, 158, 0.05);
        }

        .excel-info-box {
            display: flex;
            gap: 0.75rem;
            padding: 0.75rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(34, 56, 158, 0.05);
        }

        .excel-info-icon {
            color: #22389E;
            font-size: 1.2rem;
        }

        .excel-info-label {
            display: block;
            color: #22389E;
            font-weight: 600;
            font-size: 0.9rem;
            margin-bottom: 0.2rem;
        }

        .excel-info-message {
            margin: 0;
            color: #4A5568;
            font-size: 0.9rem;
            line-height: 1.4;
        }

        /* Animation for spin */
        .excel-spin {
            animation: excel-spin 1s linear infinite;
        }

        /* Animations */
        @keyframes excel-pulse {
            0% { transform: scale(0.95); opacity: 0.5; }
            50% { transform: scale(1.05); opacity: 0.2; }
            100% { transform: scale(0.95); opacity: 0.5; }
        }

        @keyframes excel-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @keyframes excel-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }

        @keyframes excel-scan {
            0% {
                transform: translateX(-100%);
                opacity: 0;
            }
            50% {
                transform: translateX(0);
                opacity: 1;
            }
            100% {
                transform: translateX(100%);
                opacity: 0;
            }
        }

        @keyframes excel-stamp {
            0%, 100% { opacity: 0; transform: scale(0.8) rotate(-10deg); }
            50% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
    `;
    document.head.appendChild(style);
})();

