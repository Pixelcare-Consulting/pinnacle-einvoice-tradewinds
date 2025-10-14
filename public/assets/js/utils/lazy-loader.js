/**
 * Lazy Loading Module
 * Dynamically loads JavaScript modules only when needed
 */

(function(window) {
  'use strict';

  // Cache for loaded modules
  const loadedModules = new Set();
  const loadingModules = new Map();

  /**
   * Load a script dynamically
   * @param {string} src - Script URL
   * @param {Object} options - Loading options
   * @returns {Promise}
   */
  function loadScript(src, options = {}) {
    // Return cached promise if already loading
    if (loadingModules.has(src)) {
      return loadingModules.get(src);
    }

    // Return resolved promise if already loaded
    if (loadedModules.has(src)) {
      return Promise.resolve();
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = options.async !== false;
      script.defer = options.defer === true;

      if (options.integrity) {
        script.integrity = options.integrity;
        script.crossOrigin = 'anonymous';
      }

      script.onload = () => {
        loadedModules.add(src);
        loadingModules.delete(src);
        console.log(`✅ Loaded: ${src}`);
        resolve();
      };

      script.onerror = () => {
        loadingModules.delete(src);
        const error = new Error(`Failed to load script: ${src}`);
        console.error(error);
        reject(error);
      };

      document.head.appendChild(script);
    });

    loadingModules.set(src, promise);
    return promise;
  }

  /**
   * Load a CSS file dynamically
   * @param {string} href - CSS URL
   * @returns {Promise}
   */
  function loadCSS(href) {
    if (loadedModules.has(href)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;

      link.onload = () => {
        loadedModules.add(href);
        console.log(`✅ Loaded CSS: ${href}`);
        resolve();
      };

      link.onerror = () => {
        const error = new Error(`Failed to load CSS: ${href}`);
        console.error(error);
        reject(error);
      };

      document.head.appendChild(link);
    });
  }

  /**
   * Load multiple resources in parallel
   * @param {Array} resources - Array of resource URLs
   * @param {Object} options - Loading options
   * @returns {Promise}
   */
  function loadMultiple(resources, options = {}) {
    const promises = resources.map(resource => {
      if (resource.endsWith('.css')) {
        return loadCSS(resource);
      } else {
        return loadScript(resource, options);
      }
    });

    return Promise.all(promises);
  }

  /**
   * Lazy load a module when it's needed
   * @param {string} moduleName - Name of the module
   * @param {Array|string} resources - Resource(s) to load
   * @returns {Promise}
   */
  function lazyLoad(moduleName, resources) {
    console.log(`🔄 Lazy loading module: ${moduleName}`);

    if (typeof resources === 'string') {
      resources = [resources];
    }

    return loadMultiple(resources)
      .then(() => {
        console.log(`✨ Module loaded: ${moduleName}`);
      })
      .catch(error => {
        console.error(`❌ Failed to load module ${moduleName}:`, error);
        throw error;
      });
  }

  /**
   * Preload resources for faster loading later
   * @param {Array} resources - Resources to preload
   */
  function preload(resources) {
    if (typeof resources === 'string') {
      resources = [resources];
    }

    resources.forEach(resource => {
      const link = document.createElement('link');
      link.rel = 'preload';
      
      if (resource.endsWith('.js')) {
        link.as = 'script';
      } else if (resource.endsWith('.css')) {
        link.as = 'style';
      } else if (/\.(woff|woff2|ttf|otf)$/i.test(resource)) {
        link.as = 'font';
        link.crossOrigin = 'anonymous';
      } else if (/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(resource)) {
        link.as = 'image';
      }
      
      link.href = resource;
      document.head.appendChild(link);
    });
  }

  /**
   * Load Chart.js only when needed
   */
  function loadChartJS() {
    if (window.Chart) {
      return Promise.resolve();
    }

    return loadScript('https://cdn.jsdelivr.net/npm/chart.js', {
      async: true
    });
  }

  /**
   * Load Excel modules only when needed
   */
  function loadExcelModule(moduleName) {
    const excelModules = {
      'inbound': '/assets/js/modules/excel/inbound-excel.js',
      'outbound': '/assets/js/modules/excel/outbound-excel.js',
      'manual': '/assets/js/modules/excel/outbound-manual.js',
      'consolidate': '/assets/js/modules/excel/outbound-consolidate.js'
    };

    const modulePath = excelModules[moduleName];
    if (!modulePath) {
      return Promise.reject(new Error(`Unknown Excel module: ${moduleName}`));
    }

    return lazyLoad(`excel-${moduleName}`, modulePath);
  }

  /**
   * Load admin modules only for admin users
   */
  function loadAdminModule(moduleName) {
    const adminModules = {
      'security': '/assets/js/admin/security-dashboard.js'
    };

    const modulePath = adminModules[moduleName];
    if (!modulePath) {
      return Promise.reject(new Error(`Unknown admin module: ${moduleName}`));
    }

    return lazyLoad(`admin-${moduleName}`, modulePath);
  }

  /**
   * Setup lazy loading for elements with data-lazy attribute
   */
  function setupAutoLazyLoad() {
    const lazyElements = document.querySelectorAll('[data-lazy]');
    
    lazyElements.forEach(element => {
      const moduleName = element.getAttribute('data-lazy');
      const trigger = element.getAttribute('data-lazy-trigger') || 'click';
      
      element.addEventListener(trigger, async function handler(e) {
        try {
          // Show loading indicator
          const originalText = element.textContent;
          if (element.tagName === 'BUTTON') {
            element.disabled = true;
            element.textContent = 'Loading...';
          }
          
          // Load the module
          await lazyLoad(moduleName, element.getAttribute('data-lazy-src'));
          
          // Restore button state
          if (element.tagName === 'BUTTON') {
            element.disabled = false;
            element.textContent = originalText;
          }
          
          // Remove the handler after first load
          element.removeEventListener(trigger, handler);
          
          // Re-trigger the event to execute the now-loaded code
          if (trigger === 'click') {
            element.click();
          }
        } catch (error) {
          console.error('Failed to lazy load:', error);
          if (element.tagName === 'BUTTON') {
            element.disabled = false;
            element.textContent = 'Error - Retry';
          }
        }
      });
    });
  }

  /**
   * Check if a module is loaded
   */
  function isLoaded(src) {
    return loadedModules.has(src);
  }

  /**
   * Clear the loaded modules cache
   */
  function clearCache() {
    loadedModules.clear();
    loadingModules.clear();
  }

  // Initialize auto lazy loading when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAutoLazyLoad);
  } else {
    setupAutoLazyLoad();
  }

  // Export API
  window.LazyLoader = {
    load: lazyLoad,
    loadScript,
    loadCSS,
    loadMultiple,
    preload,
    loadChartJS,
    loadExcelModule,
    loadAdminModule,
    isLoaded,
    clearCache,
    setup: setupAutoLazyLoad
  };

  console.log('✨ LazyLoader initialized');

})(window);

