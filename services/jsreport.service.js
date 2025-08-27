let jsreportInstance = null;

const initJsReport = async () => {
  try {
    const jsreport = require('jsreport-core')();

    // Add extensions
    jsreport.use(require('jsreport-jsrender')());

    // Try to add chrome-pdf with better error handling
    try {
      const chromePdf = require('jsreport-chrome-pdf');
      jsreport.use(chromePdf({
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ],
          headless: 'new',
          executablePath: process.env.PUPPETEER_CHROMIUM_EXECUTABLE_PATH || undefined
        },
        strategy: 'dedicated-process',
        timeout: 60000
      }));
      console.log('chrome-pdf extension loaded successfully');
    } catch (chromePdfError) {
      console.error('Failed to load chrome-pdf extension:', chromePdfError.message);
      throw chromePdfError;
    }

    await jsreport.init();
    console.log('jsreport initialized successfully');

    // Store the initialized instance
    jsreportInstance = jsreport;
    return jsreport;
  } catch (error) {
    console.error('Error initializing jsreport:', error);
    throw error;
  }
};

const getJsReport = () => {
  if (!jsreportInstance) {
    throw new Error('jsreport not initialized. Call initJsReport() first.');
  }
  return jsreportInstance;
};

module.exports = {
  initJsReport,
  getJsReport,
  // For backward compatibility
  get jsreport() {
    return getJsReport();
  }
};