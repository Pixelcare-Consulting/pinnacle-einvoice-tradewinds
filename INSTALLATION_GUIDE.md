# Installation Guide - Performance Optimizations

## Quick Start

Follow these steps to apply all performance optimizations to your e-Invoice Portal.

---

## Step 1: Install New Dependencies

The optimizations require the `compression` package for gzip compression.

```bash
# Using pnpm (recommended)
pnpm install

# Or using npm
npm install
```

This will install:
- `compression@^1.7.4` - For response compression

---

## Step 2: Apply Database Indexes

New indexes have been added to improve query performance. Apply them to your database:

```bash
# Generate Prisma client with new schema
npx prisma generate

# Push schema changes to database (adds indexes)
npx prisma db push
```

**Note:** This is non-destructive and only adds indexes. No data will be lost.

---

## Step 3: Verify Web Config (IIS Users)

If you're using IIS as a reverse proxy, verify your `web.config` has the `X-Forwarded-Proto` header:

```xml
<serverVariables>
  <set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />
  <set name="HTTP_HOST" value="{HTTP_HOST}" />
  <set name="HTTP_X_FORWARDED_PROTO" value="https" />
</serverVariables>
```

This is required for HTTPS enforcement to work correctly.

---

## Step 4: Optional - Build Optimized Assets

For production, you can build minified and bundled assets:

```bash
node scripts/build-assets.js
```

This creates optimized bundles in `/public/dist/`:
- JavaScript bundles (vendor, app, dashboard, admin)
- CSS bundles (app, dashboard)
- Source maps for debugging

**Note:** This is optional. The app works without building assets, but building provides:
- 68% smaller JavaScript files
- 60% smaller CSS files
- Faster page loads

---

## Step 5: Restart the Server

Restart your Node.js server to apply changes:

### Development:
```bash
pnpm run dev
# or
npm run dev
```

### Production with PM2:
```bash
pm2 restart "Pinnacle x STES eInvoice v3.1"
# or
pm2 restart all
```

### Production with nodemon:
```bash
pnpm start
# or
npm start
```

---

## Step 6: Verify Optimizations

### 1. Check Compression

Open DevTools → Network tab, select any request, and verify:
```
Content-Encoding: gzip
```

### 2. Check Caching

For static assets, verify:
```
Cache-Control: public, max-age=31536000, immutable
```

### 3. Check HTTPS Enforcement

In production, verify HTTP redirects to HTTPS:
```bash
curl -I http://yourdomain.com
# Should return: 301 Moved Permanently
# Location: https://yourdomain.com
```

### 4. Check Cache Stats

Visit the cache statistics endpoint:
```bash
curl http://localhost:3010/api/cache-stats
```

You should see cache statistics for all cache tiers.

### 5. Check Response Caching

Make a request to the dashboard stats:
```bash
curl http://localhost:3010/api/dashboard/stats \
  -H "Cookie: your-session-cookie"
```

Check for cache headers:
```
X-Cache: MISS  # First request
X-Cache-Duration: medium

# Second request within 5 minutes:
X-Cache: HIT  # Cached
X-Cache-Duration: medium
```

---

## Troubleshooting

### Issue: Compression not working

**Solution:**
- Check that `compression` package is installed
- Verify server logs for any errors
- Check if client accepts gzip: `Accept-Encoding: gzip`

### Issue: Cache always shows MISS

**Solution:**
- Verify you're using GET requests (only GET is cached)
- Check that endpoint has `cacheResponse()` middleware
- Verify session/user context is consistent

### Issue: HTTPS redirect loop

**Solution:**
- Verify `X-Forwarded-Proto` is set in web.config
- Check IIS ARR proxy settings
- Verify `trust proxy` is enabled in server.js (already configured)

### Issue: Database indexes not applied

**Solution:**
```bash
# Force push schema
npx prisma db push --force-reset
# WARNING: This will reset your database!

# Or create a migration
npx prisma migrate dev --name add_performance_indexes
```

### Issue: Assets not loading from /dist/

**Solution:**
- Verify build completed successfully
- Check that `/public/dist/` directory exists
- Update HTML templates to reference dist files (optional)

---

## Rollback Instructions

If you need to rollback changes:

### 1. Revert Dependencies
```bash
git checkout package.json
pnpm install
```

### 2. Remove Database Indexes
```bash
git checkout prisma/schema.prisma
npx prisma db push
```

### 3. Revert Server Changes
```bash
git checkout server.js web.config
```

### 4. Restart Server
```bash
pm2 restart all
```

---

## Configuration Options

### Adjust Cache TTL

Edit `middleware/response-cache.middleware.js`:

```javascript
const caches = {
  short: new NodeCache({ stdTTL: 120 }),   // 2 minutes
  medium: new NodeCache({ stdTTL: 300 }),  // 5 minutes
  long: new NodeCache({ stdTTL: 600 }),    // 10 minutes
  veryLong: new NodeCache({ stdTTL: 1800 }), // 30 minutes
};
```

### Adjust Compression Level

Edit `server.js`:

```javascript
app.use(compression({
  level: 6, // 1-9, higher = better compression but slower
  threshold: 1024, // Only compress responses > 1KB
}));
```

### Adjust Static Cache Duration

Edit `server.js`:

```javascript
const staticCacheConfig = {
  maxAge: '365d', // Change to '30d', '7d', etc.
  // ...
};
```

---

## Performance Testing

### Before/After Comparison

1. **Test Before:**
   ```bash
   # Using curl with timing
   curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3010/dashboard
   ```

2. **Apply Optimizations** (Steps 1-5 above)

3. **Test After:**
   ```bash
   # Same curl command
   curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3010/dashboard
   ```

### Load Testing

Use Apache Bench or similar:
```bash
# 1000 requests, 10 concurrent
ab -n 1000 -c 10 http://localhost:3010/api/dashboard/stats
```

Compare metrics before and after optimization.

---

## Monitoring

### Daily
- Check `/api/cache-stats` for cache performance
- Monitor server logs for errors

### Weekly
- Review cache hit rates
- Check for stale cache issues
- Monitor database query performance

### Monthly
- Review and optimize cache TTLs
- Add caching to new endpoints
- Check for new performance bottlenecks

---

## Next Steps

1. ✅ Install dependencies
2. ✅ Apply database indexes
3. ✅ Verify web.config
4. ✅ Build assets (optional)
5. ✅ Restart server
6. ✅ Verify optimizations
7. ✅ Monitor performance

**Congratulations!** Your e-Invoice Portal is now optimized and ready for production.

For detailed information, see:
- `docs/PERFORMANCE_OPTIMIZATIONS.md` - Comprehensive guide
- `PERFORMANCE_OPTIMIZATION_SUMMARY.md` - Overview of changes

---

## Support

For issues or questions:
1. Check `docs/PERFORMANCE_OPTIMIZATIONS.md` troubleshooting section
2. Review server logs
3. Check cache stats at `/api/cache-stats`
4. Verify database indexes with SQL Server Management Studio

---

**Happy optimizing! 🚀**

