const NodeCache = require('node-cache');

/**
 * Response Cache Middleware
 * Caches API responses to reduce database queries and improve performance
 */

// Create cache instances with different TTL
const caches = {
  short: new NodeCache({ stdTTL: 120, checkperiod: 60 }), // 2 minutes
  medium: new NodeCache({ stdTTL: 300, checkperiod: 120 }), // 5 minutes
  long: new NodeCache({ stdTTL: 600, checkperiod: 300 }), // 10 minutes
  veryLong: new NodeCache({ stdTTL: 1800, checkperiod: 600 }), // 30 minutes
};

/**
 * Generate cache key from request
 */
function generateCacheKey(req) {
  const userId = req.session?.user?.id || 'anonymous';
  const companyId = req.session?.user?.company_id || 'nocompany';
  const path = req.path;
  const query = JSON.stringify(req.query || {});
  
  return `${userId}:${companyId}:${path}:${query}`;
}

/**
 * Cache middleware factory
 * @param {string} cacheDuration - 'short', 'medium', 'long', 'veryLong'
 * @param {function} keyGenerator - Optional custom key generator
 */
function cacheResponse(cacheDuration = 'medium', keyGenerator = null) {
  const cache = caches[cacheDuration];
  
  if (!cache) {
    console.warn(`Invalid cache duration: ${cacheDuration}. Defaulting to medium.`);
    cacheDuration = 'medium';
  }

  return (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const cacheKey = keyGenerator ? keyGenerator(req) : generateCacheKey(req);
    
    // Check if response is cached
    const cachedResponse = cache.get(cacheKey);
    
    if (cachedResponse) {
      // Return cached response
      res.set('X-Cache', 'HIT');
      res.set('X-Cache-Duration', cacheDuration);
      return res.json(cachedResponse);
    }

    // Store original res.json
    const originalJson = res.json.bind(res);

    // Override res.json to cache the response
    res.json = function(data) {
      // Only cache successful responses
      if (data && (!data.success || data.success === true)) {
        cache.set(cacheKey, data);
      }
      
      res.set('X-Cache', 'MISS');
      res.set('X-Cache-Duration', cacheDuration);
      return originalJson(data);
    };

    next();
  };
}

/**
 * Invalidate cache for a specific pattern
 */
function invalidateCache(pattern, cacheDuration = 'all') {
  if (cacheDuration === 'all') {
    // Clear all caches
    Object.values(caches).forEach(cache => {
      const keys = cache.keys();
      keys.forEach(key => {
        if (key.includes(pattern)) {
          cache.del(key);
        }
      });
    });
  } else {
    // Clear specific cache
    const cache = caches[cacheDuration];
    if (cache) {
      const keys = cache.keys();
      keys.forEach(key => {
        if (key.includes(pattern)) {
          cache.del(key);
        }
      });
    }
  }
}

/**
 * Middleware to invalidate cache on data mutations
 */
function invalidateCacheMiddleware(pattern) {
  return (req, res, next) => {
    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    // Override response methods to invalidate cache on success
    const handleResponse = (data) => {
      if (data && data.success === true) {
        invalidateCache(pattern);
      }
    };

    res.json = function(data) {
      handleResponse(data);
      return originalJson(data);
    };

    res.send = function(data) {
      try {
        const parsed = JSON.parse(data);
        handleResponse(parsed);
      } catch (e) {
        // Not JSON, skip
      }
      return originalSend(data);
    };

    next();
  };
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  const stats = {};
  
  Object.entries(caches).forEach(([duration, cache]) => {
    stats[duration] = {
      keys: cache.keys().length,
      hits: cache.getStats().hits,
      misses: cache.getStats().misses,
      ksize: cache.getStats().ksize,
      vsize: cache.getStats().vsize,
    };
  });
  
  return stats;
}

/**
 * Clear all caches
 */
function clearAllCaches() {
  Object.values(caches).forEach(cache => cache.flushAll());
  console.log('All response caches cleared');
}

module.exports = {
  cacheResponse,
  invalidateCache,
  invalidateCacheMiddleware,
  getCacheStats,
  clearAllCaches,
  // Export individual caches for direct access if needed
  caches,
};

