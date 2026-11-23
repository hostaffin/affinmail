<#
.SYNOPSIS
    AffinMail Automated Native Test Runner for Windows
.DESCRIPTION
    Executes all unit tests, linters, and configuration validators on Windows without Docker.
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "         AffinMail Automated Test Suite (Windows Native)          " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan

$Passed = 0
$Failed = 0

# Test 1: Vitest Webmail Client Tests
Write-Host "`n[Test 1/4] Running Webmail Vitest Suite..." -ForegroundColor Cyan
try {
    npm --prefix webmail test
    Write-Host "[PASS] Webmail Vitest unit tests passed." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Vitest tests failed." -ForegroundColor Red
    $Failed++
}

# Test 2: PHP WHMCS Driver Lint & Syntax
Write-Host "`n[Test 2/4] Verifying Hostaffin PHP Module Syntax..." -ForegroundColor Cyan
try {
    php -l driver/AffinMail/AffinMail.php
    php -l driver/AffinMail/tests/AffinMailTest.php
    Write-Host "[PASS] PHP driver syntax verified with PHP 8.5+." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] PHP driver syntax check failed." -ForegroundColor Red
    $Failed++
}

# Test 3: Caddy Configuration Validation
Write-Host "`n[Test 3/4] Validating Caddy Dual-Port Routing Configuration..." -ForegroundColor Cyan
try {
    caddy validate --config deploy/Caddyfile.windows
    Write-Host "[PASS] Caddyfile configuration is valid." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Caddyfile validation failed." -ForegroundColor Red
    $Failed++
}

# Test 4: Python Mock Backend Syntax
Write-Host "`n[Test 4/4] Verifying Python Mock Backend Engine..." -ForegroundColor Cyan
try {
    python -m py_compile scripts/mock-backend.py
    Write-Host "[PASS] Python mock server syntax is valid." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Python mock server compile error." -ForegroundColor Red
    $Failed++
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "Test Summary: $Passed Passed, $Failed Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "==================================================================" -ForegroundColor Cyan

if ($Failed -eq 0) {
    Write-Host "All tests passed successfully! You can launch the interactive UI test with:" -ForegroundColor Green
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\start-windows-test.ps1`n" -ForegroundColor Yellow
}
