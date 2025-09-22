/**
 * Enhanced PDF Generation Service with Multiple Fallback Options
 * Handles EACCES permission errors and provides alternative PDF generation methods
 */

const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const { getJsReport } = require('./jsreport.service');

class PDFGenerationService {
  constructor() {
    this.methods = ['puppeteer', 'jsreport', 'html-pdf'];
    this.currentMethod = 'puppeteer';
    this.failedMethods = new Set();
  }

  /**
   * Generate PDF with automatic fallback between methods
   */
  async generatePDF(html, options = {}) {
    const { requestId = 'unknown', uuid, outputPath } = options;
    
    console.log(`[${requestId}] Starting PDF generation for ${uuid}`);
    
    for (const method of this.methods) {
      if (this.failedMethods.has(method)) {
        console.log(`[${requestId}] Skipping failed method: ${method}`);
        continue;
      }

      try {
        console.log(`[${requestId}] Attempting PDF generation with: ${method}`);
        const result = await this._generateWithMethod(method, html, options);
        console.log(`[${requestId}] PDF generated successfully with: ${method}`);
        return result;
      } catch (error) {
        console.error(`[${requestId}] PDF generation failed with ${method}:`, error.message);
        
        // Mark method as failed if it's a permission or critical error
        if (this._isCriticalError(error)) {
          this.failedMethods.add(method);
          console.log(`[${requestId}] Marking ${method} as permanently failed`);
        }
      }
    }

    throw new Error('All PDF generation methods failed');
  }

  /**
   * Generate PDF using specific method
   */
  async _generateWithMethod(method, html, options) {
    switch (method) {
      case 'puppeteer':
        return await this._generateWithPuppeteer(html, options);
      case 'jsreport':
        return await this._generateWithJSReport(html, options);
      case 'html-pdf':
        return await this._generateWithHtmlPdf(html, options);
      default:
        throw new Error(`Unknown PDF generation method: ${method}`);
    }
  }

  /**
   * Puppeteer PDF generation with enhanced Windows support
   */
  async _generateWithPuppeteer(html, options) {
    const { requestId = 'unknown' } = options;
    
    // Windows-optimized launch options
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-software-rasterizer',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--single-process', // Important for Windows permission issues
      ],
      timeout: 120000,
      dumpio: false,
      ignoreDefaultArgs: ['--disable-extensions'],
    };

    // Try different Chrome executables
    const chromeExecutables = [
      process.env.PUPPETEER_CHROMIUM_EXECUTABLE_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);

    let browser = null;
    let lastError = null;

    // Try bundled Chrome first (usually has better permissions)
    try {
      console.log(`[${requestId}] Trying bundled Chrome...`);
      browser = await puppeteer.launch(launchOptions);
      console.log(`[${requestId}] Bundled Chrome launched successfully`);
    } catch (error) {
      console.log(`[${requestId}] Bundled Chrome failed: ${error.message}`);
      lastError = error;

      // Try system Chrome installations
      for (const executable of chromeExecutables) {
        try {
          console.log(`[${requestId}] Trying Chrome at: ${executable}`);
          await fs.access(executable, fs.constants.F_OK | fs.constants.X_OK);
          
          const options = { ...launchOptions, executablePath: executable };
          browser = await puppeteer.launch(options);
          console.log(`[${requestId}] System Chrome launched: ${executable}`);
          break;
        } catch (execError) {
          console.log(`[${requestId}] Chrome at ${executable} failed: ${execError.message}`);
          lastError = execError;
        }
      }
    }

    if (!browser) {
      throw new Error(`Failed to launch any Chrome browser. Last error: ${lastError?.message}`);
    }

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
        timeout: 60000,
      });

      await browser.close();
      return pdfBuffer;
    } catch (error) {
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error(`[${requestId}] Error closing browser:`, closeError.message);
        }
      }
      throw error;
    }
  }

  /**
   * JSReport PDF generation (fallback method)
   */
  async _generateWithJSReport(html, options) {
    const { requestId = 'unknown' } = options;
    
    try {
      const jsreport = getJsReport();
      
      const result = await jsreport.render({
        template: {
          content: html,
          engine: 'none',
          recipe: 'chrome-pdf',
          chrome: {
            format: 'A4',
            printBackground: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
          }
        }
      });

      return result.content;
    } catch (error) {
      console.error(`[${requestId}] JSReport PDF generation failed:`, error.message);
      throw new Error(`JSReport PDF generation failed: ${error.message}`);
    }
  }

  /**
   * HTML-PDF generation (last resort fallback)
   */
  async _generateWithHtmlPdf(html, options) {
    const { requestId = 'unknown' } = options;
    
    try {
      // This would require installing html-pdf package
      // For now, throw an error indicating it's not implemented
      throw new Error('HTML-PDF method not implemented. Install html-pdf package if needed.');
    } catch (error) {
      console.error(`[${requestId}] HTML-PDF generation failed:`, error.message);
      throw error;
    }
  }

  /**
   * Check if error is critical and method should be disabled
   */
  _isCriticalError(error) {
    const criticalErrors = [
      'EACCES',
      'ENOENT',
      'Failed to launch the browser process',
      'spawn EACCES',
      'Permission denied'
    ];

    return criticalErrors.some(criticalError => 
      error.message.includes(criticalError) || error.code === criticalError
    );
  }

  /**
   * Reset failed methods (for testing or recovery)
   */
  resetFailedMethods() {
    this.failedMethods.clear();
    console.log('PDF generation methods reset');
  }

  /**
   * Get current status of PDF generation methods
   */
  getStatus() {
    return {
      availableMethods: this.methods,
      failedMethods: Array.from(this.failedMethods),
      currentMethod: this.currentMethod
    };
  }
}

module.exports = new PDFGenerationService();
