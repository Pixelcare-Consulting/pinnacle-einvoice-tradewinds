@echo off
REM ================================
REM Secure Production Deployment Script for eInvoice
REM ================================

echo.
echo ========================================
echo   eInvoice Secure Production Deployment
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js and try again
    pause
    exit /b 1
)

REM Check if pnpm is installed
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: pnpm is not installed
    echo Please install pnpm with: npm install -g pnpm
    pause
    exit /b 1
)

REM Check if PM2 is installed
pm2 --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: PM2 is not installed
    echo Please install PM2 with: npm install -g pm2
    pause
    exit /b 1
)

echo [1/9] Checking dependencies...
echo ✓ Node.js is installed
echo ✓ pnpm is installed
echo ✓ PM2 is installed
echo.

echo [2/9] Installing build dependencies...
pnpm install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo ✓ Dependencies installed
echo.

echo [3/9] Running security audit...
pnpm run security:audit
if errorlevel 1 (
    echo WARNING: Security audit found issues
    echo Continue anyway? (y/n)
    set /p continue=
    if /i not "%continue%"=="y" (
        echo Deployment cancelled
        pause
        exit /b 1
    )
)
echo ✓ Security audit completed
echo.

echo [4/9] Cleaning previous builds...
pnpm run clean
echo ✓ Previous builds cleaned
echo.

echo [5/9] Building production version...
pnpm run build
if errorlevel 1 (
    echo ERROR: Build failed
    pause
    exit /b 1
)
echo ✓ Production build completed
echo.

echo [6/9] Running security checks...
pnpm run security:check
if errorlevel 1 (
    echo ERROR: Security check failed
    echo Please review security issues and fix them before deployment
    pause
    exit /b 1
)
echo ✓ Security checks passed
echo.

echo [7/9] Deploying to production...
pnpm run deploy
if errorlevel 1 (
    echo ERROR: Deployment failed
    pause
    exit /b 1
)
echo ✓ Deployment completed
echo.

echo [8/9] Preparing IIS web.config...
if not exist web.config.production (
    echo ERROR: web.config.production not found
    pause
    exit /b 1
)
copy /Y web.config.production web.config
if errorlevel 1 (
    echo ERROR: Failed to copy web.config.production to web.config
    pause
    exit /b 1
)
echo ✓ web.config.production copied to web.config
echo.

