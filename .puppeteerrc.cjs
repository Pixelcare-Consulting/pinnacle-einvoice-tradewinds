/**
 * Skip bundled browser downloads during install.
 * PDF generation uses system Chrome via PUPPETEER_CHROMIUM_EXECUTABLE_PATH.
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  chrome: {
    skipDownload: true,
  },
  firefox: {
    skipDownload: true,
  },
};