echo [9/9] Final steps...
echo.
echo ========================================
echo   DEPLOYMENT COMPLETED SUCCESSFULLY!
echo ========================================
echo.
echo IMPORTANT: Complete these manual steps on the target server.
echo.
echo ========================================
echo   WILLIS PM2 DIRECT HTTPS (recommended)
echo ========================================
echo.
echo Site path: C:\inetpub\wwwroot\pinnacle-einvoice-willis
echo Public URL: https://willis-einvoice.ddns.net  (no :3000)
echo.
echo 1. Stop IIS Default Web Site OR remove HTTPS :443 bindings (port conflict).
echo.
echo 2. Update .env:
echo    PORT=443
echo    NODE_DIRECT_HTTPS=true
echo    TRUST_PROXY=false
echo    SECURE_COOKIE=true
echo    COOKIE_DOMAIN=willis-einvoice.ddns.net
echo    SSL_KEY_PATH=./ssl/willis-einvoice.ddns.net.key
echo    SSL_CERT_PATH=./ssl/willis-einvoice.ddns.net.crt
echo    SSL_CA_PATH=./ssl/DigiCertCA.crt
echo.
echo 3. Run as Administrator:
echo    cd C:\inetpub\wwwroot\pinnacle-einvoice-willis
echo    scripts\willis-pm2-setup.bat
echo    Or: pm2 start ecosystem.config.js --env willis
echo.
echo 4. Verify PM2 logs:
echo    "Starting in HTTPS mode (direct Node SSL)"
echo    "Server started on https://localhost:443"
echo.
echo 5. Firewall/router: allow and forward port 443 to Willis server.
echo.
echo 6. Test: https://willis-einvoice.ddns.net/auth/login
echo.
echo ========================================
echo   WILLIS IIS DEPLOYMENT (optional alternative)
echo ========================================
echo.
echo Site path: C:\inetpub\wwwroot\pinnacle-einvoice-willis
echo Public URL: https://willis-einvoice.ddns.net
echo.
echo 1. Copy build output to the IIS site folder above.
echo    Ensure web.config is in the site root (copied from web.config.production).
echo.
echo 2. Create or update .env with Willis IIS settings:
echo    PORT=3000
echo    TRUST_PROXY=true
echo    NODE_DIRECT_HTTPS=false
echo    SECURE_COOKIE=true
echo    COOKIE_DOMAIN=willis-einvoice.ddns.net
echo    (See .env.template "WILLIS IIS REVERSE PROXY EXAMPLE" section for full example.)
echo.
echo 3. Start the app with the IIS PM2 profile (Node listens HTTP on 3000):
echo    cd C:\inetpub\wwwroot\pinnacle-einvoice-willis
echo    pm2 delete all
echo    pm2 start ecosystem.config.js --env iis
echo    pm2 save
echo.
echo    Verify PM2 logs show:
echo    - "Starting in HTTP mode (IIS/reverse proxy terminates TLS)"
echo    - "Server started on http://localhost:3000"
echo.
echo 4. IIS prerequisites (one-time on Willis server):
echo    - URL Rewrite module installed
echo    - Application Request Routing (ARR) installed
echo    - ARR: Server ^> Application Request Routing Cache ^> Server Proxy Settings
echo      ^> Enable proxy = checked
echo    - Site physical path = C:\inetpub\wwwroot\pinnacle-einvoice-willis
echo    - Site status = Started
echo.
echo 5. IIS site bindings (Site ^> Bindings):
echo    - http  :80  ^| Host: willis-einvoice.ddns.net
echo    - https :443 ^| Host: willis-einvoice.ddns.net ^| SSL cert from ssl\ folder
echo.
echo 6. Firewall and router:
echo    - Windows Firewall: allow inbound TCP 80 and 443
echo    - Router/DDNS: forward ports 80 and 443 to the Willis server IP
echo    - Block public access to port 3000 (localhost/IIS only)
echo.
echo 7. Verification (PowerShell on Willis server):
echo    curl http://127.0.0.1:3000/auth/login
echo    curl -k https://localhost/auth/login
echo    netstat -ano ^| findstr ":443"
echo.
echo 8. Test in browser:
echo    https://willis-einvoice.ddns.net/auth/login  (no :3000 in URL)
echo.
echo ========================================
echo   TRADEWINDS DIRECT HTTPS (non-IIS)
echo ========================================
echo.
echo For servers where Node serves HTTPS directly (no IIS reverse proxy):
echo    pm2 start ecosystem.config.js --env production
echo    Set TRUST_PROXY=false and NODE_DIRECT_HTTPS=true in .env
echo.
echo ========================================
echo   DATABASE OPERATIONS
echo ========================================
echo.
echo Available database commands:
echo   pnpm run db:generate    - Generate Prisma client
echo   pnpm run db:pull        - Pull database schema
echo   pnpm run db:migrate     - Deploy migrations
echo   pnpm run db:setup       - Full database setup
echo   pnpm run db:health      - Check database health
echo   pnpm run db:studio      - Open Prisma Studio
echo.
echo ========================================
echo   SECURITY REMINDERS
echo ========================================
echo.
echo ✓ Source code is obfuscated and minified
echo ✓ Sensitive files are excluded from build
echo ✓ Environment variables are externalized
echo ✓ Security headers are configured
echo ✓ File access controls are in place
echo.
echo For security report, check the deployment directory security-report.json
echo.

pause
